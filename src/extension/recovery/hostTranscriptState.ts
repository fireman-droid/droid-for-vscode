import { type ToolActivityMessage } from '../../shared/bridgeMessages';
import {
  stableTranscriptId,
  type HostTranscriptState,
} from '../../shared/transcript/hostTranscriptState';
import {
  type SentAttachmentSummary,
  type TranscriptImageMessage,
} from '../../shared/protocol/attachments';
import {
  MAX_ASSISTANT_TEXT_LENGTH,
  MAX_CHANGED_FILES_PER_TURN,
  MAX_IMAGES_PER_TURN,
  MAX_THINKING_TEXT_LENGTH,
  MAX_TOOL_ACTIVITIES_PER_TURN,
  MAX_TURN_TEXT_LENGTH,
} from '../../shared/protocol/bounds';
import { type InteractionClosedMessage } from '../../shared/protocol/interactions';
import { type SessionHistoryStatus } from '../../shared/protocol/sessions';
import {
  type AssistantDeltaMessage,
  type ChangedFileSummary,
  type RuntimeDiagnosticMessage,
  type SessionTranscriptItem,
  type SubagentUpdateMessage,
  type ThinkingCompleteMessage,
  type ThinkingDeltaMessage,
} from '../../shared/protocol/transcript';
import { type TurnStateMessage } from '../../shared/protocol/turns';
import {
  hasTrailingDiagnostic,
  updatePendingActivity,
} from '../../shared/transcript/activityUpdates';
import { projectToolFields } from '../../shared/transcript/toolFields';
import {
  enforceTranscriptImageBudget,
  trimTranscriptToLimits,
} from '../../shared/transcript/transcriptLimits';
import { isTransientRuntimeDiagnostic } from '../../shared/protocol/transientDiagnostics';

export {
  stableTranscriptId,
  type HostTranscriptState,
} from '../../shared/transcript/hostTranscriptState';

export const MAX_HOST_TRANSCRIPT_DIAGNOSTICS = 50;

export type HostTranscriptProjectionMessage =
  | AssistantDeltaMessage
  | ThinkingDeltaMessage
  | ThinkingCompleteMessage
  | ToolActivityMessage
  | SubagentUpdateMessage
  | TranscriptImageMessage
  | RuntimeDiagnosticMessage
  | TurnStateMessage
  | InteractionClosedMessage;

const TERMINAL_TURN_STATUSES = new Set(['completed', 'interrupted', 'failed']);

export function createHostTranscriptState(
  historyStatus: SessionHistoryStatus,
): HostTranscriptState {
  return {
    transcript: [],
    historyStatus,
    truncated: false,
  };
}

export function hydrateHostTranscriptState(
  state: HostTranscriptState,
): HostTranscriptState {
  const transcript = state.transcript.filter(
    (item) => item.kind !== 'diagnostic' || !isTransientRuntimeDiagnostic(item.code),
  );
  const historyStatus =
    state.historyStatus === 'complete'
      ? transcript.length > 0
        ? 'partial'
        : 'unavailable'
      : state.historyStatus;
  const hydrated = boundState({
    transcript: transcript.map(normalizeRestartItem),
    historyStatus,
    truncated: state.truncated,
  });
  return hydrated.historyStatus === historyStatus
    ? hydrated
    : { ...hydrated, historyStatus };
}

export function appendAcceptedUserPrompt(
  state: HostTranscriptState,
  turnId: string,
  text: string,
  attachments?: readonly SentAttachmentSummary[],
  timestamp?: number,
): HostTranscriptState {
  const boundedText = text.slice(0, MAX_TURN_TEXT_LENGTH);
  return appendItem(
    state,
    {
      id: stableTranscriptId('user', turnId),
      kind: 'user',
      text: boundedText,
      ...(timestamp === undefined ? {} : { timestamp }),
      ...(attachments !== undefined && attachments.length > 0 ? { attachments } : {}),
    },
    text.length > boundedText.length,
  );
}

/**
 * Adds an already-sanitized user message received outside the main composer,
 * such as a child session's Task invocation.
 */
export function appendExternalUserMessage(
  state: HostTranscriptState,
  id: string,
  text: string,
  messageId?: string,
  timestamp?: number,
): HostTranscriptState {
  if (
    (messageId !== undefined &&
      state.transcript.some(
        (item) => item.kind === 'user' && item.messageId === messageId,
      )) ||
    state.transcript.some((item) => item.id === id)
  ) {
    return state;
  }
  const boundedText = text.slice(0, MAX_TURN_TEXT_LENGTH);
  if (boundedText.length === 0) {
    return state;
  }
  return appendItem(
    state,
    {
      id,
      kind: 'user',
      text: boundedText,
      ...(messageId === undefined ? {} : { messageId }),
      ...(timestamp === undefined ? {} : { timestamp }),
    },
    boundedText.length < text.length,
  );
}

export function attachUserMessageId(
  state: HostTranscriptState,
  turnId: string,
  messageId: string,
): HostTranscriptState {
  const id = stableTranscriptId('user', turnId);
  const index = state.transcript.findIndex(
    (item) => item.kind === 'user' && item.id === id,
  );
  if (index < 0) {
    return state;
  }
  const existing = state.transcript[index] as Extract<
    SessionTranscriptItem,
    { kind: 'user' }
  >;
  if (existing.messageId === messageId) {
    return state;
  }
  return replaceItem(state, index, { ...existing, messageId });
}

/**
 * Drops the user item carrying `messageId` and everything after it,
 * mirroring an SDK rewind to that message. Returns null when the
 * message is not part of the transcript.
 */
export function truncateFromUserMessage(
  state: HostTranscriptState,
  messageId: string,
): HostTranscriptState | null {
  const index = state.transcript.findIndex(
    (item) => item.kind === 'user' && item.messageId === messageId,
  );
  if (index < 0) {
    return null;
  }
  return {
    transcript: state.transcript.slice(0, index),
    historyStatus: state.historyStatus,
    truncated: state.truncated,
  };
}

/**
 * Reconciles the per-turn changed-files summary in place. Live
 * frames refresh the current rows and settlement replaces them with
 * the authoritative list. An empty settlement remains explicitly
 * present so it is durable canonical truth rather than legacy absence.
 */
export function reconcileTurnChanges(
  state: HostTranscriptState,
  turnId: string,
  files: readonly ChangedFileSummary[],
  writing = false,
): HostTranscriptState {
  const id = stableTranscriptId('changes', turnId);
  const index = state.transcript.findIndex((item) => item.id === id);
  const nextFiles = files.slice(0, MAX_CHANGED_FILES_PER_TURN);
  const nextItem: SessionTranscriptItem = {
    id,
    kind: 'changes',
    turnId,
    files: nextFiles,
    ...(writing ? { writing: true } : {}),
  };
  if (index < 0) {
    return appendItem(state, nextItem);
  }
  const existing = state.transcript[index];
  if (
    existing?.kind === 'changes' &&
    existing.files.length === nextFiles.length &&
    existing.files.every((file, fileIndex) => {
      const next = nextFiles[fileIndex];
      return (
        next !== undefined &&
        file.path === next.path &&
        file.additions === next.additions &&
        file.deletions === next.deletions
      );
    }) &&
    (existing.writing === true) === writing
  ) {
    return state;
  }
  return replaceItem(state, index, nextItem);
}

export function projectHostTranscriptMessage(
  state: HostTranscriptState,
  message: HostTranscriptProjectionMessage,
): HostTranscriptState {
  switch (message.type) {
    case 'assistant.delta':
      return projectAssistantDelta(state, message);
    case 'thinking.delta':
      return projectThinkingDelta(state, message);
    case 'thinking.complete':
      return projectThinkingComplete(state, message);
    case 'tool.activity':
      return projectToolActivity(state, message);
    case 'subagent.update':
      return projectSubagentUpdate(state, message);
    case 'transcript.image':
      return projectTranscriptImage(state, message);
    case 'runtime.diagnostic': {
      if (isTransientRuntimeDiagnostic(message.code)) {
        return state;
      }
      const code = message.code.slice(0, MAX_TURN_TEXT_LENGTH);
      const diagnosticMessage = message.message.slice(0, MAX_TURN_TEXT_LENGTH);
      if (
        hasTrailingDiagnostic(state.transcript, {
          turnId: message.turnId,
          severity: message.severity,
          code,
          message: diagnosticMessage,
        })
      ) {
        return state;
      }
      return appendItem(
        state,
        {
          id: stableTranscriptId(
            'diagnostic',
            String(message.sequence),
            message.turnId ?? '',
          ),
          kind: 'diagnostic',
          turnId: message.turnId,
          severity: message.severity,
          code,
          message: diagnosticMessage,
          ...(message.relatedSessionId === undefined
            ? {}
            : { relatedSessionId: message.relatedSessionId }),
        },
        message.code === 'assistant-output-truncated' ||
          code.length < message.code.length ||
          diagnosticMessage.length < message.message.length,
      );
    }
    case 'interaction.closed': {
      if (message.result === undefined) {
        return state;
      }
      const id = stableTranscriptId('ask-user-result', message.turnId, message.requestId);
      if (state.transcript.some((item) => item.id === id)) {
        return state;
      }
      return appendItem(
        state,
        message.result.status === 'cancelled'
          ? {
              id,
              kind: 'ask-user-result',
              turnId: message.turnId,
              status: 'cancelled',
            }
          : {
              id,
              kind: 'ask-user-result',
              turnId: message.turnId,
              status: 'answered',
              answers: message.result.answers,
            },
      );
    }
    case 'turn.state':
      if (message.status === 'stopping') {
        return updateTurnActivityStatuses(state, message.turnId, 'stopping');
      }
      if (TERMINAL_TURN_STATUSES.has(message.status)) {
        return updateTurnActivityStatuses(state, message.turnId, 'stopped');
      }
      return state;
  }
}

function projectAssistantDelta(
  state: HostTranscriptState,
  message: AssistantDeltaMessage,
): HostTranscriptState {
  const existingIndex = findLastTurnItemIndex(state.transcript, message.turnId);
  const existing = state.transcript[existingIndex];
  if (existing?.kind !== 'assistant') {
    const text = message.delta.slice(0, MAX_ASSISTANT_TEXT_LENGTH);
    return appendItem(
      state,
      {
        id: nextTurnSegmentId(state, 'assistant', message.turnId),
        kind: 'assistant',
        turnId: message.turnId,
        text,
        ...(message.timestamp === undefined ? {} : { timestamp: message.timestamp }),
      },
      text.length < message.delta.length,
    );
  }

  const text = `${existing.text}${message.delta}`.slice(0, MAX_ASSISTANT_TEXT_LENGTH);
  return replaceItem(
    state,
    existingIndex,
    { ...existing, text },
    text.length < existing.text.length + message.delta.length,
  );
}

function projectThinkingDelta(
  state: HostTranscriptState,
  message: ThinkingDeltaMessage,
): HostTranscriptState {
  const id = thinkingSegmentId(message.turnId, message.segmentIndex);
  const existingIndex = state.transcript.findIndex((item) => item.id === id);
  const existing = state.transcript[existingIndex];
  if (existing?.kind !== 'thinking') {
    const text = message.delta.slice(0, MAX_THINKING_TEXT_LENGTH);
    return appendItem(
      state,
      {
        id,
        kind: 'thinking',
        turnId: message.turnId,
        text,
        status: 'active',
        truncated: message.truncated || text.length < message.delta.length,
      },
      message.truncated || text.length < message.delta.length,
    );
  }

  const text = `${existing.text}${message.delta}`.slice(0, MAX_THINKING_TEXT_LENGTH);
  const clipped = text.length < existing.text.length + message.delta.length;
  return replaceItem(
    state,
    existingIndex,
    {
      ...existing,
      text,
      truncated: existing.truncated || message.truncated || clipped,
    },
    message.truncated || clipped,
  );
}

function projectThinkingComplete(
  state: HostTranscriptState,
  message: ThinkingCompleteMessage,
): HostTranscriptState {
  const id = thinkingSegmentId(message.turnId, message.segmentIndex);
  const index = state.transcript.findIndex((item) => item.id === id);
  const existing = state.transcript[index];
  if (existing?.kind !== 'thinking') {
    // The host only completes segments that projected text, so an
    // unknown segment never fabricates an empty Thinking row.
    return state;
  }
  const durationMs =
    message.durationMs === null ? existing.durationMs : message.durationMs;
  if (existing.status === 'complete' && existing.durationMs === durationMs) {
    return state;
  }
  return replaceItem(state, index, {
    ...existing,
    status: 'complete',
    ...(durationMs === undefined ? {} : { durationMs }),
  });
}

function projectToolActivity(
  state: HostTranscriptState,
  message: ToolActivityMessage,
): HostTranscriptState {
  const id = stableTranscriptId('tool', message.turnId, message.toolUseId);
  const index = state.transcript.findIndex(
    (item) => item.id === id && item.kind === 'tool',
  );
  const existing = state.transcript[index];
  const fields = projectToolFields(
    message,
    existing?.kind === 'tool' ? existing : undefined,
  );
  if (fields.toolName.length === 0 || fields.action.length === 0) return state;
  if (existing?.kind === 'tool') {
    return replaceItem(state, index, { ...existing, ...fields });
  }
  const count = state.transcript.filter(
    (item) => item.kind === 'tool' && item.turnId === message.turnId,
  ).length;
  if (count >= MAX_TOOL_ACTIVITIES_PER_TURN) return markTruncated(state);
  return appendItem(state, { id, kind: 'tool', ...fields });
}

/**
 * Applies an out-of-band subagent settlement to the stored tool row
 * so snapshots and recovery checkpoints stay consistent with what
 * the webview shows. Never appends: a settlement addresses a row
 * that already exists, and never touches anything but `subagent`.
 */
function projectSubagentUpdate(
  state: HostTranscriptState,
  message: SubagentUpdateMessage,
): HostTranscriptState {
  const id = stableTranscriptId('tool', message.turnId, message.toolUseId);
  const existingIndex = state.transcript.findIndex(
    (item) => item.id === id && item.kind === 'tool',
  );
  const existing = state.transcript[existingIndex];
  if (
    existing === undefined ||
    existing.kind !== 'tool' ||
    existing.subagent === undefined
  ) {
    return state;
  }
  return replaceItem(state, existingIndex, {
    ...existing,
    subagent: message.subagent,
  });
}

function projectTranscriptImage(
  state: HostTranscriptState,
  message: TranscriptImageMessage,
): HostTranscriptState {
  const item = message.item;
  if (
    item.turnId !== message.turnId ||
    state.transcript.some((existing) => existing.id === item.id)
  ) {
    return state;
  }
  const imageCount = state.transcript.filter(
    (existing) => existing.kind === 'image' && existing.turnId === message.turnId,
  ).length;
  if (imageCount >= MAX_IMAGES_PER_TURN) {
    return markTruncated(state);
  }
  return appendItem(state, item);
}

function findLastTurnItemIndex(
  transcript: readonly SessionTranscriptItem[],
  turnId: string,
): number {
  for (let index = transcript.length - 1; index >= 0; index -= 1) {
    const item = transcript[index];
    if (item !== undefined && 'turnId' in item && item.turnId === turnId) {
      return index;
    }
  }
  return -1;
}

function nextTurnSegmentId(
  state: HostTranscriptState,
  kind: 'assistant' | 'thinking',
  turnId: string,
): string {
  const segmentCount = state.transcript.filter(
    (item) => item.kind === kind && item.turnId === turnId,
  ).length;
  return segmentCount === 0
    ? stableTranscriptId(kind, turnId)
    : stableTranscriptId(kind, turnId, String(segmentCount));
}

/**
 * Stable per-segment thinking id derived from the bridge
 * segmentIndex. Segment 0 keeps the historical single-block id so
 * recovered checkpoints written before segmentation keep matching.
 */
function thinkingSegmentId(turnId: string, segmentIndex: number): string {
  return segmentIndex === 0
    ? stableTranscriptId('thinking', turnId)
    : stableTranscriptId('thinking', turnId, String(segmentIndex));
}

function updateTurnActivityStatuses(
  state: HostTranscriptState,
  turnId: string,
  status: 'stopping' | 'stopped',
): HostTranscriptState {
  let changed = false;
  const transcript = state.transcript.map((item) => {
    const next = updatePendingActivity(item, turnId, status);
    changed ||= next !== item;
    return next;
  });
  return changed ? { ...state, transcript } : state;
}

function normalizeRestartItem(item: SessionTranscriptItem): SessionTranscriptItem {
  if (
    item.kind === 'thinking' &&
    (item.status === 'active' || item.status === 'stopping')
  ) {
    return { ...item, status: 'stopped' };
  }
  if (item.kind === 'tool' && (item.status === 'running' || item.status === 'stopping')) {
    return { ...item, status: 'stopped' };
  }
  return item;
}

function appendItem(
  state: HostTranscriptState,
  item: SessionTranscriptItem,
  clipped = false,
): HostTranscriptState {
  return boundState({
    transcript: [...state.transcript, item],
    historyStatus: observedHistoryStatus(
      state.historyStatus,
      state.transcript.length + 1,
    ),
    truncated: state.truncated || clipped,
  });
}

function replaceItem(
  state: HostTranscriptState,
  index: number,
  item: SessionTranscriptItem,
  clipped = false,
): HostTranscriptState {
  const transcript = [...state.transcript];
  transcript[index] = item;
  return boundState({
    transcript,
    historyStatus: observedHistoryStatus(state.historyStatus, transcript.length),
    truncated: state.truncated || clipped,
  });
}

function boundState(state: HostTranscriptState): HostTranscriptState {
  const diagnosticCount = state.transcript.reduce(
    (count, item) => (item.kind === 'diagnostic' ? count + 1 : count),
    0,
  );
  let diagnosticsToEvict = Math.max(0, diagnosticCount - MAX_HOST_TRANSCRIPT_DIAGNOSTICS);
  const diagnosticsEvicted = diagnosticsToEvict > 0;
  let transcript = diagnosticsEvicted
    ? state.transcript.filter((item) => {
        if (item.kind !== 'diagnostic' || diagnosticsToEvict === 0) {
          return true;
        }
        diagnosticsToEvict -= 1;
        return false;
      })
    : state.transcript;
  const bounded = trimTranscriptToLimits(transcript);
  // Image byte eviction keeps placeholder rows in place, so it does
  // not mark the transcript truncated or partial by itself.
  const imageBudget = enforceTranscriptImageBudget(bounded.transcript);
  if (
    bounded.transcript === transcript &&
    !diagnosticsEvicted &&
    !imageBudget.evicted &&
    !state.truncated
  ) {
    return state;
  }

  transcript = [...imageBudget.transcript];
  const truncated = state.truncated || diagnosticsEvicted || bounded.trimmed;
  return {
    transcript,
    historyStatus: truncated ? 'partial' : state.historyStatus,
    truncated,
  };
}

function markTruncated(state: HostTranscriptState): HostTranscriptState {
  if (state.truncated && state.historyStatus === 'partial') {
    return state;
  }
  return { ...state, historyStatus: 'partial', truncated: true };
}

function observedHistoryStatus(
  historyStatus: SessionHistoryStatus,
  itemCount: number,
): SessionHistoryStatus {
  return historyStatus === 'unavailable' && itemCount > 0 ? 'partial' : historyStatus;
}
