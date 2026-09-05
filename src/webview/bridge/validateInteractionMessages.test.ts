import { describe, expect, it } from 'vitest';

import { MAX_EDITED_SPEC_LENGTH } from '../../shared/bridgeMessages';
import {
  parseSessionTranscript,
  readHostMessage,
} from './validateHostMessage';

describe('interaction Host message validation', () => {
  it('accepts exact AskUser settlement results', () => {
    const message = {
      type: 'interaction.closed',
      sequence: 1,
      sessionId: 'session-1',
      turnId: 'turn-1',
      requestId: 'ask-1',
      result: {
        status: 'answered',
        answers: [{ topic: 'Library', answer: 'React' }],
      },
    };
    expect(readHostMessage(message)).toEqual(message);
    expect(
      readHostMessage({
        ...message,
        result: { ...message.result, extra: true },
      }),
    ).toBeUndefined();
  });

  it('accepts exact durable AskUser transcript rows', () => {
    const row = {
      id: 'ask-result-1',
      kind: 'ask-user-result',
      turnId: 'turn-1',
      status: 'answered',
      answers: [{ topic: 'Library', answer: 'React' }],
    };
    expect(parseSessionTranscript([row])).toEqual([row]);
    const withQuestion = {
      ...row,
      answers: [{ ...row.answers[0], question: 'Which library?' }],
    };
    expect(parseSessionTranscript([withQuestion])).toEqual([withQuestion]);
    expect(parseSessionTranscript([{
      ...row,
      answers: [{ ...row.answers[0], question: 42 }],
    }])).toBeUndefined();
    expect(
      parseSessionTranscript([
        { ...row, status: 'cancelled', answers: row.answers },
      ]),
    ).toBeUndefined();
  });

  it('accepts only coherent Plan document states', () => {
    const ready = {
      type: 'plan.document.state',
      sequence: 2,
      sessionId: 'session-1',
      turnId: 'turn-1',
      requestId: 'plan-1',
      status: 'ready',
      content: '# Revised',
    };
    expect(readHostMessage(ready)).toEqual(ready);
    expect(
      readHostMessage({
        ...ready,
        content: 'x'.repeat(MAX_EDITED_SPEC_LENGTH + 1),
      }),
    ).toBeUndefined();
    expect(
      readHostMessage({
        ...ready,
        status: 'too-large',
      }),
    ).toBeUndefined();
    expect(
      readHostMessage({
        type: 'plan.document.state',
        sequence: 3,
        sessionId: 'session-1',
        turnId: 'turn-1',
        requestId: 'plan-1',
        status: 'too-large',
      }),
    ).toMatchObject({ status: 'too-large' });
  });
});
