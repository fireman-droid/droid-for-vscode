import { afterEach, expect, it, vi } from 'vitest';
import { RuntimeTurnRecoveryError } from '../../runtime/turnRecovery';
import type { RuntimeEvent } from '../../runtime/runtimeEvents';
import {
  catalogEntry, createCatalog, createController, createMockRuntime, deferred, ready, send,
  snapshots, stop, turnStates, waitForConnected,
  type ChatController, type RuntimeSessionWorkingState, type SessionHistoryLoader,
} from './controllerTestHarness';
import { RECOVERED_FINAL_HISTORY_TIMEOUT_MS } from './recovery/recovery';

const controllers: ChatController[] = [];
afterEach(async () => {
  await Promise.all(controllers.splice(0).map(controller => controller.dispose()));
  vi.useRealTimers();
});

async function recoveredTurn() {
  let working: RuntimeSessionWorkingState = 'idle';
  let text = 'Partial';
  let completion: Extract<RuntimeEvent, { type: 'turn-complete' }> | undefined;
  const release = vi.fn();
  const runtime = createMockRuntime(async function* () {
    yield { type: 'text-delta', text: 'Partial' };
    throw new RuntimeTurnRecoveryError('saved-prompt', () => completion, release);
  });
  runtime.readSessionWorkingState = vi.fn(async () => working);
  runtime.interruptSession = vi.fn(async () => { working = 'idle'; });
  const history: SessionHistoryLoader = { loadHistory: vi.fn<SessionHistoryLoader['loadHistory']>(async () => ({
    status: 'available',
    state: { historyStatus: 'complete', truncated: false, transcript: [
      { id: 'saved-user', kind: 'user', messageId: 'saved-prompt', text: 'Continue' },
      { id: 'saved-answer', kind: 'assistant', turnId: 'history-turn', text },
    ] },
  })) };
  const result = createController(() => runtime, undefined,
    createCatalog([catalogEntry('session-1')]), undefined, history);
  controllers.push(result.controller);
  ready(result.controller);
  await waitForConnected(result.messages);
  working = 'running';
  send(result.controller, 'session-1', 'original-ui-turn', 'Continue');
  await vi.waitFor(() => {
    expect(result.controller.turnState.turn).toMatchObject({
      turnId: 'original-ui-turn', status: 'streaming', recovery: true,
      transportRecovery: { messageId: 'saved-prompt' },
    });
    expect(snapshots(result.messages).at(-1)?.transcript).toContainEqual(
      expect.objectContaining({ id: 'saved-answer', turnId: 'original-ui-turn', text: 'Partial' }));
  });
  return { ...result, runtime, release, history,
    finish(value?: typeof completion) { completion = value; text = 'Complete answer'; working = 'idle'; },
    progress(value: string) { text = value; },
  };
}

it('keeps an admitted prompt on its original UI turn while history catches up without resending', async () => {
  const result = await recoveredTurn();
  result.progress('Partial with more progress');
  await vi.waitFor(() => expect(snapshots(result.messages).at(-1)?.transcript).toContainEqual(
    expect.objectContaining({ id: 'saved-answer', turnId: 'original-ui-turn', text: 'Partial with more progress' })),
  { timeout: 4_000 });
  result.finish({ type: 'turn-complete', outcome: 'success' });
  await vi.waitFor(() => expect(turnStates(result.messages).at(-1)?.status).toBe('completed'));
  expect(snapshots(result.messages).at(-1)?.transcript).toContainEqual(
    expect.objectContaining({ id: 'saved-answer', turnId: 'original-ui-turn', text: 'Complete answer' }));
  expect(result.runtime.sendTurn).toHaveBeenCalledOnce();
  expect(result.runtime.interrupt).not.toHaveBeenCalled();
  expect(result.release).toHaveBeenCalled();
  expect(result.messages.filter(message => message.type === 'turn.error')).toHaveLength(0);
});

it('retains uncertainty when restored history has no matching terminal result', async () => {
  const result = await recoveredTurn();
  result.finish();
  await vi.waitFor(() => expect(turnStates(result.messages).at(-1)?.status).toBe('completed'));
  expect(result.messages).toContainEqual(expect.objectContaining({
    type: 'runtime.diagnostic', code: 'transport-recovered-outcome-unconfirmed', turnId: 'original-ui-turn',
  }));
  expect(result.runtime.sendTurn).toHaveBeenCalledOnce();
});

it('uses the real failed result after reconnect instead of inferring success from idle', async () => {
  const result = await recoveredTurn();
  result.finish({ type: 'turn-complete', outcome: 'error_during_execution' });
  await vi.waitFor(() => expect(turnStates(result.messages).at(-1)?.status).toBe('failed'));
  expect(snapshots(result.messages).at(-1)?.transcript).toContainEqual(
    expect.objectContaining({ id: 'saved-answer', text: 'Complete answer' }));
  expect(result.runtime.sendTurn).toHaveBeenCalledOnce();
  expect(result.release).toHaveBeenCalled();
});

it('stops the existing daemon turn during catch-up without submitting the prompt again', async () => {
  const result = await recoveredTurn();
  stop(result.controller, 'session-1', 'original-ui-turn');
  await vi.waitFor(() => expect(turnStates(result.messages).at(-1)?.status).toBe('interrupted'));
  expect(result.runtime.interruptSession).toHaveBeenCalledOnce();
  expect(result.runtime.interrupt).not.toHaveBeenCalled();
  expect(result.runtime.sendTurn).toHaveBeenCalledOnce();
  expect(result.release).toHaveBeenCalled();
});

it('bounds a stuck live history refresh so the next idle check can settle the same turn', async () => {
  vi.useFakeTimers();
  const result = await recoveredTurn();
  const stuck = deferred<Awaited<ReturnType<SessionHistoryLoader['loadHistory']>>>();
  vi.mocked(result.history.loadHistory).mockImplementationOnce(() => stuck.promise);
  await vi.advanceTimersByTimeAsync(2_000);
  result.finish({ type: 'turn-complete', outcome: 'success' });
  await vi.advanceTimersByTimeAsync(RECOVERED_FINAL_HISTORY_TIMEOUT_MS + 500);
  expect(turnStates(result.messages).at(-1)?.status).toBe('completed');
  stuck.resolve({ status: 'available', state: {
    historyStatus: 'complete', truncated: false, transcript: [
      { id: 'late-stale-answer', kind: 'assistant', turnId: 'stale', text: 'Stale partial' },
    ],
  } });
  await vi.advanceTimersByTimeAsync(0);
  expect(snapshots(result.messages).at(-1)?.transcript).not.toContainEqual(
    expect.objectContaining({ id: 'late-stale-answer' }));
  expect(result.runtime.sendTurn).toHaveBeenCalledOnce();
});
