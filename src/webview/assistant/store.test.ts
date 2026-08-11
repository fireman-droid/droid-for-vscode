import { describe, expect, it } from 'vitest';

import type { HostSnapshotMessage } from '../../shared/bridgeMessages';
import {
  assistantWebviewReducer,
  initialAssistantWebviewState,
} from './store';

function snapshot(
  sequence = 0,
  sessionId = 'session-a',
): HostSnapshotMessage {
  return {
    type: 'host.snapshot',
    sequence,
    sessionId,
    connection: { status: 'connected' },
    turn: null,
    sessions: {
      status: 'ready',
      items: [
        {
          id: sessionId,
          title: 'Active',
          messageCount: 0,
          modifiedTime: '2026-02-20T10:00:00.000Z',
          active: true,
        },
      ],
    },
    settings: {
      status: 'ready',
      value: {
        interactionMode: 'auto',
        modelId: 'model-a',
        reasoningEffort: 'medium',
        autonomyLevel: 'low',
      },
    },
    context: {
      status: 'ready',
      value: {
        used: 10,
        remaining: 90,
        limit: 100,
        accuracy: 'exact',
      },
    },
    modelCatalog: {
      status: 'unsupported',
      items: [],
      message: 'Unavailable',
    },
    transcript: [],
    historyStatus: 'complete',
    truncated: false,
  };
}

describe('assistantWebviewReducer', () => {
  it('isolates sequenced settings, context, and catalogs by session', () => {
    let state = assistantWebviewReducer(initialAssistantWebviewState, {
      type: 'host.message',
      message: snapshot(),
    });
    const confirmed = state;
    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'session.settings',
        sequence: 1,
        sessionId: 'session-other',
        settings: {
          status: 'ready',
          value: {
            interactionMode: 'mission',
            modelId: 'must-not-leak',
            reasoningEffort: 'max',
            autonomyLevel: 'high',
          },
        },
      },
    });
    expect(state.sequence).toBe(1);
    expect(state.settings).toBe(confirmed.settings);

    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'session.context',
        sequence: 2,
        sessionId: 'session-a',
        context: {
          status: 'ready',
          value: {
            used: 25,
            remaining: 75,
            limit: 100,
            accuracy: 'estimated',
          },
        },
      },
    });
    expect(state.context.value).toMatchObject({ used: 25 });

    const accepted = state;
    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'session.model-catalog',
        sequence: 2,
        sessionId: 'session-a',
        modelCatalog: {
          status: 'ready',
          items: [],
        },
      },
    });
    expect(state).toBe(accepted);
  });

  it('rejects stale sequences and advances past wrong-session deltas', () => {
    let state = assistantWebviewReducer(initialAssistantWebviewState, {
      type: 'host.message',
      message: {
        ...snapshot(),
        turn: { turnId: 'turn-a', status: 'streaming' },
      },
    });
    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'assistant.delta',
        sequence: 2,
        sessionId: 'session-other',
        turnId: 'turn-a',
        delta: 'must be ignored',
      },
    });
    const afterWrongSession = state;
    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'assistant.delta',
        sequence: 1,
        sessionId: 'session-a',
        turnId: 'turn-a',
        delta: 'stale',
      },
    });

    expect(state).toBe(afterWrongSession);
    expect(state.sequence).toBe(2);
    expect(state.transcript).toEqual([]);
  });

  it('optimistically accepts a user send and streams safe activities', () => {
    let state = assistantWebviewReducer(initialAssistantWebviewState, {
      type: 'host.message',
      message: snapshot(),
    });
    state = assistantWebviewReducer(state, {
      type: 'turn.send',
      turnId: 'turn-a',
      text: 'Inspect this',
    });
    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'thinking.delta',
        sequence: 1,
        sessionId: 'session-a',
        turnId: 'turn-a',
        delta: 'Checking',
        truncated: false,
      },
    });
    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'tool.activity',
        sequence: 2,
        sessionId: 'session-a',
        turnId: 'turn-a',
        toolUseId: 'tool-a',
        toolName: 'Read',
        action: 'Read workspace files',
        status: 'running',
        progressCount: 0,
        latestUpdateKind: null,
      },
    });
    state = assistantWebviewReducer(state, { type: 'turn.stop' });

    expect(state.turn?.status).toBe('stopping');
    expect(state.transcript).toMatchObject([
      { id: 'user:turn-a', kind: 'user', text: 'Inspect this' },
      { kind: 'thinking', status: 'stopping' },
      {
        kind: 'tool',
        toolUseId: 'tool-a',
        toolName: 'Read',
        status: 'stopping',
      },
    ]);
  });

  it('keeps interactions generation-safe, unique, and closes once', () => {
    let state = assistantWebviewReducer(initialAssistantWebviewState, {
      type: 'host.message',
      message: snapshot(),
    });
    const request = {
      requestId: 'permission-a',
      kind: 'permission' as const,
      tools: [
        {
          toolUseId: 'tool-a',
          toolName: 'Execute',
          confirmationKind: 'exec' as const,
          title: 'Run checks',
        },
      ],
      options: [
        {
          label: 'Allow',
          value: 'allow',
          requiresEditedSpec: false,
        },
      ],
    };
    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'interaction.request',
        sequence: 1,
        sessionId: 'session-other',
        turnId: 'turn-a',
        request,
      },
    });
    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'interaction.request',
        sequence: 2,
        sessionId: 'session-a',
        turnId: 'turn-a',
        request,
      },
    });
    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'interaction.request',
        sequence: 3,
        sessionId: 'session-a',
        turnId: 'turn-a',
        request,
      },
    });
    expect(state.interactions).toHaveLength(1);

    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'interaction.closed',
        sequence: 4,
        sessionId: 'session-a',
        turnId: 'turn-a',
        requestId: 'permission-a',
      },
    });
    expect(state.interactions).toEqual([]);

    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'turn.state',
        sequence: 5,
        sessionId: 'session-a',
        turnId: 'turn-a',
        status: 'completed',
      },
    });
    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'interaction.request',
        sequence: 6,
        sessionId: 'session-a',
        turnId: 'turn-a',
        request: { ...request, requestId: 'late-permission' },
      },
    });
    expect(state.terminalTurnId).toBe('turn-a');
    expect(state.interactions).toEqual([]);
  });

  it('stops a running tool when the overall turn fails', () => {
    let state = assistantWebviewReducer(initialAssistantWebviewState, {
      type: 'host.message',
      message: {
        ...snapshot(),
        turn: { turnId: 'turn-a', status: 'streaming' },
        transcript: [
          {
            id: 'tool-a',
            kind: 'tool',
            turnId: 'turn-a',
            toolUseId: 'tool-a',
            toolName: 'Read',
            action: 'Read workspace files',
            status: 'running',
            progressCount: 0,
            latestUpdateKind: null,
          },
        ],
      },
    });

    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'turn.state',
        sequence: 1,
        sessionId: 'session-a',
        turnId: 'turn-a',
        status: 'failed',
      },
    });

    expect(state.transcript).toMatchObject([
      { kind: 'tool', status: 'stopped' },
    ]);
  });

  it('preserves an explicit tool failure when the turn fails', () => {
    let state = assistantWebviewReducer(initialAssistantWebviewState, {
      type: 'host.message',
      message: {
        ...snapshot(),
        turn: { turnId: 'turn-a', status: 'streaming' },
        transcript: [
          {
            id: 'tool-a',
            kind: 'tool',
            turnId: 'turn-a',
            toolUseId: 'tool-a',
            toolName: 'Read',
            action: 'Read workspace files',
            status: 'running',
            progressCount: 0,
            latestUpdateKind: null,
          },
        ],
      },
    });
    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'tool.activity',
        sequence: 1,
        sessionId: 'session-a',
        turnId: 'turn-a',
        toolUseId: 'tool-a',
        toolName: 'Read',
        action: 'Read workspace files',
        status: 'failed',
        progressCount: 1,
        latestUpdateKind: 'error',
      },
    });

    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'turn.state',
        sequence: 2,
        sessionId: 'session-a',
        turnId: 'turn-a',
        status: 'failed',
      },
    });

    expect(state.transcript).toMatchObject([
      { kind: 'tool', status: 'failed' },
    ]);
  });

  it('replaces earlier same-turn errors with the terminal runtime failure', () => {
    let state = assistantWebviewReducer(initialAssistantWebviewState, {
      type: 'host.message',
      message: {
        ...snapshot(),
        turn: { turnId: 'turn-a', status: 'streaming' },
      },
    });
    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'runtime.diagnostic',
        sequence: 1,
        sessionId: 'session-a',
        turnId: 'turn-a',
        severity: 'error',
        code: 'sdk-stream-error',
        message: 'The Droid SDK stream failed.',
      },
    });
    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'runtime.diagnostic',
        sequence: 2,
        sessionId: 'session-a',
        turnId: 'turn-a',
        severity: 'error',
        code: 'runtime-execution-failed',
        message: 'Droid could not complete this turn.',
      },
    });

    expect(state.transcript).toMatchObject([
      {
        kind: 'diagnostic',
        code: 'runtime-execution-failed',
        turnId: 'turn-a',
      },
    ]);
  });
});
