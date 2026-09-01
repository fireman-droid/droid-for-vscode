import {
  MAX_SESSION_TRANSCRIPT_ITEMS,
  MAX_TURN_TEXT_LENGTH,
  SESSION_HISTORY_STATUSES,
  TURN_STATUSES,
  type ChangedFileSummary,
  type ImageMediaType,
  type SessionHistoryStatus,
  type SessionTranscriptItem,
  type TurnStatus,
} from '../shared/bridgeMessages';
import { MAX_QUEUED_MESSAGES } from '../shared/queueProtocol';
import {
  hasExactKeys,
  isExactArray,
  isStrictRecord,
} from '../shared/strictValidation';
import {
  MAX_SESSION_TRANSCRIPT_TEXT_UNITS,
  transcriptItemTextUnits,
} from '../shared/transcriptLimits';
import {
  hydrateHostTranscriptState,
  type HostTranscriptState,
} from './hostTranscriptState';
import {
  dataValue,
  isId,
  isOneOf,
  parseTranscriptItem,
} from './sessionRecoveryItems';
import {
  CONVERSATION_RECOVERY_VERSION,
  LEGACY_SESSION_RECOVERY_VERSION,
  MAX_CONVERSATION_NODES,
  MAX_CONVERSATION_OPERATIONS,
  MAX_CONVERSATION_TURNS,
  MAX_RECOVERY_CONVERSATIONS,
  SESSION_LINEAGE_RELATIONS,
  cloneConversation,
  createDisplaySnapshot,
  createRootConversation,
  type ConversationDisplaySnapshot,
  type ConversationImageArtifact,
  type ConversationOperation,
  type ConversationRecoveryRecord,
  type ConversationSessionNode,
  type ConversationTurnRecord,
  type SessionLineageRelation,
} from './conversationRecoveryState';

export const MAX_RECOVERY_TEXT_UNITS =
  MAX_SESSION_TRANSCRIPT_TEXT_UNITS;

export interface ParsedConversationRecoveryState {
  readonly selectedConversationId: string | null;
  readonly conversations: readonly ConversationRecoveryRecord[];
}

export function parseConversationRecoveryState(
  value: unknown,
): ParsedConversationRecoveryState | undefined {
  try {
    if (!isStrictRecord(value)) {
      return undefined;
    }
    const version = dataValue(value, 'version');
    if (version === CONVERSATION_RECOVERY_VERSION) {
      return parseV2(value);
    }
    if (version === LEGACY_SESSION_RECOVERY_VERSION) {
      return parseV1(value);
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export function parseRecoveryTranscript(
  value: unknown,
): HostTranscriptState | undefined {
  if (
    !isStrictRecord(value) ||
    !hasExactKeys(value, [
      'transcript',
      'historyStatus',
      'truncated',
    ])
  ) {
    return undefined;
  }
  const transcriptValue = dataValue(value, 'transcript');
  const historyStatus = dataValue(value, 'historyStatus');
  const truncated = dataValue(value, 'truncated');
  if (
    !isExactArray(
      transcriptValue,
      0,
      MAX_SESSION_TRANSCRIPT_ITEMS,
    ) ||
    !isOneOf(historyStatus, SESSION_HISTORY_STATUSES) ||
    typeof truncated !== 'boolean'
  ) {
    return undefined;
  }
  const transcript: SessionTranscriptItem[] = [];
  const ids = new Set<string>();
  for (let index = 0; index < transcriptValue.length; index += 1) {
    const item = parseTranscriptItem(
      dataValue(transcriptValue, String(index)),
    );
    if (item === undefined || ids.has(item.id)) {
      return undefined;
    }
    ids.add(item.id);
    transcript.push(item);
  }
  if (
    historyStatus === 'unavailable' &&
    (transcript.length > 0 || truncated)
  ) {
    return undefined;
  }
  return { transcript, historyStatus, truncated };
}

function parseV2(
  value: Record<string, unknown>,
): ParsedConversationRecoveryState | undefined {
  if (
    !hasExactKeys(value, [
      'version',
      'selectedConversationId',
      'conversations',
    ])
  ) {
    return undefined;
  }
  const selected = dataValue(value, 'selectedConversationId');
  const conversationsValue = dataValue(value, 'conversations');
  if (
    (selected !== null && !isId(selected)) ||
    !isExactArray(
      conversationsValue,
      0,
      MAX_RECOVERY_CONVERSATIONS,
    )
  ) {
    return undefined;
  }
  const conversations: ConversationRecoveryRecord[] = [];
  const conversationIds = new Set<string>();
  const sessionIds = new Set<string>();
  for (let index = 0; index < conversationsValue.length; index += 1) {
    const conversation = parseConversation(
      dataValue(conversationsValue, String(index)),
    );
    if (
      conversation === undefined ||
      conversationIds.has(conversation.conversationId) ||
      conversation.nodes.some((node) => sessionIds.has(node.sessionId))
    ) {
      continue;
    }
    conversationIds.add(conversation.conversationId);
    conversation.nodes.forEach((node) => sessionIds.add(node.sessionId));
    conversations.push(conversation);
  }
  if (recoveryTextUnits(conversations, selected) > MAX_RECOVERY_TEXT_UNITS) {
    return undefined;
  }
  return {
    selectedConversationId:
      selected !== null && conversationIds.has(selected)
        ? selected
        : null,
    conversations,
  };
}

function parseV1(
  value: Record<string, unknown>,
): ParsedConversationRecoveryState | undefined {
  if (
    !hasExactKeys(value, [
      'version',
      'selectedSessionId',
      'sessions',
    ])
  ) {
    return undefined;
  }
  const selectedSessionId = dataValue(value, 'selectedSessionId');
  const sessionsValue = dataValue(value, 'sessions');
  if (
    (selectedSessionId !== null && !isId(selectedSessionId)) ||
    !isExactArray(sessionsValue, 0, MAX_RECOVERY_CONVERSATIONS)
  ) {
    return undefined;
  }
  const conversations: ConversationRecoveryRecord[] = [];
  const ids = new Set<string>();
  for (let index = 0; index < sessionsValue.length; index += 1) {
    const stored = parseLegacySession(
      dataValue(sessionsValue, String(index)),
    );
    if (stored === undefined || ids.has(stored.sessionId)) {
      continue;
    }
    ids.add(stored.sessionId);
    conversations.push(
      createRootConversation(
        stored.sessionId,
        hydrateHostTranscriptState(stored.transcript),
        stored.lastAccess,
        stored.queuedTexts,
      ),
    );
  }
  if (
    recoveryTextUnits(conversations, selectedSessionId) >
    MAX_RECOVERY_TEXT_UNITS
  ) {
    return undefined;
  }
  return {
    selectedConversationId:
      selectedSessionId !== null && ids.has(selectedSessionId)
        ? selectedSessionId
        : null,
    conversations,
  };
}

function parseConversation(
  value: unknown,
): ConversationRecoveryRecord | undefined {
  if (
    !isStrictRecord(value) ||
    !hasExactKeys(value, [
      'conversationId',
      'activeSessionId',
      'lastAccess',
      'display',
      'nodes',
      'turns',
      'operations',
      'queuedTexts',
    ])
  ) {
    return undefined;
  }
  const conversationId = dataValue(value, 'conversationId');
  const activeSessionId = dataValue(value, 'activeSessionId');
  const lastAccess = dataValue(value, 'lastAccess');
  const display = parseDisplay(dataValue(value, 'display'));
  const nodesValue = dataValue(value, 'nodes');
  const turnsValue = dataValue(value, 'turns');
  const operationsValue = dataValue(value, 'operations');
  const queuedTextsValue = dataValue(value, 'queuedTexts');
  if (
    !isId(conversationId) ||
    !isId(activeSessionId) ||
    !isNonNegativeSafeInteger(lastAccess) ||
    display === undefined ||
    !isExactArray(nodesValue, 1, MAX_CONVERSATION_NODES) ||
    !isExactArray(turnsValue, 0, MAX_CONVERSATION_TURNS) ||
    !isExactArray(
      operationsValue,
      0,
      MAX_CONVERSATION_OPERATIONS,
    ) ||
    !isExactArray(queuedTextsValue, 0, MAX_QUEUED_MESSAGES)
  ) {
    return undefined;
  }
  const nodes = parseUniqueArray(nodesValue, parseNode, (node) => node.sessionId);
  const turns = parseUniqueArray(turnsValue, parseTurn, (turn) => turn.turnId);
  const operations = parseOperations(operationsValue);
  if (
    nodes === undefined ||
    turns === undefined ||
    operations === undefined ||
    !nodes.some((node) => node.sessionId === activeSessionId) ||
    nodes.some((node) => node.checkpointRevision > display.revision) ||
    turns.some(
      (turn) =>
        turn.firstRevision > turn.lastRevision ||
        turn.lastRevision > display.revision ||
        !nodes.some((node) => node.sessionId === turn.sessionId),
    )
  ) {
    return undefined;
  }
  return cloneConversation({
    conversationId,
    activeSessionId,
    lastAccess,
    display,
    nodes,
    turns,
    operations,
    queuedTexts: sanitizeQueuedTexts(queuedTextsValue),
  });
}

function parseDisplay(
  value: unknown,
): ConversationDisplaySnapshot | undefined {
  if (
    !isStrictRecord(value) ||
    !hasExactKeys(value, [
      'transcript',
      'turn',
      'revision',
      'images',
    ])
  ) {
    return undefined;
  }
  const transcript = parseRecoveryTranscript(
    dataValue(value, 'transcript'),
  );
  const turnValue = dataValue(value, 'turn');
  const turn = turnValue === null ? null : parseDisplayTurn(turnValue);
  const revision = dataValue(value, 'revision');
  const imagesValue = dataValue(value, 'images');
  const images = isExactArray(imagesValue, 0, 64)
    ? parseUniqueArray(
        imagesValue,
        parseImageArtifact,
        (image) => image.itemId,
      )
    : undefined;
  return transcript === undefined ||
    (turnValue !== null && turn === undefined) ||
    !isPositiveSafeInteger(revision) ||
    images === undefined ||
    images.some(
      (image) =>
        !transcript.transcript.some(
          (item) =>
            item.kind === 'image' &&
            item.id === image.itemId &&
            item.mediaType === image.mediaType &&
            item.byteLength === image.byteLength,
        ),
    )
    ? undefined
    : createDisplaySnapshot(transcript, turn, revision, images);
}

function parseImageArtifact(
  value: unknown,
): ConversationImageArtifact | undefined {
  if (
    !isStrictRecord(value) ||
    !hasExactKeys(value, [
      'itemId',
      'artifactId',
      'mediaType',
      'byteLength',
    ])
  ) {
    return undefined;
  }
  const itemId = dataValue(value, 'itemId');
  const artifactId = dataValue(value, 'artifactId');
  const mediaType = dataValue(value, 'mediaType');
  const byteLength = dataValue(value, 'byteLength');
  return !isId(itemId) ||
    !isUuid(artifactId) ||
    !isImageMediaType(mediaType) ||
    !isNonNegativeSafeInteger(byteLength)
    ? undefined
    : { itemId, artifactId, mediaType, byteLength };
}

function parseDisplayTurn(
  value: unknown,
): NonNullable<ConversationDisplaySnapshot['turn']> | undefined {
  if (
    !isStrictRecord(value) ||
    !hasExactKeys(value, ['turnId', 'status'], ['error'])
  ) {
    return undefined;
  }
  const turnId = dataValue(value, 'turnId');
  const status = dataValue(value, 'status');
  const error = dataValue(value, 'error');
  return !isId(turnId) ||
    !isOneOf(status, TURN_STATUSES) ||
    (error !== undefined && typeof error !== 'string')
    ? undefined
    : {
        turnId,
        status,
        ...(error === undefined ? {} : { error }),
      };
}

function parseNode(value: unknown): ConversationSessionNode | undefined {
  if (
    !isStrictRecord(value) ||
    !hasExactKeys(
      value,
      [
        'sessionId',
        'relation',
        'parentConversationId',
        'parentSessionId',
        'checkpointRevision',
      ],
      ['anchorTurnId'],
    )
  ) {
    return undefined;
  }
  const sessionId = dataValue(value, 'sessionId');
  const relation = dataValue(value, 'relation');
  const parentConversationId = dataValue(value, 'parentConversationId');
  const parentSessionId = dataValue(value, 'parentSessionId');
  const anchorTurnId = dataValue(value, 'anchorTurnId');
  const checkpointRevision = dataValue(value, 'checkpointRevision');
  if (
    !isId(sessionId) ||
    !isOneOf(relation, SESSION_LINEAGE_RELATIONS) ||
    (parentConversationId !== null && !isId(parentConversationId)) ||
    (parentSessionId !== null && !isId(parentSessionId)) ||
    (anchorTurnId !== undefined && !isId(anchorTurnId)) ||
    !isPositiveSafeInteger(checkpointRevision) ||
    (relation === 'root' &&
      (parentConversationId !== null || parentSessionId !== null))
  ) {
    return undefined;
  }
  return {
    sessionId,
    relation,
    parentConversationId,
    parentSessionId,
    ...(anchorTurnId === undefined ? {} : { anchorTurnId }),
    checkpointRevision,
  };
}

function parseTurn(value: unknown): ConversationTurnRecord | undefined {
  if (
    !isStrictRecord(value) ||
    !hasExactKeys(
      value,
      [
        'turnId',
        'sessionId',
        'prompt',
        'status',
        'changesSettled',
        'files',
        'firstRevision',
        'lastRevision',
      ],
      ['messageId'],
    )
  ) {
    return undefined;
  }
  const turnId = dataValue(value, 'turnId');
  const sessionId = dataValue(value, 'sessionId');
  const prompt = dataValue(value, 'prompt');
  const messageId = dataValue(value, 'messageId');
  const status = dataValue(value, 'status');
  const changesSettled = dataValue(value, 'changesSettled');
  const files = parseChangedFiles(dataValue(value, 'files'));
  const firstRevision = dataValue(value, 'firstRevision');
  const lastRevision = dataValue(value, 'lastRevision');
  if (
    !isId(turnId) ||
    !isId(sessionId) ||
    (prompt !== null &&
      (typeof prompt !== 'string' ||
        prompt.length > MAX_TURN_TEXT_LENGTH)) ||
    (messageId !== undefined && !isId(messageId)) ||
    !isOneOf(status, TURN_STATUSES) ||
    typeof changesSettled !== 'boolean' ||
    files === undefined ||
    !isPositiveSafeInteger(firstRevision) ||
    !isPositiveSafeInteger(lastRevision)
  ) {
    return undefined;
  }
  return {
    turnId,
    sessionId,
    prompt,
    ...(messageId === undefined ? {} : { messageId }),
    status,
    changesSettled,
    files,
    firstRevision,
    lastRevision,
  };
}

function parseOperations(
  values: readonly unknown[],
): readonly ConversationOperation[] | undefined {
  const operations: ConversationOperation[] = [];
  let previousSequence = 0;
  for (const value of values) {
    const operation = parseOperation(value);
    if (
      operation === undefined ||
      operation.sequence <= previousSequence
    ) {
      return undefined;
    }
    previousSequence = operation.sequence;
    operations.push(operation);
  }
  return operations;
}

function parseOperation(
  value: unknown,
): ConversationOperation | undefined {
  if (
    !isStrictRecord(value) ||
    !hasExactKeys(
      value,
      ['sequence', 'kind', 'sessionId'],
      ['sourceSessionId', 'turnId'],
    )
  ) {
    return undefined;
  }
  const sequence = dataValue(value, 'sequence');
  const kind = dataValue(value, 'kind');
  const sessionId = dataValue(value, 'sessionId');
  const sourceSessionId = dataValue(value, 'sourceSessionId');
  const turnId = dataValue(value, 'turnId');
  if (
    !isPositiveSafeInteger(sequence) ||
    !isOperationKind(kind) ||
    !isId(sessionId) ||
    (sourceSessionId !== undefined && !isId(sourceSessionId)) ||
    (turnId !== undefined && !isId(turnId))
  ) {
    return undefined;
  }
  return {
    sequence,
    kind,
    sessionId,
    ...(sourceSessionId === undefined ? {} : { sourceSessionId }),
    ...(turnId === undefined ? {} : { turnId }),
  };
}

function isOperationKind(
  value: unknown,
): value is ConversationOperation['kind'] {
  return (
    value === 'turn-settled' ||
    value === 'fork' ||
    value === 'rewind' ||
    value === 'compact' ||
    value === 'handoff'
  );
}

function parseLegacySession(value: unknown):
  | {
      readonly sessionId: string;
      readonly lastAccess: number;
      readonly transcript: HostTranscriptState;
      readonly queuedTexts: readonly string[];
    }
  | undefined {
  if (
    !isStrictRecord(value) ||
    !hasExactKeys(
      value,
      [
        'sessionId',
        'lastAccess',
        'transcript',
        'historyStatus',
        'truncated',
      ],
      ['queuedTexts'],
    )
  ) {
    return undefined;
  }
  const sessionId = dataValue(value, 'sessionId');
  const lastAccess = dataValue(value, 'lastAccess');
  const transcript = parseRecoveryTranscript({
    transcript: dataValue(value, 'transcript'),
    historyStatus: dataValue(value, 'historyStatus'),
    truncated: dataValue(value, 'truncated'),
  });
  const queuedTextsValue = dataValue(value, 'queuedTexts');
  if (
    !isId(sessionId) ||
    !isNonNegativeSafeInteger(lastAccess) ||
    transcript === undefined ||
    (queuedTextsValue !== undefined &&
      !isExactArray(queuedTextsValue, 0, MAX_QUEUED_MESSAGES))
  ) {
    return undefined;
  }
  return {
    sessionId,
    lastAccess,
    transcript,
    queuedTexts:
      queuedTextsValue === undefined
        ? []
        : sanitizeQueuedTexts(queuedTextsValue),
  };
}

function parseChangedFiles(
  value: unknown,
): readonly ChangedFileSummary[] | undefined {
  if (!isExactArray(value, 0, 256)) {
    return undefined;
  }
  const files: ChangedFileSummary[] = [];
  for (const item of value) {
    if (
      !isStrictRecord(item) ||
      !hasExactKeys(item, ['path', 'additions', 'deletions'])
    ) {
      return undefined;
    }
    const path = dataValue(item, 'path');
    const additions = dataValue(item, 'additions');
    const deletions = dataValue(item, 'deletions');
    if (
      typeof path !== 'string' ||
      path.length === 0 ||
      !isNullableNonNegativeSafeInteger(additions) ||
      !isNullableNonNegativeSafeInteger(deletions)
    ) {
      return undefined;
    }
    files.push({ path, additions, deletions });
  }
  return files;
}

function parseUniqueArray<T>(
  values: readonly unknown[],
  parse: (value: unknown) => T | undefined,
  key: (value: T) => string,
): readonly T[] | undefined {
  const result: T[] = [];
  const keys = new Set<string>();
  for (const value of values) {
    const parsed = parse(value);
    if (parsed === undefined || keys.has(key(parsed))) {
      return undefined;
    }
    keys.add(key(parsed));
    result.push(parsed);
  }
  return result;
}

function sanitizeQueuedTexts(
  texts: readonly unknown[],
): readonly string[] {
  const safe: string[] = [];
  for (const text of texts) {
    if (
      safe.length >= MAX_QUEUED_MESSAGES ||
      typeof text !== 'string' ||
      text.length === 0 ||
      text.length > MAX_TURN_TEXT_LENGTH
    ) {
      continue;
    }
    safe.push(text);
  }
  return safe;
}

function recoveryTextUnits(
  conversations: readonly ConversationRecoveryRecord[],
  selectedConversationId: string | null,
): number {
  let total = selectedConversationId?.length ?? 0;
  for (const conversation of conversations) {
    total +=
      conversation.conversationId.length +
      conversation.activeSessionId.length +
      transcriptTextUnits(conversation.display.transcript);
    for (const node of conversation.nodes) {
      total +=
        node.sessionId.length +
        (node.parentConversationId?.length ?? 0) +
        (node.parentSessionId?.length ?? 0) +
        (node.anchorTurnId?.length ?? 0);
    }
    for (const turn of conversation.turns) {
      total +=
        turn.turnId.length +
        turn.sessionId.length +
        (turn.prompt?.length ?? 0) +
        (turn.messageId?.length ?? 0);
      for (const file of turn.files) {
        total += file.path.length;
      }
    }
    total += conversation.queuedTexts.reduce(
      (sum, text) => sum + text.length,
      0,
    );
  }
  return total;
}

function transcriptTextUnits(state: HostTranscriptState): number {
  return (
    state.historyStatus.length +
    state.transcript.reduce(
      (total, item) => total + transcriptItemTextUnits(item),
      0,
    )
  );
}

function isPositiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isNullableNonNegativeSafeInteger(
  value: unknown,
): value is number | null {
  return value === null || isNonNegativeSafeInteger(value);
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

function isImageMediaType(value: unknown): value is ImageMediaType {
  return (
    value === 'image/png' ||
    value === 'image/jpeg' ||
    value === 'image/gif' ||
    value === 'image/webp'
  );
}
