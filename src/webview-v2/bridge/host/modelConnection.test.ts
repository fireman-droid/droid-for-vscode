import { expect, it } from 'vitest';
import { readHostMessage } from '../validateHostMessage';

it('preserves model connection failure independently and rejects malformed flags', () => {
  const message = { type: 'host.connection', sequence: 2, conversationId: 'conversation-1', sessionId: 'session-1',
    connection: { status: 'connected', modelRequestFailed: true } };
  expect(readHostMessage(message)).toEqual(message);
  for (const value of ['true', false, null, 1]) {
    expect(readHostMessage({ ...message, connection: { ...message.connection, modelRequestFailed: value } })).toBeUndefined();
  }
});
