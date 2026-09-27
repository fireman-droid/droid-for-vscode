import { describe, expect, it } from 'vitest';
import { initialAssistantWebviewState } from '../state/initialState';
import type { StoreHostMessage } from '../state/types';
import { createChatStore } from './store';

describe('V2 panel state ownership', () => {
  it('keeps streamed history and request identity isolated between panel instances', () => {
    const initial = {
      ...initialAssistantWebviewState,
      sequence: 1,
      sessionId: 'session',
      conversationId: 'conversation',
      connection: { status: 'connected' as const },
      turn: { turnId: 'turn', status: 'streaming' as const },
      transcript: [{ id: 'question', kind: 'user' as const, text: 'Question' }],
    };
    const first = createChatStore(initial);
    const second = createChatStore(initial);
    const delta = (sequence: number, text: string): StoreHostMessage => ({
      type: 'assistant.delta', sequence, sessionId: 'session', turnId: 'turn', delta: text,
    });
    first.getState().dispatch({
      type: 'host.batch',
      messages: [
        delta(2, 'Hello '),
        delta(3, 'world'),
        { ...delta(4, 'wrong session'), sessionId: 'other' } as StoreHostMessage,
        delta(2, 'stale'),
        { type: 'turn.state', sequence: 5, sessionId: 'session', turnId: 'turn', status: 'completed' },
        delta(6, 'late'),
      ],
    });
    expect(first.getState().state.transcript.at(-1)).toMatchObject({
      id: 'assistant:turn:2', text: 'Hello world',
    });
    expect(first.getState().state.turn?.status).toBe('completed');
    expect(second.getState().state).toBe(initial);
    expect(initial.transcript).toHaveLength(1);
  });
});
