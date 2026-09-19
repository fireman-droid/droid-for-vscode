import { describe, expect, it } from 'vitest';

import {
  EMPTY_SESSION_BTW_STATE,
  MAX_BTW_ANSWER_LENGTH,
  MAX_BTW_ENTRIES,
} from '../../shared/protocol/btwProtocol';
import {
  appendBtwAnswerDelta,
  appendBtwQuestion,
  completeBtwEntry,
  failBtwEntry,
  setBtwPendingQuestion,
  setBtwStatus,
} from './btwCardState';

describe('btwCardState', () => {
  it('walks one question through streaming, delta and done', () => {
    let state = setBtwStatus(EMPTY_SESSION_BTW_STATE, 'ready');
    state = appendBtwQuestion(state, 'e1', 'What is the codeword?');
    expect(state.entries).toEqual([
      {
        id: 'e1',
        question: 'What is the codeword?',
        answer: '',
        state: 'streaming',
        message: null,
      },
    ]);
    state = appendBtwAnswerDelta(state, 'e1', 'ZEBRA');
    state = appendBtwAnswerDelta(state, 'e1', '-42');
    state = completeBtwEntry(state, 'e1');
    expect(state.entries[0]).toMatchObject({
      answer: 'ZEBRA-42',
      state: 'done',
    });
  });

  it('marks failed entries with their quiet error copy', () => {
    let state = appendBtwQuestion(EMPTY_SESSION_BTW_STATE, 'e1', 'write a file');
    state = failBtwEntry(state, 'e1', 'Ask this one in the main chat.');
    expect(state.entries[0]).toMatchObject({
      state: 'error',
      message: 'Ask this one in the main chat.',
    });
  });

  it('caps the answer length and stops growing afterwards', () => {
    let state = appendBtwQuestion(EMPTY_SESSION_BTW_STATE, 'e1', 'q');
    state = appendBtwAnswerDelta(state, 'e1', 'a'.repeat(MAX_BTW_ANSWER_LENGTH + 100));
    expect(state.entries[0]?.answer).toHaveLength(MAX_BTW_ANSWER_LENGTH);
    const capped = appendBtwAnswerDelta(state, 'e1', 'more');
    expect(capped).toBe(state);
    expect(capped.entries[0]?.answer).toHaveLength(MAX_BTW_ANSWER_LENGTH);
  });

  it('evicts the oldest entries beyond the card cap', () => {
    let state = EMPTY_SESSION_BTW_STATE;
    for (let index = 0; index < MAX_BTW_ENTRIES + 2; index += 1) {
      state = appendBtwQuestion(state, `e${index}`, `question ${index}`);
    }
    expect(state.entries).toHaveLength(MAX_BTW_ENTRIES);
    expect(state.entries[0]?.id).toBe('e2');
    expect(state.entries.at(-1)?.id).toBe(`e${MAX_BTW_ENTRIES + 1}`);
  });

  it('ignores deltas and completions for unknown entries', () => {
    const state = appendBtwQuestion(EMPTY_SESSION_BTW_STATE, 'e1', 'q');
    expect(appendBtwAnswerDelta(state, 'nope', 'x').entries[0]?.answer).toBe('');
    expect(completeBtwEntry(state, 'nope').entries[0]?.state).toBe('streaming');
  });

  it('keeps entries while switching card status', () => {
    let state = appendBtwQuestion(EMPTY_SESSION_BTW_STATE, 'e1', 'q');
    state = setBtwPendingQuestion(state, 'next');
    state = setBtwStatus(state, 'error', 'Side chat failed.');
    expect(state.status).toBe('error');
    expect(state.message).toBe('Side chat failed.');
    expect(state.entries).toHaveLength(1);
    expect(state.pendingQuestion).toBe('next');
  });

  it('replaces and clears the one pending question', () => {
    let state = setBtwPendingQuestion(EMPTY_SESSION_BTW_STATE, 'first');
    state = setBtwPendingQuestion(state, 'replacement');
    expect(state.pendingQuestion).toBe('replacement');
    expect(setBtwPendingQuestion(state, null).pendingQuestion).toBeNull();
  });
});
