import { afterEach, expect, it, vi } from 'vitest';
import { readControllerIde, reconnectControllerIde, reconnectRecoveredIde, type NativeIdeBackend } from './ideIntegration';
import { reconcileDaemonTurn } from './recovery/recovery';
import { createTurnActivityState } from './turns/turnActivityState';
import {
  catalogEntry, createCatalog, createController, createMockRuntime, ready, snapshots,
  waitForConnected, type ChatController, type SessionHistoryLoader,
} from './controllerTestHarness';

const controllers: ChatController[] = [];
afterEach(async () => { await Promise.all(controllers.splice(0).map(controller => controller.dispose())); });

async function fixture(status: 'error' | 'disconnected') {
  const original = createMockRuntime();
  const replacement = createMockRuntime();
  const factory = vi.fn().mockReturnValueOnce(original).mockReturnValue(replacement);
  const history: SessionHistoryLoader = { loadHistory: vi.fn(async () => ({
    status: 'available' as const,
    state: { transcript: [], historyStatus: 'complete' as const, truncated: false },
  })) };
  const result = createController(factory, { cwd: 'C:\\workspace-a', trusted: true },
    createCatalog([catalogEntry('session-1')]), undefined, history);
  controllers.push(result.controller);
  ready(result.controller);
  await waitForConnected(result.messages);
  const backend = {
    read: vi.fn<NativeIdeBackend['read']>(() => ({ status, message: 'The native IDE service could not be restored.' })),
    reconnect: vi.fn<NativeIdeBackend['reconnect']>(async (_id, _current, closing) => {
      closing();
      backend.read.mockReturnValue({ status: 'connected', message: 'Connected.' });
      return true;
    }),
  };
  result.controller.nativeIde = backend;
  return { ...result, original, replacement, backend };
}

it.each(['error', 'disconnected'] as const)('defers an IDE %s until the recovered background turn ends', async status => {
  const { controller, messages, original, replacement, backend } = await fixture(status);
  let working = true;
  original.readSessionWorkingState = vi.fn(async () => working ? 'running' : 'idle');
  reconcileDaemonTurn(controller, original, controller.sessionState.runtimeGeneration, 'session-1', 'C:\\workspace-a');
  await vi.waitFor(() => expect(controller.turnState.turn?.status).toBe('streaming'));
  expect(readControllerIde(controller)).toMatchObject({ status, canReconnect: false,
    message: 'The background task is still running. Wait for it to finish or stop it before reconnecting IDE.' });
  await reconnectControllerIde(controller, 'session-1');
  expect(backend.reconnect).not.toHaveBeenCalled();
  expect(original.dispose).not.toHaveBeenCalled();
  working = false;
  await vi.waitFor(() => expect(backend.reconnect).toHaveBeenCalledOnce(), { timeout: 2500 });
  await vi.waitFor(() => expect(controller.ideReconnectInProgress).toBe(false));
  expect(backend.reconnect.mock.calls[0]?.[3]).toBe(true);
  expect(replacement.initialize).toHaveBeenCalledWith({ kind: 'resume', sessionId: 'session-1', cwd: 'C:\\workspace-a' });
  expect(snapshots(messages).at(-1)?.connection.status).toBe('connected');
  expect(original.interrupt).not.toHaveBeenCalled();
  expect(original.sendTurn).not.toHaveBeenCalled();
  expect(replacement.sendTurn).not.toHaveBeenCalled();
});

it('keeps a failed automatic IDE recovery retryable without repeatedly restarting', async () => {
  const { controller, original, replacement, backend } = await fixture('error');
  controller.turnState.turn = { turnId: 'saved-turn', status: 'completed', activity: createTurnActivityState() };
  backend.reconnect.mockRejectedValue(new Error('IDE service unavailable'));
  const generation = controller.sessionState.runtimeGeneration;
  reconnectRecoveredIde(controller, original, generation, 'session-1', 'C:\\workspace-a');
  await vi.waitFor(() => expect(backend.reconnect).toHaveBeenCalledOnce());
  await vi.waitFor(() => expect(controller.ideReconnectInProgress).toBe(false));
  reconnectRecoveredIde(controller, original, generation, 'session-1', 'C:\\workspace-a');
  expect(backend.reconnect).toHaveBeenCalledOnce();
  expect(readControllerIde(controller)).toMatchObject({ status: 'error', canReconnect: true,
    message: 'IDE recovery failed. Retry, or run Droid: Open Logs to see the failure details.' });
  expect(original.dispose).not.toHaveBeenCalled();
  expect(original.interrupt).not.toHaveBeenCalled();
  expect(replacement.initialize).not.toHaveBeenCalled();
});
