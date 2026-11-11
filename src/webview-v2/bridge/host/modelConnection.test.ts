import { expect, it } from 'vitest';
import { readHostMessage } from '../validateHostMessage';

it.each(['workspace-required', 'workspace-untrusted'])('preserves structured %s only for unavailable connections', reason => {
  const message = { type: 'host.connection', sequence: 2, conversationId: null, sessionId: null,
    connection: { status: 'unavailable', reason } };
  expect(readHostMessage(message)).toEqual(message);
  expect(readHostMessage({ ...message, connection: { status: 'connected', reason } })).toBeUndefined();
  for (const invalid of ['cli-missing', null, true]) {
    expect(readHostMessage({ ...message, connection: { status: 'unavailable', reason: invalid } })).toBeUndefined();
  }
});

it('preserves model connection failure independently and rejects malformed flags', () => {
  const message = { type: 'host.connection', sequence: 2, conversationId: 'conversation-1', sessionId: 'session-1',
    connection: { status: 'connected', modelRequestFailed: true } };
  expect(readHostMessage(message)).toEqual(message);
  for (const value of ['true', false, null, 1]) {
    expect(readHostMessage({ ...message, connection: { ...message.connection, modelRequestFailed: value } })).toBeUndefined();
  }
});
