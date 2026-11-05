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
  controllers.push(controller);
  ready(controller); await waitForConnected(messages);
  send(controller, 'session-1', 'ui-turn', 'Continue');
  return { controller, runtime, messages };
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
});
