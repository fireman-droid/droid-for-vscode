import { afterEach, expect, it, vi } from 'vitest';
import { RuntimeTurnRecoveryError } from '../../runtime/turnRecovery';
import type { RuntimeEvent } from '../../runtime/runtimeEvents';
import {
  catalogEntry, createCatalog, createController, createMockRuntime, ready, send, snapshots, turnStates,
  waitForConnected, type ChatController, type SessionHistoryLoader,
} from './controllerTestHarness';

// Recovery only: the captured workspace is independent of the history window.
vi.mock('./changes/snapshotCapture', () => ({ captureSnapshotBeforeSend: async () => {} }));
const controllers: ChatController[] = [];
afterEach(async () => { await Promise.all(controllers.splice(0).map(controller => controller.dispose())); });

it.each([
  ['success', 'completed'], ['error_during_execution', 'failed'], [undefined, 'failed'],
] as const)('settles bounded history from the exact %s outcome without resending', async (outcome, status) => {
  let finished = false;
  let completion: Extract<RuntimeEvent, { type: 'turn-complete' }> | undefined;
  const runtime = createMockRuntime(async function* () {
    yield { type: 'text-delta', text: 'Starting' };
    throw new RuntimeTurnRecoveryError('submitted-prompt', () => completion, () => {});
  });
  runtime.readSessionWorkingState = vi.fn(async () => finished ? 'idle' as const : 'running' as const);
  runtime.readTurnOutcome = vi.fn(async () => null);
  const history: SessionHistoryLoader = { loadHistory: vi.fn(async () => ({
    status: 'available' as const,
    state: { historyStatus: 'partial' as const, truncated: true, transcript: [
      ...Array.from({ length: 1998 }, (_, index) => ({
        id: `old-${index}`, kind: 'assistant' as const, turnId: 'old-turn', text: 'Earlier activity',
      })),
      { id: 'user', kind: 'user' as const, messageId: 'submitted-prompt', text: 'Continue' },
      { id: 'answer', kind: 'assistant' as const, turnId: 'history-turn', text: finished ? 'Final answer' : 'Starting' },
    ] },
  })) };
  const { controller, messages } = createController(() => runtime, undefined,
    createCatalog([catalogEntry('session-1')]), undefined, history);
  controllers.push(controller);
  ready(controller);
  await waitForConnected(messages);
  send(controller, 'session-1', 'ui-turn', 'Continue');
  await vi.waitFor(() => expect(controller.turnState.turn?.transportRecovery).toBeDefined());
  completion = outcome ? { type: 'turn-complete', outcome } : undefined;
  finished = true;
  await vi.waitFor(() => expect(turnStates(messages).at(-1)?.status).toBe(status), { timeout: 5000 });
  expect(runtime.sendTurn).toHaveBeenCalledOnce();
  if (outcome) {
    expect(snapshots(messages).at(-1)).toMatchObject({ historyStatus: 'partial', truncated: true });
    expect(snapshots(messages).at(-1)?.transcript).toContainEqual(expect.objectContaining({ text: 'Final answer', turnId: 'ui-turn' }));
    expect(messages.some(message => message.type === 'runtime.diagnostic' && message.code === 'recovered-turn-history-failed')).toBe(false);
  } else {
    expect(messages).toContainEqual(expect.objectContaining({ type: 'turn.error', code: 'recovered-turn-history-failed' }));
  }
});
