import {
  MAX_ASSISTANT_TEXT_LENGTH,
  MAX_IMAGE_DATA_LENGTH,
  MAX_IMAGES_PER_TURN,
  MAX_THINKING_TEXT_LENGTH,
  MAX_TOOL_ACTIVITIES_PER_TURN,
  MAX_TOOL_NAME_LENGTH,
  MAX_TURN_TEXT_LENGTH,
} from '../../shared/protocol/bounds';
import {
  MAX_BRIDGE_ID_LENGTH,
  MAX_SESSION_TRANSCRIPT_ITEMS,
} from '../../shared/bridgeMessages';
import { type ImageOrigin } from '../../shared/protocol/attachments';
import { type SessionTranscriptItem } from '../../shared/protocol/transcript';
import { stableTranscriptId } from '../../shared/transcript/hostTranscriptState';
import { isStrictRecord } from '../../shared/validation/strictValidation';
import {
  MAX_SESSION_TRANSCRIPT_TEXT_UNITS,
  base64ByteLength,
  enforceTranscriptImageBudget,
  transcriptItemTextUnits,
} from '../../shared/transcript/transcriptLimits';
import { summarizeToolAction } from '../../shared/transcript/toolActivity';
import { readTokenUsageBreakdown } from '../../shared/protocol/tokenUsage';
import { extractToolResultText, readSdkImageBlock } from '../events/normalizeSdkEvent';
import { enforceToolResultBudget } from '../../shared/transcript/toolResultPreview';
import {
  completeHistoryToolItem,
  historyOperationDiff,
  historyResultOperationDiff,
  historyResultSource,
} from './toolResultHistory';
import { operationDiffFields } from '../../shared/protocol/operationDiff';
import {
  readSubagentInvocationRecords,
  readTaskDelegation,
} from '../subagents/subagentSummary';
import { withSubagentInvocationSummaries } from '../subagents/subagentInvocationMatching';
import { extractToolBackgroundHint } from '../tools/toolBackgroundHint';
import {
  extractToolAction,
  extractToolDetail,
  extractToolTarget,
} from '../tools/toolDetail';
import { type SessionHistoryResult, unavailableSessionHistory } from './SessionHistory';
import { readSessionMission } from './sessionMission';
import { projectAskUserHistoryItem, readAskUserQuestions } from './askUserHistory';
import { historyToolFilePaths } from './historyToolPaths';
import { appendHistoryTurnChanges } from './historyTurnChanges';
import { sessionMessageTurnId } from '../../shared/transcript/sessionMessageIdentity';
import { historyMessageAncestry } from './historyMessageAncestry';
import { isMessageTimestamp } from '../../shared/protocol/messageTimestamp';
import { HISTORY_NOTE_ID_PREFIX, MAX_HISTORY_NOTE_LENGTH } from '../../shared/protocol/historyNote';

const MAX_RAW_MESSAGES_TO_PROJECT = 10_000;
const MAX_RAW_BLOCKS_PER_MESSAGE = 1_000;
const MAX_RAW_BLOCKS_TO_PROJECT = 20_000;
const MAX_IDENTITY_SOURCE_LENGTH = 2_048;
const SYSTEM_REMINDER_START = '<system-reminder>';
const SYSTEM_REMINDER_END = '</system-reminder>';
const SYSTEM_NOTIFICATION_START = '<system-notification>';
const SYSTEM_NOTIFICATION_END = '</system-notification>';
const SYSTEM_MARKER_TAGS = new Set([
  SYSTEM_REMINDER_START,
  SYSTEM_REMINDER_END,
  SYSTEM_NOTIFICATION_START,
  SYSTEM_NOTIFICATION_END,
]);

interface Projection {
  readonly workspaceRoot: string | undefined;
  readonly sourceSessionId: string | undefined;
  readonly transcript: Array<SessionTranscriptItem | undefined>;
  readonly positions: Map<string, number>;
  readonly ids: Set<string>;
  readonly tools: Map<
    string,
    {
      readonly transcriptId: string;
      readonly askUserQuestions?: ReturnType<typeof readAskUserQuestions>;
      readonly resultSource?: ReturnType<typeof historyResultSource>;
      readonly operationDiff?: ReturnType<typeof historyOperationDiff>;
      readonly toolName: string;
      readonly input: unknown;
      readonly callId: string;
    }
  >;
  readonly toolIdentities: Map<string, string>;
  readonly rawToolIds: Set<string>;
  /** Every path of a multi-file call, used by Changes synthesis. */
  readonly multiFileTools: Map<string, readonly string[]>;
  readonly toolCounts: Map<string, number>;
  readonly imageCounts: Map<string, number>;
  transcriptHead: number;
  transcriptSize: number;
  transcriptTextUnits: number;
  rawBlocksProcessed: number;
  partial: boolean;
}

export function projectSessionHistory(
  loaded: unknown,
  options?: { readonly workspaceRoot?: string; readonly sourceSessionId?: string },
): SessionHistoryResult {
  const steps = projectSessionHistorySteps(loaded, options);
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
}

/** One message per step lets asynchronous history readers share this projection. */
export function* projectSessionHistorySteps(
  loaded: unknown,
  options?: {
    readonly workspaceRoot?: string;
    readonly sourceSessionId?: string;
  },
): Generator<void, SessionHistoryResult> {
  try {
    const messages = readLoadedMessages(loaded);
    if (!messages) {
      return unavailableSessionHistory();
    }

    const projection: Projection = {
      workspaceRoot: options?.workspaceRoot,
      sourceSessionId: options?.sourceSessionId,
      transcript: new Array(MAX_SESSION_TRANSCRIPT_ITEMS),
      positions: new Map(),
      ids: new Set(),
      tools: new Map(),
      toolIdentities: new Map(),
      rawToolIds: new Set(),
      multiFileTools: new Map(),
      toolCounts: new Map(),
      imageCounts: new Map(),
      transcriptHead: 0,
      transcriptSize: 0,
      transcriptTextUnits: 0,
      rawBlocksProcessed: 0,
      partial: messages.length > MAX_RAW_MESSAGES_TO_PROJECT,
    };
    const firstMessage = Math.max(0, messages.length - MAX_RAW_MESSAGES_TO_PROJECT);
    for (
      let messageIndex = firstMessage;
      messageIndex < messages.length;
      messageIndex += 1
    ) {
      projectMessage(projection, messages[messageIndex], messageIndex);
      yield;
    }

    const truncated = projection.partial;
    // Image byte eviction keeps placeholder rows in place, so it does
    // not flip the history to partial by itself.
    const imageBudget = enforceTranscriptImageBudget(
      appendHistoryTurnChanges(
        readTranscript(projection),
        projection.transcriptTextUnits,
        projection.multiFileTools,
      ),
    );
    const state = withSubagentInvocationSummaries({
      transcript: [...imageBudget.transcript],
      historyStatus: truncated ? 'partial' : 'complete',
      truncated,
    }, readSubagentInvocationRecords(loaded));
    const mission = readSessionMission(loaded);
    const tokenUsage = readSessionTokenUsage(loaded);
    return {
      status: 'available',
      state,
      ...(options?.sourceSessionId === undefined ? {} : {
        messageAncestry: historyMessageAncestry(messages, firstMessage, options.sourceSessionId),
      }),
      ...(mission === null ? {} : { mission }),
      ...(tokenUsage === undefined ? {} : { tokenUsage }),
    };
  } catch {
    return unavailableSessionHistory();
  }
}

/**
 * Projects the public daemon `sessions.getMessages()` array through the same
 * bounded, privacy-preserving history path as `loadSession()`.
 */
export function projectSessionMessages(
  messages: unknown,
  options?: {
    readonly workspaceRoot?: string;
    readonly sourceSessionId?: string;
  },
): SessionHistoryResult {
  return projectSessionHistory({ result: { session: { messages } } }, options);
}

function readLoadedMessages(value: unknown): readonly unknown[] | null {
  if (!isStrictRecord(value)) {
    return null;
  }
  const result = value.result;
  if (!isStrictRecord(result)) {
    return null;
  }
  const session = result.session;
  if (!isStrictRecord(session) || !Array.isArray(session.messages)) {
    return null;
  }
  return session.messages;
}

/**
 * Cumulative session token totals from the envelope's top-level
 * `result.tokenUsage` (optional in `LoadSessionResult`; confirmed
 * populated by probe-token-usage-load.mjs, 2026-08-12). Absent or
 * malformed values fail soft to `undefined`.
 */
function readSessionTokenUsage(value: unknown) {
  if (!isStrictRecord(value) || !isStrictRecord(value.result)) {
    return undefined;
  }
  return readTokenUsageBreakdown(value.result.tokenUsage);
}

function projectMessage(
  projection: Projection,
  value: unknown,
  messageIndex: number,
): void {
  if (!isStrictRecord(value)) {
    projection.partial = true;
    return;
  }
  if (!isVisibleMessage(projection, value)) {
    return;
  }

  if (value.visibility === 'user_only' && typeof value.id === 'string' && value.id.startsWith(HISTORY_NOTE_ID_PREFIX) &&
    Array.isArray(value.content)) {
    const rawText = value.content.filter((block) => isStrictRecord(block) && block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text as string).join('\n');
    const text = rawText.slice(0, MAX_HISTORY_NOTE_LENGTH);
    if (text.length < rawText.length) projection.partial = true;
    if (text) appendTranscriptItem(projection, { id: stableTranscriptId('diagnostic', 'history-note', value.id),
      kind: 'diagnostic', turnId: null, severity: 'info', code: 'history-note', message: text });
    return;
  }

  const role = value.role;
  if (role !== 'user' && role !== 'assistant' && role !== 'tool') {
    if (role !== 'system') {
      projection.partial = true;
    }
    return;
  }
  if (!Array.isArray(value.content)) {
    projection.partial = true;
    return;
  }

  const messageIdentity = boundedIdentity(value.id, messageIndex);
  const timestamp = isMessageTimestamp(value.createdAt) ? value.createdAt : undefined;
  const sdkMessageId =
    role === 'user' &&
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    value.id.length <= MAX_BRIDGE_ID_LENGTH
      ? value.id
      : undefined;
  const turnId = projection.sourceSessionId && typeof value.id === 'string' &&
    value.id.length > 0 && value.id.length <= MAX_BRIDGE_ID_LENGTH
    ? sessionMessageTurnId(projection.sourceSessionId, value.id) : stableTranscriptId(
    'assistant',
    'history-turn',
    messageIdentity,
    String(messageIndex),
  );
  const remainingBlocks = Math.max(
    0,
    MAX_RAW_BLOCKS_TO_PROJECT - projection.rawBlocksProcessed,
  );
  const blockCount = Math.min(
    value.content.length,
    MAX_RAW_BLOCKS_PER_MESSAGE,
    remainingBlocks,
  );
  if (blockCount < value.content.length) {
    projection.partial = true;
  }
  for (let blockIndex = 0; blockIndex < blockCount; blockIndex += 1) {
    const block = value.content[blockIndex];
    if (!isStrictRecord(block) || typeof block.type !== 'string') {
      projection.partial = true;
      continue;
    }
    projectBlock(
      projection,
      role,
      block,
      messageIdentity,
      turnId,
      messageIndex,
      blockIndex,
      sdkMessageId,
      timestamp,
    );
  }
  projection.rawBlocksProcessed += blockCount;
}

function projectBlock(
  projection: Projection,
  role: 'user' | 'assistant' | 'tool',
  block: Record<string, unknown>,
  messageIdentity: string,
  turnId: string,
  messageIndex: number,
  blockIndex: number,
  sdkMessageId: string | undefined,
  timestamp: number | undefined,
): void {
  switch (block.type) {
    case 'text':
      if (role === 'tool') {
        return;
      }
      if (typeof block.text !== 'string') {
        projection.partial = true;
        return;
      }
      appendText(
        projection,
        role,
        block.text,
        messageIdentity,
        turnId,
        messageIndex,
        blockIndex,
        sdkMessageId,
        timestamp,
      );
      return;
    case 'thinking':
      if (role !== 'assistant') {
        return;
      }
      appendThinking(
        projection,
        block,
        messageIdentity,
        turnId,
        messageIndex,
        blockIndex,
      );
      return;
    case 'redacted_thinking':
      return;
    case 'tool_use':
      if (role === 'assistant') {
        appendTool(projection, block, messageIdentity, turnId, messageIndex, blockIndex);
      }
      return;
    case 'tool_result':
      completeTool(projection, block);
      appendToolResultImages(
        projection,
        block,
        messageIdentity,
        turnId,
        messageIndex,
        blockIndex,
      );
      return;
    case 'image':
      if (role === 'user' || role === 'assistant') {
        appendImage(
          projection,
          role,
          block,
          messageIdentity,
          turnId,
          messageIndex,
          blockIndex,
          turnId,
          sdkMessageId,
        );
      }
      return;
    case 'document':
      if (role === 'user' || role === 'assistant') {
        projection.partial = true;
      }
      return;
    default:
      if (role === 'user' || role === 'assistant') {
        projection.partial = true;
      }
  }
}

function appendText(
  projection: Projection,
  role: 'user' | 'assistant',
  rawText: string,
  messageIdentity: string,
  turnId: string,
  messageIndex: number,
  blockIndex: number,
  sdkMessageId: string | undefined,
  timestamp: number | undefined,
): void {
  const safeText = role === 'assistant' ? rawText : sanitizeNonAssistantText(rawText);
  if (safeText === null) {
    projection.partial = true;
    return;
  }
  const limit = role === 'user' ? MAX_TURN_TEXT_LENGTH : MAX_ASSISTANT_TEXT_LENGTH;
  const text = safeText.slice(0, limit);
  if (text.length < safeText.length) {
    projection.partial = true;
  }
  if (text.length === 0) {
    return;
  }

  const kind = role === 'user' ? 'user' : 'assistant';
  const id = uniqueTranscriptId(
    projection,
    kind,
    messageIdentity,
    String(messageIndex),
    String(blockIndex),
  );
  appendTranscriptItem(
    projection,
    role === 'user'
      ? {
          id,
          kind: 'user',
          text,
          ...(sdkMessageId === undefined ? {} : { messageId: sdkMessageId }),
          ...(timestamp === undefined ? {} : { timestamp }),
        }
      : { id, kind: 'assistant', turnId, text, ...(timestamp === undefined ? {} : { timestamp }) },
  );
}

export function sanitizeNonAssistantText(rawText: string): string | null {
  const possibleTags = /<[^>]*(?:system-reminder|system-notification)[^>]*(?:>|$)/g;
  for (const match of rawText.matchAll(possibleTags)) {
    if (!SYSTEM_MARKER_TAGS.has(match[0])) {
      return null;
    }
  }

  const markerTags = /<\/?system-(?:reminder|notification)>/g;
  let activeMarker: 'reminder' | 'notification' | null = null;
  let cursor = 0;
  let foundMarker = false;
  let safeText = '';

  for (const match of rawText.matchAll(markerTags)) {
    const tag = match[0];
    const index = match.index;
    const marker = tag.includes('reminder') ? 'reminder' : 'notification';
    const isClosing = tag.startsWith('</');
    foundMarker = true;

    if (isClosing) {
      if (activeMarker !== marker) {
        return null;
      }
      activeMarker = null;
    } else {
      if (activeMarker !== null) {
        return null;
      }
      safeText += rawText.slice(cursor, index);
      activeMarker = marker;
    }
    cursor = index + tag.length;
  }

  if (!foundMarker) {
    return rawText;
  }
  if (activeMarker !== null) {
    return null;
  }
  return `${safeText}${rawText.slice(cursor)}`.trim();
}

function appendThinking(
  projection: Projection,
  block: Record<string, unknown>,
  messageIdentity: string,
  turnId: string,
  messageIndex: number,
  blockIndex: number,
): void {
  if (typeof block.thinking !== 'string') {
    projection.partial = true;
    return;
  }
  const text = block.thinking.slice(0, MAX_THINKING_TEXT_LENGTH);
  const truncated = text.length < block.thinking.length;
  if (truncated) {
    projection.partial = true;
  }
  if (text.length === 0) {
    return;
  }

  const durationMs =
    typeof block.durationMs === 'number' &&
    Number.isSafeInteger(block.durationMs) &&
    block.durationMs >= 0
      ? { durationMs: block.durationMs }
      : {};
  appendTranscriptItem(projection, {
    id: uniqueTranscriptId(
      projection,
      'thinking',
      messageIdentity,
      String(messageIndex),
      String(blockIndex),
    ),
    kind: 'thinking',
    turnId,
    text,
    status: 'complete',
    ...durationMs,
    truncated,
  });
}

function appendImage(
  projection: Projection,
  origin: ImageOrigin,
  block: Record<string, unknown>,
  messageIdentity: string,
  turnId: string,
  messageIndex: number,
  blockIndex: number,
  countKey: string = turnId,
  userMessageId?: string,
): void {
  const image = readSdkImageBlock(block);
  if (image === undefined) {
    projection.partial = true;
    return;
  }
  const imageCount = projection.imageCounts.get(countKey) ?? 0;
  if (imageCount >= MAX_IMAGES_PER_TURN) {
    projection.partial = true;
    return;
  }
  const oversized = image.data.length > MAX_IMAGE_DATA_LENGTH;
  appendTranscriptItem(projection, {
    id: uniqueTranscriptId(
      projection,
      'image',
      messageIdentity,
      String(messageIndex),
      String(blockIndex),
    ),
    kind: 'image',
    turnId,
    origin,
    ...(origin === 'user' && userMessageId !== undefined ? { userMessageId } : {}),
    mediaType: image.mediaType,
    data: oversized ? '' : image.data,
    generated: image.generated,
    byteLength: base64ByteLength(image.data),
  });
  projection.imageCounts.set(countKey, imageCount + 1);
}

/**
 * Projects image blocks embedded in a tool result's weakly typed
 * `content` array as `origin: 'tool-result'` image items (e.g. a
 * browser screenshot). Non-image entries stay untouched.
 */
function appendToolResultImages(
  projection: Projection,
  block: Record<string, unknown>,
  messageIdentity: string,
  turnId: string,
  messageIndex: number,
  blockIndex: number,
): void {
  const content = block.content;
  if (!Array.isArray(content)) {
    return;
  }
  for (let contentIndex = 0; contentIndex < content.length; contentIndex += 1) {
    const entry: unknown = content[contentIndex];
    if (
      !isStrictRecord(entry) ||
      entry.type !== 'image' ||
      readSdkImageBlock(entry) === undefined
    ) {
      continue;
    }
    appendImage(
      projection,
      'tool-result',
      entry,
      messageIdentity,
      turnId,
      messageIndex,
      blockIndex * MAX_RAW_BLOCKS_PER_MESSAGE + contentIndex,
      // The live stream caps images per tool_result event; mirror that
      // here per tool_result block instead of per whole tool message,
      // which can legitimately carry many single-image results.
      `${turnId}#tool-result:${blockIndex}`,
    );
  }
}

function appendTool(
  projection: Projection,
  block: Record<string, unknown>,
  messageIdentity: string,
  turnId: string,
  messageIndex: number,
  blockIndex: number,
): void {
  if (typeof block.id !== 'string' || typeof block.name !== 'string') {
    projection.partial = true;
    return;
  }
  const toolName = sanitizeToolName(block.name);
  if (toolName.length === 0) {
    projection.partial = true;
    return;
  }
  if (block.name.length > MAX_TOOL_NAME_LENGTH) {
    projection.partial = true;
  }
  const toolCount = projection.toolCounts.get(turnId) ?? 0;
  if (toolCount >= MAX_TOOL_ACTIVITIES_PER_TURN) {
    projection.partial = true;
    return;
  }

  const rawToolIdentity = boundedIdentity(block.id, blockIndex);
  const duplicate = projection.rawToolIds.has(block.id);
  projection.rawToolIds.add(block.id);
  if (duplicate) projection.partial = true;
  const toolUseId = block.id.length > 0 && block.id.length <= MAX_BRIDGE_ID_LENGTH && !duplicate
    ? block.id : stableTranscriptId(
    'tool',
    'history-tool-use',
    rawToolIdentity,
    messageIdentity,
    String(messageIndex),
    String(blockIndex),
  );
  const transcriptId = uniqueTranscriptId(projection, 'tool', turnId, toolUseId);
  const filePaths = historyToolFilePaths(projection.workspaceRoot, toolName, block.input);
  if (filePaths.length > 1) {
    projection.multiFileTools.set(transcriptId, filePaths);
  }
  const detail = extractToolDetail(toolName, block.input);
  const target = extractToolTarget(toolName, block.input, projection.workspaceRoot);
  const backgroundHint = extractToolBackgroundHint(toolName, block.input);
  const subagent = readTaskDelegation(toolName, block.input);
  const operationDiff = historyOperationDiff(
    block.name,
    block.input,
    projection.workspaceRoot,
    block.id,
    projection.sourceSessionId,
  );
  appendTranscriptItem(projection, {
    id: transcriptId,
    kind: 'tool',
    turnId,
    toolUseId,
    toolName,
    action: extractToolAction(toolName, block.input) ?? summarizeToolAction(toolName),
    status: 'stopped',
    progressCount: 0,
    latestUpdateKind: null,
    ...(filePaths.length === 0 ? {} : { filePath: filePaths[0] }),
    ...(filePaths.length <= 1 ? {} : { additionalFileCount: filePaths.length - 1 }),
    ...(detail === undefined ? {} : { detailKind: detail.kind, detail: detail.text }),
    ...(target === undefined ? {} : { target }),
    ...(backgroundHint === undefined ? {} : { backgroundHint }),
    ...(subagent === null ? {} : { subagent }),
    ...operationDiffFields({ operationDiff }),
  });
  projection.toolCounts.set(turnId, (projection.toolCounts.get(turnId) ?? 0) + 1);
  if (!projection.tools.has(rawToolIdentity)) {
    const askUserQuestions = readAskUserQuestions(toolName, block.input);
    projection.tools.set(rawToolIdentity, {
      transcriptId,
      resultSource: historyResultSource(block.name, block.input, projection.workspaceRoot, block.id),
      operationDiff,
      toolName: block.name,
      input: block.input,
      callId: block.id,
      ...(askUserQuestions === undefined ? {} : { askUserQuestions }),
    });
    projection.toolIdentities.set(transcriptId, rawToolIdentity);
  }
}

function completeTool(projection: Projection, block: Record<string, unknown>): void {
  if (typeof block.toolUseId !== 'string') {
    return;
  }
  if (block.isError !== undefined && typeof block.isError !== 'boolean') {
    projection.partial = true;
    return;
  }
  const tool = projection.tools.get(boundedIdentity(block.toolUseId, 0));
  if (!tool) {
    return;
  }
  const index = projection.positions.get(tool.transcriptId);
  if (index === undefined) {
    return;
  }
  const existing = projection.transcript[index];
  if (existing?.kind !== 'tool') {
    return;
  }
  const updated = completeHistoryToolItem(
    existing,
    block.content,
    block.isError === true,
    tool.resultSource,
    historyResultOperationDiff(
      tool.toolName,
      tool.input,
      block.content,
      block.isError === true,
      projection.workspaceRoot,
      tool.callId,
      projection.sourceSessionId,
    ) ?? tool.operationDiff,
  );
  projection.transcript[index] = updated;
  const budget = enforceToolResultBudget(readTranscript(projection));
  if (budget.evicted)
    for (const item of budget.items) {
      const position = projection.positions.get(item.id);
      if (position !== undefined) projection.transcript[position] = item;
    }
  projection.transcriptTextUnits +=
    transcriptItemTextUnits(updated) - transcriptItemTextUnits(existing);
  const askUserResult = projectAskUserHistoryItem(
    tool.askUserQuestions,
    tool.askUserQuestions === undefined
      ? undefined
      : extractToolResultText(block.content),
    block.isError === true,
    stableTranscriptId('ask-user-result', 'history', tool.transcriptId),
    existing.turnId,
  );
  if (askUserResult !== undefined) {
    appendTranscriptItem(projection, askUserResult);
  }
}

function isVisibleMessage(
  projection: Projection,
  value: Record<string, unknown>,
): boolean {
  if (
    value.visibility === 'llm_only' ||
    value.isUserVisible === false ||
    value.hiddenFromUserViews === true
  ) {
    return false;
  }
  if (hasHookMetadata(value)) {
    return false;
  }
  if (
    (value.visibility !== undefined &&
      value.visibility !== 'both' &&
      value.visibility !== 'user_only') ||
    (value.isUserVisible !== undefined && typeof value.isUserVisible !== 'boolean') ||
    (value.hiddenFromUserViews !== undefined &&
      typeof value.hiddenFromUserViews !== 'boolean')
  ) {
    projection.partial = true;
    return false;
  }
  return true;
}

function hasHookMetadata(value: Record<string, unknown>): boolean {
  return (
    value.hookEventName !== undefined ||
    value.hookMatcher !== undefined ||
    value.hookCommands !== undefined ||
    value.hookStatus !== undefined ||
    value.hookResults !== undefined ||
    value.hookToolCallId !== undefined ||
    value.hookStartTime !== undefined ||
    value.hookEndTime !== undefined
  );
}

function uniqueTranscriptId(
  projection: Projection,
  kind: SessionTranscriptItem['kind'],
  ...identity: readonly string[]
): string {
  let collision = 0;
  let id = stableTranscriptId(kind, ...identity);
  while (projection.ids.has(id)) {
    collision += 1;
    id = stableTranscriptId(kind, ...identity, String(collision));
  }
  projection.ids.add(id);
  return id;
}

function appendTranscriptItem(projection: Projection, item: SessionTranscriptItem): void {
  let index =
    (projection.transcriptHead + projection.transcriptSize) %
    MAX_SESSION_TRANSCRIPT_ITEMS;
  if (projection.transcriptSize === MAX_SESSION_TRANSCRIPT_ITEMS) {
    index = projection.transcriptHead;
    evictTranscriptItem(projection, index);
    projection.transcriptHead =
      (projection.transcriptHead + 1) % MAX_SESSION_TRANSCRIPT_ITEMS;
    projection.partial = true;
  } else {
    projection.transcriptSize += 1;
  }
  projection.transcript[index] = item;
  projection.positions.set(item.id, index);
  projection.transcriptTextUnits += transcriptItemTextUnits(item);
  while (
    projection.transcriptSize > 0 &&
    projection.transcriptTextUnits > MAX_SESSION_TRANSCRIPT_TEXT_UNITS
  ) {
    const evictedIndex = projection.transcriptHead;
    evictTranscriptItem(projection, evictedIndex);
    projection.transcript[evictedIndex] = undefined;
    projection.transcriptHead =
      (projection.transcriptHead + 1) % MAX_SESSION_TRANSCRIPT_ITEMS;
    projection.transcriptSize -= 1;
    projection.partial = true;
  }
}

function evictTranscriptItem(projection: Projection, index: number): void {
  const item = projection.transcript[index];
  if (item === undefined) {
    return;
  }
  projection.transcriptTextUnits -= transcriptItemTextUnits(item);
  projection.ids.delete(item.id);
  projection.positions.delete(item.id);
  // Image counts stay monotonic per counting key: they bound how many
  // images one turn/tool-result may project in total, independent of
  // later ring-buffer eviction.
  if (item.kind !== 'tool') {
    return;
  }

  const toolCount = projection.toolCounts.get(item.turnId);
  if (toolCount === 1) {
    projection.toolCounts.delete(item.turnId);
  } else if (toolCount !== undefined) {
    projection.toolCounts.set(item.turnId, toolCount - 1);
  }
  const rawToolIdentity = projection.toolIdentities.get(item.id);
  if (rawToolIdentity !== undefined) {
    projection.toolIdentities.delete(item.id);
    if (projection.tools.get(rawToolIdentity)?.transcriptId === item.id) {
      projection.tools.delete(rawToolIdentity);
    }
  }
}

function readTranscript(projection: Projection): SessionTranscriptItem[] {
  const transcript: SessionTranscriptItem[] = [];
  for (let offset = 0; offset < projection.transcriptSize; offset += 1) {
    const item =
      projection.transcript[
        (projection.transcriptHead + offset) % MAX_SESSION_TRANSCRIPT_ITEMS
      ];
    if (item !== undefined) {
      transcript.push(item);
    }
  }
  return transcript;
}

function boundedIdentity(value: unknown, fallback: number): string {
  if (typeof value !== 'string' || value.length === 0) {
    return `index:${fallback}`;
  }
  if (value.length <= MAX_IDENTITY_SOURCE_LENGTH) {
    return value;
  }
  const half = MAX_IDENTITY_SOURCE_LENGTH / 2;
  return `${value.slice(0, half)}:${value.length}:${value.slice(-half)}`;
}

function sanitizeToolName(value: string): string {
  return value
    .slice(0, MAX_TOOL_NAME_LENGTH * 4)
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TOOL_NAME_LENGTH)
    .trim();
}
