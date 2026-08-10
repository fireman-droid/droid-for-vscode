import {
  MAX_ASSISTANT_TEXT_LENGTH,
  MAX_SESSION_TRANSCRIPT_ITEMS,
  MAX_THINKING_TEXT_LENGTH,
  MAX_TOOL_ACTIVITIES_PER_TURN,
  MAX_TOOL_NAME_LENGTH,
  MAX_TURN_TEXT_LENGTH,
  type AssistantDeltaMessage,
  type RuntimeDiagnosticMessage,
  type SessionHistoryStatus,
  type SessionTranscriptItem,
  type ThinkingCompleteMessage,
  type ThinkingDeltaMessage,
  type ToolActivityMessage,
  type TurnStateMessage,
} from '../shared/bridgeMessages';
import {
  stableTranscriptId,
  type HostTranscriptState,
} from '../shared/hostTranscriptState';

export {
  stableTranscriptId,
  type HostTranscriptState,
} from '../shared/hostTranscriptState';

export const MAX_HOST_TRANSCRIPT_DIAGNOSTICS = 50;

export type HostTranscriptProjectionMessage =
  | AssistantDeltaMessage
  | ThinkingDeltaMessage
  | ThinkingCompleteMessage
  | ToolActivityMessage
  | RuntimeDiagnosticMessage
  | TurnStateMessage;

const TERMINAL_TURN_STATUSES = new Set([
  'completed',
  'interrupted',
  'failed',
]);

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
  const historyStatus =
    state.historyStatus === 'complete'
      ? state.transcript.length > 0
        ? 'partial'
        : 'unavailable'
      : state.historyStatus;
  const hydrated = boundState({
    transcript: state.transcript.map(normalizeRestartItem),
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
): HostTranscriptState {
  const boundedText = text.slice(0, MAX_TURN_TEXT_LENGTH);
  return appendItem(
    state,
    {
      id: stableTranscriptId('user', turnId),
      kind: 'user',
      text: boundedText,
    },
    text.length > boundedText.length,
  );
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
    case 'runtime.diagnostic': {
      const code = message.code.slice(0, MAX_TURN_TEXT_LENGTH);
      const diagnosticMessage = message.message.slice(
        0,
        MAX_TURN_TEXT_LENGTH,
      );
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
        },
        message.code === 'assistant-output-truncated' ||
          code.length < message.code.length ||
          diagnosticMessage.length < message.message.length,
      );
    }
    case 'turn.state':
      if (message.status === 'stopping') {
        return updateTurnActivityStatuses(
          state,
          message.turnId,
          'stopping',
        );
      }
      if (TERMINAL_TURN_STATUSES.has(message.status)) {
        return updateTurnActivityStatuses(
          state,
          message.turnId,
          'stopped',
        );
      }
      return state;
  }
}

function projectAssistantDelta(
  state: HostTranscriptState,
  message: AssistantDeltaMessage,
): HostTranscriptState {
  const id = stableTranscriptId('assistant', message.turnId);
  const existingIndex = state.transcript.findIndex(
    (item) => item.id === id && item.kind === 'assistant',
  );
  if (existingIndex < 0) {
    const text = message.delta.slice(0, MAX_ASSISTANT_TEXT_LENGTH);
    return appendItem(
      state,
      {
        id,
        kind: 'assistant',
        turnId: message.turnId,
        text,
      },
      text.length < message.delta.length,
    );
  }

  const existing = state.transcript[existingIndex] as Extract<
    SessionTranscriptItem,
    { kind: 'assistant' }
  >;
  const text = `${existing.text}${message.delta}`.slice(
    0,
    MAX_ASSISTANT_TEXT_LENGTH,
  );
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
  const id = stableTranscriptId('thinking', message.turnId);
  const existingIndex = state.transcript.findIndex(
    (item) => item.id === id && item.kind === 'thinking',
  );
  if (existingIndex < 0) {
    const text = message.delta.slice(0, MAX_THINKING_TEXT_LENGTH);
    return appendItem(
      state,
      {
        id,
        kind: 'thinking',
        turnId: message.turnId,
        text,
        status: 'active',
        truncated:
          message.truncated || text.length < message.delta.length,
      },
      message.truncated || text.length < message.delta.length,
    );
  }

  const existing = state.transcript[existingIndex] as Extract<
    SessionTranscriptItem,
    { kind: 'thinking' }
  >;
  const text = `${existing.text}${message.delta}`.slice(
    0,
    MAX_THINKING_TEXT_LENGTH,
  );
  const clipped =
    text.length < existing.text.length + message.delta.length;
  return replaceItem(
    state,
    existingIndex,
    {
      ...existing,
      text,
      status: 'active',
      truncated: existing.truncated || message.truncated || clipped,
    },
    message.truncated || clipped,
  );
}

function projectThinkingComplete(
  state: HostTranscriptState,
  message: ThinkingCompleteMessage,
): HostTranscriptState {
  const id = stableTranscriptId('thinking', message.turnId);
  const existingIndex = state.transcript.findIndex(
    (item) => item.id === id && item.kind === 'thinking',
  );
  const duration =
    message.durationMs === null ? {} : { durationMs: message.durationMs };
  if (existingIndex < 0) {
    return appendItem(state, {
      id,
      kind: 'thinking',
      turnId: message.turnId,
      text: '',
      status: 'complete',
      ...duration,
      truncated: false,
    });
  }

  const existing = state.transcript[existingIndex] as Extract<
    SessionTranscriptItem,
    { kind: 'thinking' }
  >;
  return replaceItem(state, existingIndex, {
    ...existing,
    status: 'complete',
    ...duration,
  });
}

function projectToolActivity(
  state: HostTranscriptState,
  message: ToolActivityMessage,
): HostTranscriptState {
  const id = stableTranscriptId(
    'tool',
    message.turnId,
    message.toolUseId,
  );
  const existingIndex = state.transcript.findIndex(
    (item) => item.id === id && item.kind === 'tool',
  );
  const toolName = message.toolName.slice(0, MAX_TOOL_NAME_LENGTH);
  if (toolName.length === 0) {
    return state;
  }
  if (existingIndex >= 0) {
    const existing = state.transcript[existingIndex] as Extract<
      SessionTranscriptItem,
      { kind: 'tool' }
    >;
    return replaceItem(state, existingIndex, {
      ...existing,
      toolName,
      status: message.status,
    });
  }

  const toolCount = state.transcript.filter(
    (item) =>
      item.kind === 'tool' && item.turnId === message.turnId,
  ).length;
  if (toolCount >= MAX_TOOL_ACTIVITIES_PER_TURN) {
    return markTruncated(state);
  }

  return appendItem(state, {
    id,
    kind: 'tool',
    turnId: message.turnId,
    toolUseId: message.toolUseId,
    toolName,
    status: message.status,
  });
}

function updateTurnActivityStatuses(
  state: HostTranscriptState,
  turnId: string,
  status: 'stopping' | 'stopped',
): HostTranscriptState {
  let changed = false;
  const transcript = state.transcript.map((item) => {
    if (
      (item.kind !== 'thinking' && item.kind !== 'tool') ||
      item.turnId !== turnId
    ) {
      return item;
    }
    if (
      item.kind === 'thinking' &&
      (item.status === 'active' || item.status === 'stopping')
    ) {
      changed = item.status !== status;
      return { ...item, status };
    }
    if (
      item.kind === 'tool' &&
      (item.status === 'running' || item.status === 'stopping')
    ) {
      changed = item.status !== status;
      return { ...item, status };
    }
    return item;
  });
  return changed ? { ...state, transcript } : state;
}

function normalizeRestartItem(
  item: SessionTranscriptItem,
): SessionTranscriptItem {
  if (
    item.kind === 'thinking' &&
    (item.status === 'active' || item.status === 'stopping')
  ) {
    return { ...item, status: 'stopped' };
  }
  if (
    item.kind === 'tool' &&
    (item.status === 'running' || item.status === 'stopping')
  ) {
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
    historyStatus: observedHistoryStatus(
      state.historyStatus,
      transcript.length,
    ),
    truncated: state.truncated || clipped,
  });
}

function boundState(state: HostTranscriptState): HostTranscriptState {
  const diagnosticCount = state.transcript.reduce(
    (count, item) =>
      item.kind === 'diagnostic' ? count + 1 : count,
    0,
  );
  let diagnosticsToEvict = Math.max(
    0,
    diagnosticCount - MAX_HOST_TRANSCRIPT_DIAGNOSTICS,
  );
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
  if (
    transcript.length <= MAX_SESSION_TRANSCRIPT_ITEMS &&
    !diagnosticsEvicted &&
    !state.truncated
  ) {
    return state;
  }

  const transcriptItemsEvicted =
    transcript.length > MAX_SESSION_TRANSCRIPT_ITEMS;
  transcript = transcriptItemsEvicted
    ? transcript.slice(-MAX_SESSION_TRANSCRIPT_ITEMS)
    : transcript;
  const truncated =
    state.truncated || diagnosticsEvicted || transcriptItemsEvicted;
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
  return historyStatus === 'unavailable' && itemCount > 0
    ? 'partial'
    : historyStatus;
}
