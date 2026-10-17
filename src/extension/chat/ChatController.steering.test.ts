import { expect, it, vi } from 'vitest';
import { createController, createMockRuntime, deferred, queueAdd, queueStates, ready, send,
  successfulTurn, waitForConnected } from './controllerTestHarness';

async function setup(mode: 'wait' | 'steer' = 'steer') {
  const done = deferred<void>();
  const delivered = deferred<void>();
  const runtime = { ...createMockRuntime(async function* () {
    yield { type: 'text-delta' as const, text: 'Before guidance' };
    await done.promise;
    yield { type: 'text-delta' as const, text: 'After guidance' };
    yield successfulTurn();
  }), steerTurn: vi.fn(() => delivered.promise) };
  const h = createController(() => runtime);
  vi.spyOn(h.controller, 'readBusyMessageMode').mockReturnValue(mode);
  ready(h.controller); await waitForConnected(h.messages);
  send(h.controller, 'session-1', 'original', 'Work');
  await vi.waitFor(() => expect(h.controller.turnState.turn?.status).toBe('streaming'));
  return { ...h, runtime, done, delivered };
}

it('keeps waiting as the default behavior even while the daemon supports steering', async () => {
  const h = await setup('wait');
  queueAdd(h.controller, 'session-1', 'q1', 'Follow up');
  expect(h.runtime.steerTurn).not.toHaveBeenCalled();
  expect(queueStates(h.messages).at(-1)?.items[0]?.text).toBe('Follow up');
  h.done.resolve();
  await vi.waitFor(() => expect(h.runtime.sendTurn).toHaveBeenCalledTimes(2));
  h.controller.dispose();
});

it('keeps full text pending until confirmed, then inserts it without interrupting the active turn', async () => {
  const h = await setup();
  const text = 'A long correction\n'.repeat(100);
  queueAdd(h.controller, 'session-1', 'q1', text);
  expect(h.runtime.steerTurn).toHaveBeenCalledWith('q1', text, []);
  expect(queueStates(h.messages).at(-1)?.items[0]).toMatchObject({ text, steering: true });
  expect(h.controller.recoveryState.transcript.transcript.some(item => item.kind === 'user' && item.text === text)).toBe(false);
  h.controller.handleMessage({ type: 'queue.clear', sessionId: 'session-1' });
  expect(h.controller.queueState.queuedPrompts.items).toHaveLength(1);
  h.delivered.resolve();
  await vi.waitFor(() => expect(h.controller.queueState.queuedPrompts.items).toHaveLength(0));
  expect(h.runtime.interrupt).not.toHaveBeenCalled();
  expect(h.runtime.sendTurn).toHaveBeenCalledOnce();
  expect(h.controller.turnState.turn?.turnId).toBe('original');
  expect(h.controller.recoveryState.transcript.transcript).toContainEqual(expect.objectContaining({ kind: 'user', text, messageId: 'q1' }));
  h.done.resolve();
  await vi.waitFor(() => expect(h.controller.turnState.turn?.status).toBe('completed'));
  const rows = h.controller.recoveryState.transcript.transcript;
  expect(rows.filter(item => item.kind === 'assistant').map(item => item.text)).toEqual(['Before guidance', 'After guidance']);
  h.controller.dispose();
});

it('pauses failed steering and does not automatically resend it when the turn finishes', async () => {
  const h = await setup();
  queueAdd(h.controller, 'session-1', 'q1', 'Correction');
  h.delivered.reject(new Error('Connection lost; delivery unknown'));
  await vi.waitFor(() => expect(h.controller.queueState.queuedPrompts.paused).toBe('dispatch-blocked'));
  h.done.resolve();
  await vi.waitFor(() => expect(h.controller.turnState.turn?.status).toBe('completed'));
  expect(h.runtime.sendTurn).toHaveBeenCalledOnce();
  expect(queueStates(h.messages).at(-1)?.items).toEqual([expect.objectContaining({ queueId: 'q1', text: 'Correction' })]);
  expect(h.runtime.interrupt).not.toHaveBeenCalled();
  h.controller.dispose();
});
