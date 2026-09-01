import { describe, expect, it } from 'vitest';

import type { HostSnapshotMessage } from '../../shared/bridgeMessages';
import type { SessionBtwState } from '../../shared/btwProtocol';
import {
  assistantWebviewReducer,
  initialAssistantWebviewState,
  type AssistantWebviewState,
  type StoreHostMessage,
} from './store';

/**
 * `/btw` side-chat slices of the webview reducer, kept in their own
 * file next to store.test.ts (the card ships as its own vertical
 * slice; see side-question-design.md §5.4).
 */

function snapshot(
  sequence = 0,
  sessionId = 'session-a',
): HostSnapshotMessage {
  return {
    type: 'host.snapshot',
    sequence,
    conversationId: sessionId,
    sessionId,
    connection: { status: 'connected' },
    turn: null,
    sessions: { status: 'ready', items: [] },
    settings: { status: 'loading', value: null },
    context: { status: 'loading', value: null },
    modelCatalog: { status: 'loading', items: [] },
    transcript: [],
    historyStatus: 'complete',
    truncated: false,
  };
}

function cardState(question: string): SessionBtwState {
  return {
    status: 'ready',
    message: null,
    pendingQuestion: null,
    entries: [
      {
        id: 'btw-1',
        question,
        answer: 'Streamed.',
        state: 'done',
        message: null,
      },
    ],
  };
}

function reduce(
  state: AssistantWebviewState,
  message: StoreHostMessage,
): AssistantWebviewState {
  return assistantWebviewReducer(state, {
    type: 'host.message',
    message,
  });
}

describe('assistantWebviewReducer /btw', () => {
  it('tracks the snapshot-borne btw capability with omit-as-false', () => {
    expect(initialAssistantWebviewState.btwAvailable).toBe(false);

    let state = reduce(initialAssistantWebviewState, {
      ...snapshot(0),
      btwAvailable: true,
    });
    expect(state.btwAvailable).toBe(true);

    // Absent flag means unavailable (e.g. a daemon-mode host), not
    // "keep the previous value".
    state = reduce(state, snapshot(1));
    expect(state.btwAvailable).toBe(false);
  });

  it('applies session.btw card states for the bound session only', () => {
    let state = reduce(initialAssistantWebviewState, snapshot(0));

    state = reduce(state, {
      type: 'session.btw',
      sequence: 1,
      sessionId: 'session-a',
      btw: cardState('What is a fork?'),
    });
    expect(state.btw.entries).toHaveLength(1);
    expect(state.btw.entries[0]?.question).toBe('What is a fork?');

    // Cards for other sessions advance the sequence and change
    // nothing else.
    const foreign = reduce(state, {
      type: 'session.btw',
      sequence: 2,
      sessionId: 'session-b',
      btw: cardState('Stale.'),
    });
    expect(foreign.sequence).toBe(2);
    expect(foreign.btw).toBe(state.btw);
  });

  it('discards card contents when the session identity changes', () => {
    let state = reduce(initialAssistantWebviewState, snapshot(0));
    state = reduce(state, {
      type: 'session.btw',
      sequence: 1,
      sessionId: 'session-a',
      btw: cardState('Kept?'),
    });

    // Same-session snapshots keep the card; a switch clears it.
    state = reduce(state, { ...snapshot(2), btwAvailable: true });
    expect(state.btw.entries).toHaveLength(1);
    state = reduce(state, {
      ...snapshot(3, 'session-b'),
      btwAvailable: true,
    });
    expect(state.btw.entries).toHaveLength(0);
    expect(state.btw.status).toBe('idle');
  });

  it('clears the card on a connection-borne session change', () => {
    let state = reduce(initialAssistantWebviewState, snapshot(0));
    state = reduce(state, {
      type: 'session.btw',
      sequence: 1,
      sessionId: 'session-a',
      btw: cardState('Kept?'),
    });
    state = reduce(state, {
      type: 'host.connection',
      sequence: 2,
      conversationId: 'session-b',
      sessionId: 'session-b',
      connection: { status: 'connected' },
    });
    expect(state.btw.entries).toHaveLength(0);
  });
});
