import { afterEach, expect, it, vi } from 'vitest';
import { projectDurableTurnOutcome, type DaemonTurnOutcome, type RuntimeTurnOutcome } from '../../runtime/turnOutcome';
import {
  createController, createMockRuntime, deferred, ready, send,
  turnStates, waitForConnected, type ChatController,
} from './controllerTestHarness';

const controllers: ChatController[] = [];
afterEach(async () => { await Promise.all(controllers.splice(0).map(ctl => ctl.dispose())); });

async function setup(read: () => Promise<RuntimeTurnOutcome | null>) {
  const runtime = Object.assign(createMockRuntime(async function* () {
    yield { type: 'turn-identity', backendTurnId: 'submission' };
  }), { readTurnOutcome: vi.fn(read) });
  const { controller, messages } = createController(() => runtime);
  const record = vi.spyOn(controller, 'recordHost');
  controllers.push(controller);
  ready(controller); await waitForConnected(messages);
  send(controller, 'session-1', 'ui-turn', 'Continue');
  return { controller, runtime, messages, record };
}

it.each([
  ['completed', 'completed'], ['cancelled', 'interrupted'], ['error', 'failed'],
] as const)('uses the persisted %s outcome when the stream closes without its terminal event', async (reason, status) => {
  const result = await setup(async () => projectDurableTurnOutcome('session-1', 'submission', {
    type: 'agent_turn_outcome', turnId: 'submission', reason: reason as DaemonTurnOutcome['reason'], resultKind: 'text',
  }));
  await vi.waitFor(() => expect(turnStates(result.messages).at(-1)?.status).toBe(status));
  expect(result.runtime.readTurnOutcome).toHaveBeenCalledExactlyOnceWith('submission');
  expect(result.runtime.sendTurn).toHaveBeenCalledOnce();
  expect(result.runtime.interrupt).not.toHaveBeenCalled();
  const settled = result.record.mock.calls.map(([event]) => event).filter(event => event.name === 'host.turn.settled');
  expect(settled).toHaveLength(1);
  expect(settled[0]?.attributes).toMatchObject({ outcome: status, source: 'durable' });
});

it.each(['missing', 'wrong-turn', 'query-failed'] as const)('does not infer success from a %s outcome', async kind => {
  const result = await setup(async () => {
    if (kind === 'query-failed') throw new Error('disconnected');
    return kind === 'missing' ? null : projectDurableTurnOutcome('session-1', 'other-turn', {
      type: 'agent_turn_outcome', turnId: 'other-turn', reason: 'completed' as DaemonTurnOutcome['reason'], resultKind: 'text',
    });
  });
  await vi.waitFor(() => expect(turnStates(result.messages).at(-1)?.status).toBe('failed'));
  expect(result.messages).toContainEqual(expect.objectContaining({ type: 'turn.error', code: 'runtime-stream-ended' }));
  expect(result.runtime.sendTurn).toHaveBeenCalledOnce();
  expect(result.record.mock.calls.map(([event]) => event)).toContainEqual(expect.objectContaining({
    name: 'host.turn.settled', attributes: expect.objectContaining({ outcome: 'failed' }),
  }));
});

it('ignores an old outcome after the current turn changes during the lookup', async () => {
  const lookup = deferred<RuntimeTurnOutcome | null>();
  const result = await setup(() => lookup.promise);
  await vi.waitFor(() => expect(result.runtime.readTurnOutcome).toHaveBeenCalledOnce());
  result.controller.effects.beginTurn({ turnId: 'replacement', status: 'streaming' });
  lookup.resolve(projectDurableTurnOutcome('session-1', 'submission', {
    type: 'agent_turn_outcome', turnId: 'submission', reason: 'completed' as DaemonTurnOutcome['reason'], resultKind: 'text',
  }));
  await new Promise(resolve => setImmediate(resolve));
  expect(result.controller.turnState.turn).toMatchObject({ turnId: 'replacement', status: 'streaming' });
  expect(result.runtime.sendTurn).toHaveBeenCalledOnce();
  expect(result.record.mock.calls.map(([event]) => event).filter(event => event.name === 'host.turn.settled')).toHaveLength(0);
});

it('records one first response and one final result for a streamed reply', async () => {
  const runtime = createMockRuntime(async function* () {
    yield { type: 'text-delta', text: 'private reply' };
    yield { type: 'text-delta', text: 'more private reply' };
    yield { type: 'turn-complete', outcome: 'success' };
  });
  const { controller, messages } = createController(() => runtime);
  controllers.push(controller);
  const record = vi.spyOn(controller, 'recordHost');
  ready(controller); await waitForConnected(messages);
  send(controller, 'session-1', 'ui-turn', 'private prompt');
  await vi.waitFor(() => expect(turnStates(messages).at(-1)?.status).toBe('completed'));
  const lifecycle = record.mock.calls.map(([event]) => event).filter(event =>
    event.name === 'host.turn.first-response' || event.name === 'host.turn.settled');
  expect(lifecycle.map(event => event.name)).toEqual(['host.turn.first-response', 'host.turn.settled']);
  expect(lifecycle[0]?.attributes?.durationMs).toBeGreaterThanOrEqual(0);
  expect(JSON.stringify(lifecycle)).not.toContain('private');
});
