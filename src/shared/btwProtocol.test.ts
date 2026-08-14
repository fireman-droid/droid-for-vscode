import { describe, expect, it } from 'vitest';

import {
  MAX_BTW_ANSWER_LENGTH,
  MAX_BTW_ENTRIES,
  MAX_BTW_MESSAGE_LENGTH,
  MAX_BTW_TEXT_LENGTH,
  parseBtwAskMessage,
  parseBtwDismissMessage,
  parseBtwPrepareMessage,
  parseSessionBtwMessage,
} from './btwProtocol';

describe('parseBtwPrepareMessage', () => {
  it('accepts only an exact session-bound prepare request', () => {
    expect(
      parseBtwPrepareMessage({
        type: 'btw.prepare',
        sessionId: 'session-1',
      }),
    ).toEqual({ type: 'btw.prepare', sessionId: 'session-1' });
    expect(
      parseBtwPrepareMessage({
        type: 'btw.prepare',
        sessionId: 'session-1',
        extra: true,
      }),
    ).toBeNull();
    expect(
      parseBtwPrepareMessage({ type: 'btw.prepare', sessionId: '' }),
    ).toBeNull();
  });
});

describe('parseBtwAskMessage', () => {
  it('accepts a well-formed ask', () => {
    expect(
      parseBtwAskMessage({
        type: 'btw.ask',
        sessionId: 'session-1',
        text: 'What does this error mean?',
      }),
    ).toEqual({
      type: 'btw.ask',
      sessionId: 'session-1',
      text: 'What does this error mean?',
    });
  });

  it.each([
    ['missing text', { type: 'btw.ask', sessionId: 's' }],
    ['empty text', { type: 'btw.ask', sessionId: 's', text: '' }],
    [
      'oversized text',
      {
        type: 'btw.ask',
        sessionId: 's',
        text: 'a'.repeat(MAX_BTW_TEXT_LENGTH + 1),
      },
    ],
    ['empty session id', { type: 'btw.ask', sessionId: '', text: 'q' }],
    [
      'extra key',
      { type: 'btw.ask', sessionId: 's', text: 'q', extra: true },
    ],
    ['wrong type tag', { type: 'btw.asked', sessionId: 's', text: 'q' }],
    ['non-object', 'btw.ask'],
  ])('rejects %s', (_name, value) => {
    expect(parseBtwAskMessage(value)).toBeNull();
  });
});

describe('parseBtwDismissMessage', () => {
  it('accepts a well-formed dismiss', () => {
    expect(
      parseBtwDismissMessage({ type: 'btw.dismiss', sessionId: 's' }),
    ).toEqual({ type: 'btw.dismiss', sessionId: 's' });
  });

  it.each([
    ['missing session id', { type: 'btw.dismiss' }],
    [
      'extra key',
      { type: 'btw.dismiss', sessionId: 's', text: 'q' },
    ],
    ['non-object', null],
  ])('rejects %s', (_name, value) => {
    expect(parseBtwDismissMessage(value)).toBeNull();
  });
});

function validMessage(): Record<string, unknown> {
  return {
    type: 'session.btw',
    sequence: 7,
    sessionId: 'session-1',
    btw: {
      status: 'ready',
      entries: [
        {
          id: 'entry-1',
          question: 'What is the codeword?',
          answer: 'ZEBRA-42',
          state: 'done',
        },
      ],
      message: undefined,
    },
  };
}

describe('parseSessionBtwMessage', () => {
  it('accepts a ready snapshot with entries', () => {
    const parsed = parseSessionBtwMessage(validMessage());
    expect(parsed).not.toBeNull();
    expect(parsed?.btw.status).toBe('ready');
    expect(parsed?.btw.entries).toHaveLength(1);
    expect(parsed?.btw.message).toBeNull();
    expect(parsed?.btw.pendingQuestion).toBeNull();
  });

  it('accepts one bounded pending question', () => {
    const message = validMessage();
    (message.btw as Record<string, unknown>).pendingQuestion =
      'What about the tests?';
    expect(parseSessionBtwMessage(message)?.btw.pendingQuestion).toBe(
      'What about the tests?',
    );
  });

  it('accepts an unsupported snapshot with a message', () => {
    const parsed = parseSessionBtwMessage({
      type: 'session.btw',
      sequence: 1,
      sessionId: 's',
      btw: {
        status: 'unsupported',
        entries: [],
        message: 'Side chat needs the process runtime mode.',
      },
    });
    expect(parsed?.btw.status).toBe('unsupported');
    expect(parsed?.btw.message).toBe(
      'Side chat needs the process runtime mode.',
    );
  });

  it('accepts explicit null messages (hosts serialize the state shape)', () => {
    const message = validMessage();
    (message.btw as Record<string, unknown>).message = null;
    (message.btw as Record<string, unknown>).entries = [
      {
        id: 'entry-1',
        question: 'q',
        answer: 'a',
        state: 'done',
        message: null,
      },
    ];
    const parsed = parseSessionBtwMessage(message);
    expect(parsed?.btw.message).toBeNull();
    expect(parsed?.btw.entries[0]?.message).toBeNull();
  });

  it('accepts an empty answer on a streaming entry', () => {
    const message = validMessage();
    (message.btw as Record<string, unknown>).entries = [
      { id: 'e', question: 'q', answer: '', state: 'streaming' },
    ];
    expect(parseSessionBtwMessage(message)).not.toBeNull();
  });

  it('carries entry-level error copy and defaults it to null', () => {
    const message = validMessage();
    (message.btw as Record<string, unknown>).entries = [
      {
        id: 'e',
        question: 'q',
        answer: '',
        state: 'error',
        message: 'Ask this one in the main chat.',
      },
    ];
    const parsed = parseSessionBtwMessage(message);
    expect(parsed?.btw.entries[0]?.message).toBe(
      'Ask this one in the main chat.',
    );
    expect(
      parseSessionBtwMessage(validMessage())?.btw.entries[0]?.message,
    ).toBeNull();
  });

  it('rejects duplicate entry ids', () => {
    const message = validMessage();
    const entry = {
      id: 'entry-1',
      question: 'q',
      answer: 'a',
      state: 'done',
    };
    (message.btw as Record<string, unknown>).entries = [entry, entry];
    expect(parseSessionBtwMessage(message)).toBeNull();
  });

  it('rejects more entries than the cap', () => {
    const message = validMessage();
    (message.btw as Record<string, unknown>).entries = Array.from(
      { length: MAX_BTW_ENTRIES + 1 },
      (_, index) => ({
        id: `entry-${index}`,
        question: 'q',
        answer: 'a',
        state: 'done',
      }),
    );
    expect(parseSessionBtwMessage(message)).toBeNull();
  });

  it.each([
    [
      'unknown status',
      (message: Record<string, unknown>) => {
        (message.btw as Record<string, unknown>).status = 'paused';
      },
    ],
    [
      'unknown entry state',
      (message: Record<string, unknown>) => {
        (message.btw as Record<string, unknown>).entries = [
          { id: 'e', question: 'q', answer: 'a', state: 'queued' },
        ];
      },
    ],
    [
      'oversized answer',
      (message: Record<string, unknown>) => {
        (message.btw as Record<string, unknown>).entries = [
          {
            id: 'e',
            question: 'q',
            answer: 'a'.repeat(MAX_BTW_ANSWER_LENGTH + 1),
            state: 'done',
          },
        ];
      },
    ],
    [
      'oversized message',
      (message: Record<string, unknown>) => {
        (message.btw as Record<string, unknown>).message = 'm'.repeat(
          MAX_BTW_MESSAGE_LENGTH + 1,
        );
      },
    ],
    [
      'empty pending question',
      (message: Record<string, unknown>) => {
        (message.btw as Record<string, unknown>).pendingQuestion = '';
      },
    ],
    [
      'oversized pending question',
      (message: Record<string, unknown>) => {
        (message.btw as Record<string, unknown>).pendingQuestion =
          'q'.repeat(MAX_BTW_TEXT_LENGTH + 1);
      },
    ],
    [
      'entry extra key',
      (message: Record<string, unknown>) => {
        (message.btw as Record<string, unknown>).entries = [
          {
            id: 'e',
            question: 'q',
            answer: 'a',
            state: 'done',
            extra: 1,
          },
        ];
      },
    ],
    [
      'btw extra key',
      (message: Record<string, unknown>) => {
        (message.btw as Record<string, unknown>).extra = true;
      },
    ],
    [
      'non-finite sequence',
      (message: Record<string, unknown>) => {
        message.sequence = Number.NaN;
      },
    ],
  ])('rejects %s', (_name, mutate) => {
    const message = validMessage();
    mutate(message);
    expect(parseSessionBtwMessage(message)).toBeNull();
  });
});
