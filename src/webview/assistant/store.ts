import {
  MAX_TOOL_ACTIVITIES_PER_TURN,
  type HostToWebviewMessage,
  type InteractionRequest,
  type ModelCatalogState,
  type SessionContextState,
  type SessionSettingsState,
  type SessionTranscriptItem,
  type TurnStatus,
} from '../../shared/bridgeMessages';
import { trimTranscriptToLimits } from '../../shared/transcriptLimits';
import { stableTranscriptId } from '../../shared/hostTranscriptState';

export interface AssistantTurn {
  readonly turnId: string;
  readonly status: TurnStatus;
  readonly activity?: 'working' | 'responding';
  readonly error?: string;
}

export interface PendingInteraction {
  readonly sessionId: string;
  readonly turnId: string;
  readonly request: InteractionRequest;
}

export interface AssistantWebviewState {
  readonly sequence: number;
  readonly sessionId: string | null;
  readonly connection: Extract<
    HostToWebviewMessage,
    { type: 'host.connection' }
  >['connection'];
  readonly turn: AssistantTurn | null;
  readonly sessions: Extract<
    HostToWebviewMessage,
    { type: 'host.snapshot' }
  >['sessions'];
  readonly settings: SessionSettingsState;
  readonly context: SessionContextState;
  readonly modelCatalog: ModelCatalogState;
  readonly transcript: readonly SessionTranscriptItem[];
  readonly historyStatus: Extract<
    HostToWebviewMessage,
    { type: 'host.snapshot' }
  >['historyStatus'] | null;
  readonly truncated: boolean;
  readonly interactions: readonly PendingInteraction[];
  readonly terminalTurnId: string | null;
}

export type AssistantWebviewAction =
  | {
      readonly type: 'host.message';
      readonly message: HostToWebviewMessage;
    }
  | {
      readonly type: 'turn.send';
      readonly turnId: string;
      readonly text: string;
    }
  | { readonly type: 'turn.stop' };

export const initialAssistantWebviewState: AssistantWebviewState = {
  sequence: -1,
  sessionId: null,
  connection: { status: 'idle' },
  turn: null,
  sessions: { status: 'idle', items: [] },
  settings: { status: 'loading', value: null },
  context: { status: 'loading', value: null },
  modelCatalog: { status: 'loading', items: [] },
  transcript: [],
  historyStatus: null,
  truncated: false,
  interactions: [],
  terminalTurnId: null,
};

const MAX_DIAGNOSTICS = 50;

export function assistantWebviewReducer(
  state: AssistantWebviewState,
  action: AssistantWebviewAction,
): AssistantWebviewState {
  if (action.type === 'turn.send') {
    if (state.sessionId === null || isTurnActive(state.turn)) {
      return state;
    }
    return boundTranscript(
      {
        ...state,
        turn: { turnId: action.turnId, status: 'submitting' },
        terminalTurnId: null,
      },
      [
        ...state.transcript,
        {
          id: `user:${action.turnId}`,
          kind: 'user',
          text: action.text,
        },
      ],
    );
  }

  if (action.type === 'turn.stop') {
    if (
      state.turn === null ||
      (state.turn.status !== 'submitting' &&
        state.turn.status !== 'streaming')
    ) {
      return state;
    }
    return boundTranscript(
      { ...state, turn: { ...state.turn, status: 'stopping' } },
      markActivitiesStopping(state.transcript, state.turn.turnId),
    );
  }

  const event = action.message;
  if (!Number.isFinite(event.sequence) || event.sequence <= state.sequence) {
    return state;
  }

  switch (event.type) {
    case 'host.snapshot':
      return {
        sequence: event.sequence,
        sessionId: event.sessionId,
        connection: event.connection,
        turn:
          event.turn === null
            ? null
            : {
                turnId: event.turn.turnId,
                status: event.turn.status,
                ...(event.turn.error === undefined
                  ? {}
                  : { error: event.turn.error }),
              },
        sessions: event.sessions,
        settings: event.settings,
        context: event.context,
        modelCatalog: event.modelCatalog,
        transcript: event.transcript,
        historyStatus: event.historyStatus,
        truncated: event.truncated,
        interactions: [],
        terminalTurnId:
          event.turn !== null && isTerminalStatus(event.turn.status)
            ? event.turn.turnId
            : null,
      };
    case 'host.connection': {
      const changed = event.sessionId !== state.sessionId;
      return {
        ...state,
        sequence: event.sequence,
        sessionId: event.sessionId,
        connection: event.connection,
        ...(changed
          ? {
              turn: null,
              transcript: [],
              historyStatus: null,
              truncated: false,
              settings: { status: 'loading', value: null },
              context: { status: 'loading', value: null },
              modelCatalog: { status: 'loading', items: [] },
              interactions: [],
              terminalTurnId: null,
            }
          : {}),
      };
    }
    case 'session.settings':
      return event.sessionId === state.sessionId
        ? {
            ...state,
            sequence: event.sequence,
            settings: event.settings,
          }
        : advance(state, event.sequence);
    case 'session.context':
      return event.sessionId === state.sessionId
        ? {
            ...state,
            sequence: event.sequence,
            context: event.context,
          }
        : advance(state, event.sequence);
    case 'session.model-catalog':
      return event.sessionId === state.sessionId
        ? {
            ...state,
            sequence: event.sequence,
            modelCatalog: event.modelCatalog,
          }
        : advance(state, event.sequence);
    case 'assistant.delta':
      if (!acceptsActiveTurn(state, event.sessionId, event.turnId)) {
        return advance(state, event.sequence);
      }
      return boundTranscript(
        {
          ...state,
          sequence: event.sequence,
          turn: {
            ...state.turn,
            status: 'streaming',
            activity: 'responding',
          },
        },
        appendAssistantDelta(
          state.transcript,
          event.turnId,
          event.delta,
          event.sequence,
        ),
      );
    case 'thinking.delta':
      if (!acceptsActiveTurn(state, event.sessionId, event.turnId)) {
        return advance(state, event.sequence);
      }
      return boundTranscript(
        {
          ...state,
          sequence: event.sequence,
          turn: {
            ...state.turn,
            status: 'streaming',
            activity: 'working',
          },
        },
        appendThinkingDelta(
          state.transcript,
          event.turnId,
          event.delta,
          event.truncated,
        ),
      );
    case 'thinking.complete':
      if (!acceptsActiveTurn(state, event.sessionId, event.turnId)) {
        return advance(state, event.sequence);
      }
      return boundTranscript(
        { ...state, sequence: event.sequence },
        state.transcript.map((item) =>
          item.kind === 'thinking' && item.turnId === event.turnId
            ? {
                ...item,
                status: 'complete',
                ...(event.durationMs === null
                  ? {}
                  : { durationMs: event.durationMs }),
              }
            : item,
        ),
      );
    case 'tool.activity':
      if (!acceptsActiveTurn(state, event.sessionId, event.turnId)) {
        return advance(state, event.sequence);
      }
      return boundTranscript(
        {
          ...state,
          sequence: event.sequence,
          turn: {
            ...state.turn,
            status: 'streaming',
            activity: 'working',
          },
        },
        upsertTool(state.transcript, event),
      );
    case 'runtime.diagnostic':
      if (!acceptsDiagnostic(state, event.sessionId, event.turnId)) {
        return advance(state, event.sequence);
      }
      return boundTranscript(
        { ...state, sequence: event.sequence },
        appendDiagnostic(state.transcript, {
          id: `diagnostic:${event.sequence}`,
          kind: 'diagnostic',
          turnId: event.turnId,
          severity: event.severity,
          code: event.code,
          message: event.message,
        }),
      );
    case 'user.message-meta': {
      if (event.sessionId !== state.sessionId) {
        return advance(state, event.sequence);
      }
      // The prompt item id depends on its origin: optimistic sends use
      // `user:<turnId>`, host snapshots use the stable transcript id.
      const promptIds = new Set([
        `user:${event.turnId}`,
        stableTranscriptId('user', event.turnId),
      ]);
      const index = state.transcript.findIndex(
        (item) => item.kind === 'user' && promptIds.has(item.id),
      );
      const item = state.transcript[index];
      if (
        item === undefined ||
        item.kind !== 'user' ||
        item.messageId === event.messageId
      ) {
        return advance(state, event.sequence);
      }
      return {
        ...state,
        sequence: event.sequence,
        transcript: state.transcript.map((entry, entryIndex) =>
          entryIndex === index
            ? { ...item, messageId: event.messageId }
            : entry,
        ),
      };
    }
    case 'turn.state':
      if (event.sessionId !== state.sessionId) {
        return advance(state, event.sequence);
      }
      const turnStateBase: AssistantWebviewState = {
        ...state,
        sequence: event.sequence,
        terminalTurnId: isTerminalStatus(event.status)
          ? event.turnId
          : state.terminalTurnId === event.turnId
            ? state.terminalTurnId
            : null,
        interactions: isTerminalStatus(event.status)
          ? state.interactions.filter(
              (interaction) => interaction.turnId !== event.turnId,
            )
          : state.interactions,
      };
      if (!matchesTurn(state, event.sessionId, event.turnId)) {
        return turnStateBase;
      }
      if (
        (state.turn.status === 'stopping' ||
          isTerminalStatus(state.turn.status)) &&
        !isTerminalStatus(event.status)
      ) {
        return turnStateBase;
      }
      return boundTranscript(
        {
          ...turnStateBase,
          turn: { ...state.turn, status: event.status },
        },
        isTerminalStatus(event.status)
          ? finalizeActivities(
              state.transcript,
              event.turnId,
              event.status,
            )
          : state.transcript,
      );
    case 'turn.error':
      if (event.sessionId !== state.sessionId) {
        return advance(state, event.sequence);
      }
      const turnErrorBase: AssistantWebviewState = {
        ...state,
        sequence: event.sequence,
        terminalTurnId: event.turnId,
        interactions: state.interactions.filter(
          (interaction) => interaction.turnId !== event.turnId,
        ),
      };
      if (!acceptsTurnError(state, event.sessionId, event.turnId)) {
        return turnErrorBase;
      }
      return boundTranscript(
        {
          ...turnErrorBase,
          turn: {
            turnId: event.turnId,
            status: 'failed',
            error: event.message,
          },
        },
        appendDiagnostic(
          finalizeActivities(state.transcript, event.turnId, 'failed'),
          {
            id: `diagnostic:${event.sequence}`,
            kind: 'diagnostic',
            turnId: event.turnId,
            severity: 'error',
            code: event.code,
            message: event.message,
          },
        ),
      );
    case 'interaction.request':
      if (
        event.sessionId !== state.sessionId ||
        event.turnId === state.terminalTurnId ||
        state.interactions.some(
          ({ request }) => request.requestId === event.request.requestId,
        )
      ) {
        return advance(state, event.sequence);
      }
      return {
        ...state,
        sequence: event.sequence,
        interactions: [
          ...state.interactions,
          {
            sessionId: event.sessionId,
            turnId: event.turnId,
            request: event.request,
          },
        ],
      };
    case 'interaction.closed':
      if (event.sessionId !== state.sessionId) {
        return advance(state, event.sequence);
      }
      return {
        ...state,
        sequence: event.sequence,
        interactions: state.interactions.filter(
          ({ request }) => request.requestId !== event.requestId,
        ),
      };
  }
}

export function isTurnActive(turn: AssistantTurn | null): boolean {
  return (
    turn?.status === 'submitting' ||
    turn?.status === 'streaming' ||
    turn?.status === 'stopping'
  );
}

export function hasTurnContent(
  transcript: readonly SessionTranscriptItem[],
  turnId: string,
): boolean {
  return transcript.some(
    (item) =>
      item.kind !== 'user' &&
      item.turnId === turnId &&
      item.kind !== 'diagnostic',
  );
}

function advance(
  state: AssistantWebviewState,
  sequence: number,
): AssistantWebviewState {
  return { ...state, sequence };
}

function boundTranscript(
  state: AssistantWebviewState,
  transcript: readonly SessionTranscriptItem[],
): AssistantWebviewState {
  const bounded = trimTranscriptToLimits(transcript);
  if (!bounded.trimmed) {
    return { ...state, transcript };
  }
  return {
    ...state,
    transcript: bounded.transcript,
    historyStatus: 'partial',
    truncated: true,
  };
}

function matchesTurn(
  state: AssistantWebviewState,
  sessionId: string,
  turnId: string,
): state is AssistantWebviewState & { turn: AssistantTurn } {
  return (
    state.sessionId === sessionId &&
    state.turn !== null &&
    state.turn.turnId === turnId
  );
}

function acceptsActiveTurn(
  state: AssistantWebviewState,
  sessionId: string,
  turnId: string,
): state is AssistantWebviewState & { turn: AssistantTurn } {
  return (
    matchesTurn(state, sessionId, turnId) &&
    (state.turn.status === 'submitting' ||
      state.turn.status === 'streaming')
  );
}

function acceptsTurnError(
  state: AssistantWebviewState,
  sessionId: string,
  turnId: string,
): state is AssistantWebviewState & { turn: AssistantTurn } {
  return (
    matchesTurn(state, sessionId, turnId) &&
    (state.turn.status === 'submitting' ||
      state.turn.status === 'streaming' ||
      state.turn.status === 'stopping')
  );
}

function acceptsDiagnostic(
  state: AssistantWebviewState,
  sessionId: string | null,
  turnId: string | null,
): boolean {
  if (sessionId !== null && sessionId !== state.sessionId) {
    return false;
  }
  if (turnId === null) {
    return true;
  }
  return (
    state.turn?.turnId === turnId &&
    state.turn.status !== 'stopping' &&
    state.turn.status !== 'interrupted'
  );
}

function isTerminalStatus(
  status: TurnStatus,
): status is 'completed' | 'interrupted' | 'failed' {
  return (
    status === 'completed' ||
    status === 'interrupted' ||
    status === 'failed'
  );
}

function appendAssistantDelta(
  transcript: readonly SessionTranscriptItem[],
  turnId: string,
  delta: string,
  sequence: number,
): readonly SessionTranscriptItem[] {
  const last = transcript.at(-1);
  if (last?.kind !== 'assistant' || last.turnId !== turnId) {
    return [
      ...transcript,
      {
        id: `assistant:${turnId}:${sequence}`,
        kind: 'assistant',
        turnId,
        text: delta,
      },
    ];
  }
  return [
    ...transcript.slice(0, -1),
    { ...last, text: last.text + delta },
  ];
}

function appendThinkingDelta(
  transcript: readonly SessionTranscriptItem[],
  turnId: string,
  delta: string,
  truncated: boolean,
): readonly SessionTranscriptItem[] {
  const index = transcript.findIndex(
    (item) => item.kind === 'thinking' && item.turnId === turnId,
  );
  if (index === -1) {
    return [
      ...transcript,
      {
        id: `thinking:${turnId}`,
        kind: 'thinking',
        turnId,
        text: delta,
        status: 'active',
        truncated,
      },
    ];
  }
  return transcript.map((item, itemIndex) =>
    itemIndex === index && item.kind === 'thinking'
      ? {
          ...item,
          text: item.text + delta,
          truncated: item.truncated || truncated,
        }
      : item,
  );
}

function upsertTool(
  transcript: readonly SessionTranscriptItem[],
  event: Extract<HostToWebviewMessage, { type: 'tool.activity' }>,
): readonly SessionTranscriptItem[] {
  const index = transcript.findIndex(
    (item) =>
      item.kind === 'tool' &&
      item.turnId === event.turnId &&
      item.toolUseId === event.toolUseId,
  );
  if (index !== -1) {
    return transcript.map((item, itemIndex) => {
      if (itemIndex !== index || item.kind !== 'tool') {
        return item;
      }
      if (
        event.status === 'running' &&
        (item.status === 'completed' ||
          item.status === 'failed' ||
          item.status === 'stopped')
      ) {
        return item;
      }
      return {
        ...item,
        toolName: event.toolName,
        action: event.action,
        status: event.status,
        progressCount: event.progressCount,
        latestUpdateKind: event.latestUpdateKind,
        ...(event.durationMs === undefined
          ? {}
          : { durationMs: event.durationMs }),
      };
    });
  }
  const count = transcript.filter(
    (item) => item.kind === 'tool' && item.turnId === event.turnId,
  ).length;
  if (count >= MAX_TOOL_ACTIVITIES_PER_TURN) {
    return transcript;
  }
  return [
    ...transcript,
    {
      id: `tool:${event.turnId}:${event.toolUseId}`,
      kind: 'tool',
      turnId: event.turnId,
      toolUseId: event.toolUseId,
      toolName: event.toolName,
      action: event.action,
      status: event.status,
      progressCount: event.progressCount,
      latestUpdateKind: event.latestUpdateKind,
      ...(event.durationMs === undefined
        ? {}
        : { durationMs: event.durationMs }),
    },
  ];
}

function markActivitiesStopping(
  transcript: readonly SessionTranscriptItem[],
  turnId: string,
): readonly SessionTranscriptItem[] {
  return transcript.map((item) => {
    if (
      item.kind === 'thinking' &&
      item.turnId === turnId &&
      item.status === 'active'
    ) {
      return { ...item, status: 'stopping' };
    }
    if (
      item.kind === 'tool' &&
      item.turnId === turnId &&
      item.status === 'running'
    ) {
      return { ...item, status: 'stopping' };
    }
    return item;
  });
}

function finalizeActivities(
  transcript: readonly SessionTranscriptItem[],
  turnId: string,
  outcome: 'completed' | 'interrupted' | 'failed',
): readonly SessionTranscriptItem[] {
  return transcript.map((item) => {
    if (
      item.kind === 'thinking' &&
      item.turnId === turnId &&
      (item.status === 'active' || item.status === 'stopping')
    ) {
      return {
        ...item,
        status: outcome === 'completed' ? 'complete' : 'stopped',
      };
    }
    if (
      item.kind === 'tool' &&
      item.turnId === turnId &&
      (item.status === 'running' || item.status === 'stopping')
    ) {
      return {
        ...item,
        status:
          outcome === 'completed'
            ? 'completed'
            : 'stopped',
      };
    }
    return item;
  });
}

function appendDiagnostic(
  transcript: readonly SessionTranscriptItem[],
  next: Extract<SessionTranscriptItem, { kind: 'diagnostic' }>,
): readonly SessionTranscriptItem[] {
  const current =
    next.code === 'runtime-execution-failed' && next.turnId !== null
      ? transcript.filter(
          (item) =>
            item.kind !== 'diagnostic' ||
            item.turnId !== next.turnId ||
            item.severity !== 'error',
        )
      : transcript;
  const count = current.filter(
    (item) => item.kind === 'diagnostic',
  ).length;
  if (count < MAX_DIAGNOSTICS) {
    return [...current, next];
  }
  const oldest = current.findIndex(
    (item) => item.kind === 'diagnostic',
  );
  return [
    ...current.slice(0, oldest),
    ...current.slice(oldest + 1),
    next,
  ];
}
