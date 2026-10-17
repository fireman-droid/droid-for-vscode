import { afterEach, expect, it, vi } from 'vitest';
import { SESSION_CONNECTION_RETRY_MS } from './sessions/sessionConnectionMaintenance';
import type { NativeIdeBackend } from './ideIntegration';
import { readControllerIde } from './ideIntegration';
import {
  available, catalogEntry, createCatalog, createController, createMockRuntime, deferred,
  ready, send, waitForConnected, type ChatController, type MockRuntime, type RuntimeAvailability,
  type SessionHistoryLoader,
} from './controllerTestHarness';

const controllers: ChatController[] = [];
afterEach(async () => {
  await Promise.all(controllers.splice(0).map(controller => controller.dispose()));
  vi.useRealTimers();
});

async function fixture() {
  const original = createMockRuntime();
  const replacement = createMockRuntime();
  const factory = vi.fn<() => MockRuntime>().mockReturnValueOnce(original).mockReturnValue(replacement);
  const workspace = { cwd: 'C:\\workspace', trusted: true };
  const history: SessionHistoryLoader = { loadHistory: vi.fn(async () => ({
    status: 'available' as const,
    state: { transcript: [], historyStatus: 'complete' as const, truncated: false },
  })) };
  const result = createController(factory, workspace, createCatalog([catalogEntry('session-1')]), undefined, history);
  controllers.push(result.controller);
  ready(result.controller);
  await waitForConnected(result.messages);
  await result.controller.sessionState.initialization;
  const nativeIde = {
    read: vi.fn<NativeIdeBackend['read']>(() => ({ status: 'connected', message: 'Connected.' })),
    readTransport: vi.fn(() => 'connected' as 'connected' | 'failed' | 'recovering' | 'auth-error'),
    reconnect: vi.fn(async () => false),
  };
  result.controller.nativeIde = nativeIde;
  // Restart the periodic timer under the fake clock, using the production entry point.
  vi.useFakeTimers();
  await result.controller.connectionMaintenance.check();
  return { ...result, workspace, original, replacement, factory, nativeIde };
}

it('keeps retrying the original unavailable session and stops once it is connected', async () => {
  const f = await fixture();
  f.controller.sessionState.connection = { status: 'unavailable' };
  f.replacement.initialize.mockRejectedValue(new Error('backend unavailable'));
  await vi.advanceTimersByTimeAsync(3 * SESSION_CONNECTION_RETRY_MS);
  expect(f.replacement.initialize).toHaveBeenCalledTimes(3);
  expect(f.replacement.initialize).toHaveBeenLastCalledWith({ kind: 'resume', sessionId: 'session-1', cwd: 'C:\\workspace' });
  f.replacement.initialize.mockResolvedValue(available());
  await vi.advanceTimersByTimeAsync(SESSION_CONNECTION_RETRY_MS);
  expect(f.controller.sessionState.connection.status).toBe('connected');
  await vi.advanceTimersByTimeAsync(3 * SESSION_CONNECTION_RETRY_MS);
  expect(f.replacement.initialize).toHaveBeenCalledTimes(4);
  expect(f.original.dispose).toHaveBeenCalledWith({ preserveBackendTurn: true });
  expect(f.original.interrupt).not.toHaveBeenCalled();
  expect(f.replacement.sendTurn).not.toHaveBeenCalled();
});

it('restores a failed initial attachment without creating a new conversation', async () => {
  const f = await fixture();
  f.controller.sessionState.runtime = null;
  f.controller.sessionState.activeRuntimeCwd = null;
  f.controller.sessionState.connection = { status: 'unavailable' };
  await f.controller.connectionMaintenance.check();
  expect(f.replacement.initialize).toHaveBeenCalledWith({ kind: 'resume', sessionId: 'session-1', cwd: 'C:\\workspace' });
  expect(f.controller.sessionState.sessionId).toBe('session-1');
});

it('does not invent a new chat when there is no known original session', async () => {
  const f = await fixture();
  f.controller.sessionState.sessionId = null;
  f.controller.sessionState.connection = { status: 'unavailable' };
  await vi.advanceTimersByTimeAsync(3 * SESSION_CONNECTION_RETRY_MS);
  expect(f.factory).toHaveBeenCalledOnce();
});

it('does not overlap attempts, even with repeated focus and ready notifications', async () => {
  const f = await fixture();
  const attempt = deferred<RuntimeAvailability>();
  f.replacement.initialize.mockImplementation(() => attempt.promise);
  f.controller.sessionState.connection = { status: 'unavailable' };
  const recovering = f.controller.connectionMaintenance.check();
  await vi.advanceTimersByTimeAsync(0);
  ready(f.controller);
  await f.controller.connectionMaintenance.check();
  await vi.advanceTimersByTimeAsync(5 * SESSION_CONNECTION_RETRY_MS);
  expect(f.replacement.initialize).toHaveBeenCalledOnce();
  attempt.resolve(available());
  await recovering;
  expect(f.controller.sessionState.connection.status).toBe('connected');
});

it('stops on dispose and ignores a late initialization result', async () => {
  const f = await fixture();
  const attempt = deferred<RuntimeAvailability>();
  f.replacement.initialize.mockImplementation(() => attempt.promise);
  f.controller.sessionState.connection = { status: 'unavailable' };
  const recovering = f.controller.connectionMaintenance.check();
  await vi.advanceTimersByTimeAsync(0);
  await f.controller.dispose();
  const count = f.messages.length;
  attempt.resolve(available());
  await recovering;
  await vi.advanceTimersByTimeAsync(5 * SESSION_CONNECTION_RETRY_MS);
  expect(f.factory).toHaveBeenCalledTimes(2);
  expect(f.messages).toHaveLength(count);
});

it.each(['recovering', 'auth-error'] as const)('does not replace a transport that is %s', async status => {
  const f = await fixture();
  f.nativeIde.readTransport.mockReturnValue(status);
  await vi.advanceTimersByTimeAsync(3 * SESSION_CONNECTION_RETRY_MS);
  expect(f.factory).toHaveBeenCalledOnce();
  expect(f.nativeIde.reconnect).not.toHaveBeenCalled();
  expect(readControllerIde(f.controller).status).toBe(status === 'recovering' ? 'reconnecting' : 'error');
});

it('stops automatic attachment retries when sign-in is required', async () => {
  const f = await fixture();
  f.controller.sessionState.connection = { status: 'unavailable' };
  f.replacement.initialize.mockResolvedValue({ status: 'unavailable', sdkVersion: 'test', cliVersion: null,
    authenticationStatus: 'unknown', reason: 'daemon-not-logged-in', message: 'Sign in.' });
  await vi.advanceTimersByTimeAsync(5 * SESSION_CONNECTION_RETRY_MS);
  expect(f.replacement.initialize).toHaveBeenCalledOnce();
  expect(f.controller.sessionState.connection.status).toBe('unavailable');
});

it('defers IDE recovery while a task is running and resumes after it finishes', async () => {
  const f = await fixture();
  const turn = deferred<void>();
  f.original.supportsBackgroundTurns = () => true;
  f.original.sendTurn.mockImplementation(async function* () { await turn.promise; yield { type: 'turn-complete', outcome: 'success' }; });
  f.nativeIde.read.mockReturnValue({ status: 'error', message: 'Lost heartbeat.' });
  send(f.controller, 'session-1', 'task', 'Run once');
  await vi.advanceTimersByTimeAsync(3 * SESSION_CONNECTION_RETRY_MS);
  expect(f.original.sendTurn).toHaveBeenCalledOnce();
  expect(f.nativeIde.reconnect).not.toHaveBeenCalled();
  expect(f.original.interrupt).not.toHaveBeenCalled();
  turn.resolve();
  await vi.advanceTimersByTimeAsync(SESSION_CONNECTION_RETRY_MS);
  expect(f.nativeIde.reconnect).toHaveBeenCalledOnce();
  expect(f.replacement.sendTurn).not.toHaveBeenCalled();
});

it('only detaches a live background turn when its daemon has failed', async () => {
  const f = await fixture();
  const turn = deferred<void>();
  f.original.supportsBackgroundTurns = () => true;
  f.original.sendTurn.mockImplementation(async function* () { await turn.promise; yield { type: 'turn-complete', outcome: 'success' }; });
  send(f.controller, 'session-1', 'task', 'Run once');
  await vi.advanceTimersByTimeAsync(0);
  f.nativeIde.readTransport.mockReturnValue('failed');
  await f.controller.connectionMaintenance.check();
  expect(f.original.dispose).toHaveBeenCalledWith({ preserveBackendTurn: true });
  expect(f.original.interrupt).not.toHaveBeenCalled();
  expect(f.replacement.initialize).toHaveBeenCalledWith({ kind: 'resume', sessionId: 'session-1', cwd: 'C:\\workspace' });
  expect(f.replacement.sendTurn).not.toHaveBeenCalled();
  turn.resolve();
});

it('does not reconnect a switched or untrusted workspace', async () => {
  const f = await fixture();
  f.controller.sessionState.connection = { status: 'unavailable' };
  f.workspace.trusted = false;
  await f.controller.connectionMaintenance.check();
  expect(f.factory).toHaveBeenCalledOnce();
});
