import { EventEmitter } from 'node:events';
import type { DaemonSessionController } from '@factory/droid-sdk';
import { expect, it, vi } from 'vitest';
import { RetainedDaemonSession } from './sessionHandle';

async function setup() {
  const controller = Object.assign(new EventEmitter(), {
    addUserMessage: vi.fn(async (..._args: unknown[]) => ({})), interruptSession: vi.fn(async () => ({})),
  });
  const handle = new RetainedDaemonSession(controller as unknown as DaemonSessionController, 's1', {}, vi.fn());
  const stream = handle.stream('Original', { includePartialMessages: true, backendTurnId: 'original' });
  const next = stream.next();
  await vi.waitFor(() => expect(controller.addUserMessage).toHaveBeenCalledOnce());
  const notify = (notification: object, sessionId = 's1') => controller.emit('sessionNotification', { sessionId, notification });
  return { controller, handle, stream, next, notify };
}
const user = (id: string) => ({ type: 'create_message', message: {
  id, role: 'user', content: [{ type: 'text', text: 'Correction' }], createdAt: 1, updatedAt: 1,
} });

it('steers the existing loop, waits for consumption, and keeps its stream alive', async () => {
  const h = await setup();
  const consumed = vi.fn();
  const pending = h.handle.steer('guide', 'Correction', {}).then(consumed);
  await vi.waitFor(() => expect(h.controller.addUserMessage).toHaveBeenCalledTimes(2));
  expect(h.controller.addUserMessage).toHaveBeenLastCalledWith('s1', expect.objectContaining({
    messageId: 'guide', text: 'Correction', queuePlacement: 'end_of_turn',
  }), 'guide');
  expect(consumed).not.toHaveBeenCalled();
  h.notify(user('guide'), 'other-session');
  h.notify(user('another-message'));
  expect(consumed).not.toHaveBeenCalled();
  h.notify(user('guide'));
  await pending;
  expect(consumed).toHaveBeenCalledOnce();
  expect(h.controller.interruptSession).not.toHaveBeenCalled();
  await h.handle.detach(); await h.next;
});

it('preserves an unconsumed message on a daemon discard and never resends it', async () => {
  const h = await setup();
  const pending = expect(h.handle.steer('guide', 'Correction', {})).rejects.toThrow('discarded');
  h.notify({ type: 'queued_messages_discarded', text: 'Correction', requestId: 'guide' });
  await pending;
  expect(h.controller.addUserMessage).toHaveBeenCalledTimes(2);
  await h.handle.detach(); await h.next;
});

it('ends unconfirmed delivery on transport loss without interrupting or retrying', async () => {
  const h = await setup();
  const pending = expect(h.handle.steer('guide', 'Correction', {})).rejects.toThrow('connection loss');
  h.handle.suspendTransport(); await pending;
  await expect(h.handle.steer('late', 'Late', {})).rejects.toThrow('no longer');
  expect(h.controller.addUserMessage).toHaveBeenCalledTimes(2);
  expect(h.controller.interruptSession).not.toHaveBeenCalled();
  await h.handle.detach(); await h.next;
});

it('does not start a new loop when steering arrives after completion', async () => {
  const h = await setup();
  h.notify({ type: 'agent_turn_completed', turnId: 'original', reason: 'completed', tokenUsage: {
    inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, thinkingTokens: 0,
  } });
  await h.next; await h.stream.next();
  await expect(h.handle.steer('late', 'Late', {})).rejects.toThrow('no active turn');
  expect(h.controller.addUserMessage).toHaveBeenCalledOnce();
  await h.handle.detach();
});
