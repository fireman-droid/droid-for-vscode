import { describe, expect, it } from 'vitest';

import {
  MAX_TURN_TEXT_LENGTH,
  MAX_BRIDGE_ID_LENGTH,
} from './bridgeMessages';
import {
  MAX_QUEUED_MESSAGES,
  parseQueueAddMessage,
  parseQueueClearMessage,
  parseQueueRemoveMessage,
  parseQueueResumeMessage,
  parseQueueStateMessage,
  parseQueueUpdateMessage,
  parseSessionQueueState,
} from './queueProtocol';

function queuedItem(
  queueId = 'queue-1',
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    queueId,
    text: 'queued prompt',
    attachments: [],
    ...overrides,
  };
}

describe('queueProtocol webview messages', () => {
  it('accepts exact queue.add and queue.update shapes at the shared text limit', () => {
    const text = 'q'.repeat(MAX_TURN_TEXT_LENGTH);
    expect(
      parseQueueAddMessage({
        type: 'queue.add',
        sessionId: 'session-1',
        queueId: 'queue-1',
        text,
      }),
    ).toEqual({
      type: 'queue.add',
      sessionId: 'session-1',
      queueId: 'queue-1',
      text,
    });
    expect(
      parseQueueUpdateMessage({
        type: 'queue.update',
        sessionId: 'session-1',
        queueId: 'queue-1',
        text: 'edited',
      }),
    ).toEqual({
      type: 'queue.update',
      sessionId: 'session-1',
      queueId: 'queue-1',
      text: 'edited',
    });
  });

  it('rejects malformed queue.add payloads', () => {
    const base = {
      type: 'queue.add',
      sessionId: 'session-1',
      queueId: 'queue-1',
      text: 'hello',
    };
    expect(parseQueueAddMessage({ ...base, text: '' })).toBeNull();
    expect(
      parseQueueAddMessage({
        ...base,
        text: 'q'.repeat(MAX_TURN_TEXT_LENGTH + 1),
      }),
    ).toBeNull();
    expect(
      parseQueueAddMessage({
        ...base,
        queueId: 'q'.repeat(MAX_BRIDGE_ID_LENGTH + 1),
      }),
    ).toBeNull();
    expect(parseQueueAddMessage({ ...base, sessionId: 42 })).toBeNull();
    expect(
      parseQueueAddMessage({ ...base, extra: 'unexpected' }),
    ).toBeNull();
    expect(parseQueueAddMessage(null)).toBeNull();
    expect(
      parseQueueUpdateMessage({ ...base, type: 'queue.update', text: '' }),
    ).toBeNull();
  });

  it('parses remove, resume, and clear with exact keys only', () => {
    expect(
      parseQueueRemoveMessage({
        type: 'queue.remove',
        sessionId: 'session-1',
        queueId: 'queue-1',
      }),
    ).toEqual({
      type: 'queue.remove',
      sessionId: 'session-1',
      queueId: 'queue-1',
    });
    expect(
      parseQueueResumeMessage({
        type: 'queue.resume',
        sessionId: 'session-1',
      }),
    ).toEqual({ type: 'queue.resume', sessionId: 'session-1' });
    expect(
      parseQueueClearMessage({
        type: 'queue.clear',
        sessionId: 'session-1',
      }),
    ).toEqual({ type: 'queue.clear', sessionId: 'session-1' });

    expect(
      parseQueueRemoveMessage({
        type: 'queue.remove',
        sessionId: 'session-1',
      }),
    ).toBeNull();
    expect(
      parseQueueResumeMessage({
        type: 'queue.resume',
        sessionId: 'session-1',
        queueId: 'queue-1',
      }),
    ).toBeNull();
    expect(
      parseQueueClearMessage({ type: 'queue.clear', sessionId: '' }),
    ).toBeNull();
  });
});

describe('queueProtocol host messages', () => {
  it('accepts a full queue.state message with bounded attachments', () => {
    const message = parseQueueStateMessage({
      type: 'queue.state',
      sequence: 7,
      sessionId: 'session-1',
      items: [
        queuedItem('queue-1', {
          attachments: [
            { kind: 'text', name: 'notes.md', sizeBytes: 128 },
          ],
        }),
        queuedItem('queue-2'),
      ],
      paused: 'stopped',
    });
    expect(message).toMatchObject({
      type: 'queue.state',
      sequence: 7,
      sessionId: 'session-1',
      paused: 'stopped',
    });
    expect(message?.items.map(({ queueId }) => queueId)).toEqual([
      'queue-1',
      'queue-2',
    ]);
    expect(message?.items[0]?.attachments).toEqual([
      { kind: 'text', name: 'notes.md', sizeBytes: 128 },
    ]);
  });

  it('rejects over-capacity, duplicate, and contradictory queue states', () => {
    const items = Array.from(
      { length: MAX_QUEUED_MESSAGES + 1 },
      (_, index) => queuedItem(`queue-${index}`),
    );
    expect(parseSessionQueueState({ items, paused: null })).toBeNull();
    expect(
      parseSessionQueueState({
        items: [queuedItem('queue-1'), queuedItem('queue-1')],
        paused: null,
      }),
    ).toBeNull();
    // A paused reason with no queued items is contradictory.
    expect(
      parseSessionQueueState({ items: [], paused: 'stopped' }),
    ).toBeNull();
    expect(
      parseSessionQueueState({ items: [], paused: 'later' }),
    ).toBeNull();
    expect(
      parseSessionQueueState({
        items: [queuedItem('queue-1', { text: '' })],
        paused: null,
      }),
    ).toBeNull();
    expect(
      parseSessionQueueState({
        items: [
          queuedItem('queue-1', {
            attachments: [
              { kind: 'archive', name: 'notes.zip', sizeBytes: 1 },
            ],
          }),
        ],
        paused: null,
      }),
    ).toBeNull();
    expect(
      parseSessionQueueState({
        items: [queuedItem('queue-1', { extra: true })],
        paused: null,
      }),
    ).toBeNull();
    expect(parseSessionQueueState({ items: [], paused: null })).toEqual({
      items: [],
      paused: null,
    });
  });

  it('rejects malformed queue.state envelopes', () => {
    const base = {
      type: 'queue.state',
      sequence: 1,
      sessionId: 'session-1',
      items: [],
      paused: null,
    };
    expect(parseQueueStateMessage(base)).not.toBeNull();
    expect(
      parseQueueStateMessage({ ...base, sequence: Number.NaN }),
    ).toBeNull();
    expect(parseQueueStateMessage({ ...base, sessionId: '' })).toBeNull();
    expect(
      parseQueueStateMessage({ ...base, extra: 'unexpected' }),
    ).toBeNull();
    expect(parseQueueStateMessage({ ...base, items: {} })).toBeNull();
  });
});
