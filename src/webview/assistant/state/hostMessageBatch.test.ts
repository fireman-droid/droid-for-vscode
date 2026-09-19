import { describe, expect, it } from 'vitest';
import { initialAssistantWebviewState } from './initialState';
import { assistantWebviewReducer } from './store';
import type { AssistantWebviewState, StoreHostMessage } from './types';

const seed: AssistantWebviewState = {
  ...initialAssistantWebviewState,
  sequence: 1,
  sessionId: 'session',
  connection: { status: 'connected' },
  turn: { turnId: 'turn', status: 'streaming' },
  historyStatus: 'complete',
  transcript: [{ id: 'question', kind: 'user', text: 'Question' }],
};
function delta(sequence: number, text = 'token '): StoreHostMessage {
  return {
    type: 'assistant.delta',
    sequence,
    sessionId: 'session',
    turnId: 'turn',
    delta: text,
  };
}
function compare(state: AssistantWebviewState, messages: readonly StoreHostMessage[]) {
  const sequential = messages.reduce(
    (current, message) =>
      assistantWebviewReducer(current, { type: 'host.message', message }),
    state,
  );
  const batched = assistantWebviewReducer(state, { type: 'host.batch', messages });
  expect(batched).toEqual(sequential);
  return batched;
}
describe('long conversation stream backlog', () => {
  it('preserves all text and the first segment ID when thousands of deltas arrive together', () => {
    const history: AssistantWebviewState = {
      ...seed,
      transcript: [
        ...Array.from({ length: 1600 }, (_, index) => ({
          id: `history-${index}`,
          kind: 'user' as const,
          text: 'Historical question',
        })),
        ...seed.transcript,
      ],
    };
    const messages = Array.from({ length: 2000 }, (_, index) => delta(index + 2));
    const result = compare(history, messages);
    expect(result.transcript.at(-1)).toMatchObject({
      id: 'assistant:turn:2',
      text: 'token '.repeat(2000),
    });
    expect(result.transcript[0]).toBe(history.transcript[0]);
  });

  it('does not combine stale tokens, other sessions, tools or terminal turn boundaries', () => {
    compare({ ...seed, sequence: 5 }, [
      delta(2, 'stale'),
      delta(3, 'stale'),
      delta(6, 'a'),
      delta(7, 'b'),
      delta(6, 'duplicate'),
      delta(8, 'c'),
      { ...delta(9), sessionId: 'other' } as StoreHostMessage,
      delta(10, 'd'),
      {
        type: 'tool.activity',
        sequence: 11,
        sessionId: 'session',
        turnId: 'turn',
        toolUseId: 'tool',
        toolName: 'Read',
        action: 'Read file',
        status: 'completed',
        progressCount: 0,
        latestUpdateKind: 'status',
      },
      delta(12, 'new segment'),
      delta(13, 'continued'),
      {
        type: 'turn.state',
        sequence: 14,
        sessionId: 'session',
        turnId: 'turn',
        status: 'completed',
      },
      delta(15, 'ignored'),
      delta(16, 'ignored'),
    ]);
  });

  it('preserves thinking segments, truncation and transcript budget eviction', () => {
    const thinking = (
      sequence: number,
      segmentIndex: number,
      truncated = false,
    ): StoreHostMessage => ({
      type: 'thinking.delta',
      sequence,
      sessionId: 'session',
      turnId: 'turn',
      segmentIndex,
      truncated,
      delta: 'thinking ',
    });
    const history: AssistantWebviewState = {
      ...seed,
      transcript: [
        ...Array.from({ length: 8 }, (_, index) => ({
          id: `history-${index}`,
          kind: 'user' as const,
          text: 'h'.repeat(120000),
        })),
        ...seed.transcript,
      ],
    };
    const messages = [
      thinking(2, 0),
      thinking(3, 0, true),
      thinking(4, 0),
      thinking(5, 1),
      thinking(6, 1),
      ...Array.from({ length: 80 }, (_, index) => delta(index + 7, 'x'.repeat(1000))),
    ];
    expect(compare(history, messages).truncated).toBe(true);
  });
});
