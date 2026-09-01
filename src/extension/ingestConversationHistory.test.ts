import { describe, expect, it } from 'vitest';

import type { SessionTranscriptItem } from '../shared/bridgeMessages';
import { ingestConversationHistory } from './ingestConversationHistory';

describe('ingestConversationHistory', () => {
  it('keeps canonical ids and order while enriching existing content', () => {
    const canonical = state([
      user('canonical-user', 'Question'),
      assistant('canonical-answer', 'turn-live', 'Part'),
    ]);
    const loaded = state([
      user('loaded-user', 'Question'),
      assistant('loaded-answer', 'projected-turn', 'Part complete'),
    ]);

    expect(ingestConversationHistory(canonical, loaded)).toEqual({
      transcript: [
        canonical.transcript[0],
        {
          ...canonical.transcript[1],
          text: 'Part complete',
        },
      ],
      historyStatus: 'complete',
      truncated: false,
    });
  });

  it('appends only later turns and omits projected changes rows', () => {
    const canonical = state([
      user('canonical-user', 'First'),
      assistant('canonical-answer', 'turn-1', 'Answer'),
    ]);
    const loaded = state([
      user('loaded-user-1', 'First'),
      assistant('loaded-answer-1', 'projected-1', 'Answer'),
      user('loaded-user-2', 'Second'),
      assistant('loaded-answer-2', 'projected-2', 'Later'),
      {
        id: 'loaded-changes',
        kind: 'changes',
        turnId: 'projected-2',
        files: [{ path: 'src/a.ts', additions: null, deletions: null }],
      },
    ]);

    expect(
      ingestConversationHistory(canonical, loaded).transcript,
    ).toEqual([
      ...canonical.transcript,
      loaded.transcript[2],
      loaded.transcript[3],
    ]);
  });

  it('preserves canonical content when history has no trusted prefix', () => {
    const canonical = state([
      user('canonical-user', 'Planning prompt'),
      assistant('canonical-answer', 'turn-1', 'Planning answer'),
    ]);
    const loaded = state([
      user('loaded-user', 'Implementation prompt'),
      assistant('loaded-answer', 'projected-1', 'Implementation answer'),
    ]);

    expect(ingestConversationHistory(canonical, loaded)).toEqual({
      ...canonical,
      historyStatus: 'partial',
    });
  });
});

function state(
  transcript: readonly SessionTranscriptItem[],
) {
  return {
    transcript,
    historyStatus: 'complete' as const,
    truncated: false,
  };
}

function user(id: string, text: string): SessionTranscriptItem {
  return { id, kind: 'user', text };
}

function assistant(
  id: string,
  turnId: string,
  text: string,
): SessionTranscriptItem {
  return {
    id,
    kind: 'assistant',
    turnId,
    text,
  };
}
