import { afterEach, expect, it, vi } from 'vitest';
import { reconnectControllerIde, type NativeIdeBackend } from './ideIntegration';
import { reconcileDaemonTurn } from './recovery/recovery';
import { startReplacement } from './sessions/runtimeLifecycle';
import { createTurnActivityState } from './turns/turnActivityState';
import {
  available, catalogEntry, createCatalog, createController, createMockRuntime, deferred,
  ready, send, snapshots, waitForConnected, type ChatController, type MockRuntime,
  type SessionHistoryLoader, type RuntimeAvailability,
} from './controllerTestHarness';

const controllers: ChatController[] = [];
afterEach(async () => { await Promise.all(controllers.splice(0).map(controller => controller.dispose())); });

async function fixture() {
  const workspace = { cwd: 'C:\\workspace-a', trusted: true };
  const original = createMockRuntime();
  const replacement = createMockRuntime();
  const factory = vi.fn<() => MockRuntime>().mockReturnValueOnce(original).mockReturnValue(replacement);
  const catalog = createCatalog([catalogEntry('session-1')]);
  const history: SessionHistoryLoader = { loadHistory: vi.fn<SessionHistoryLoader['loadHistory']>(async () => ({
    status: 'available', state: { transcript: [], historyStatus: 'complete', truncated: false },
  })) };
  const result = createController(factory, workspace, catalog, undefined, history);
  controllers.push(result.controller);
  ready(result.controller);
  await waitForConnected(result.messages);
  const backend = { read: vi.fn<NativeIdeBackend['read']>(() => ({ status: 'connected', message: 'Connected to IDE.' })),
    reconnect: vi.fn<NativeIdeBackend['reconnect']>(async (_sessionId, _current, onClosingSource) => { onClosingSource(); return true; }) };
  result.controller.nativeIde = backend;
  return { ...result, workspace, original, replacement, backend, catalog, history, factory };
}

it('reports reconnection then session restoration, resumes the same session and accepts the next prompt', async () => {
  const { controller, messages, original, replacement, backend } = await fixture();
  const initialization = deferred<RuntimeAvailability>();
  replacement.initialize.mockImplementation(() => initialization.promise);
  const reconnect = reconnectControllerIde(controller, 'session-1');
  expect(messages.at(-1)).toMatchObject({ type: 'host.ide', ide: {
    status: 'reconnecting', canReconnect: false, message: 'Reconnecting this conversation to the IDE…',
  } });
  await vi.waitFor(() => expect(replacement.initialize).toHaveBeenCalledOnce());
  expect(snapshots(messages).at(-1)).toMatchObject({ connection: { status: 'connecting' }, ide: {
    status: 'reconnecting', canReconnect: false, message: 'Restoring this conversation on its new IDE connection…',
  } });
  initialization.resolve(available());
  await reconnect;
  expect(backend.reconnect).toHaveBeenCalledOnce();
  expect(original.dispose).toHaveBeenCalledOnce();
  expect(replacement.initialize).toHaveBeenCalledWith({ kind: 'resume', sessionId: 'session-1', cwd: 'C:\\workspace-a' });
  expect(snapshots(messages).at(-1)).toMatchObject({ sessionId: 'session-1', connection: { status: 'connected' } });
  expect(messages.at(-1)).toMatchObject({ type: 'host.ide', ide: { status: 'connected', canReconnect: true } });
  send(controller, 'session-1', 'turn-after-reconnect', 'Continue after reconnect');
  await vi.waitFor(() => expect(replacement.sendTurn).toHaveBeenCalledOnce());
});

it('rejects duplicate reconnection while preparation is pending and preserves the session when it fails', async () => {
  const { controller, messages, original, backend } = await fixture();
  const preparation = deferred<void>();
  backend.reconnect.mockImplementation(async () => { await preparation.promise; return true; });
  const reconnect = reconnectControllerIde(controller, 'session-1');
  await vi.waitFor(() => expect(backend.reconnect).toHaveBeenCalledOnce());
  await reconnectControllerIde(controller, 'session-1');
  expect(backend.reconnect).toHaveBeenCalledOnce();
  preparation.reject(new Error('Managed terminals are still open.'));
  await reconnect;
  expect(original.dispose).not.toHaveBeenCalled();
  expect(messages.at(-1)).toMatchObject({ type: 'host.ide', ide: { status: 'error', canReconnect: true } });
  send(controller, 'session-1', 'turn-after-preparation', 'Continue without IDE reconnect');
  await vi.waitFor(() => expect(original.sendTurn).toHaveBeenCalledOnce());
});

it('makes a failure after source closure retryable instead of claiming that the old session is connected', async () => {
  const { controller, messages, replacement, backend } = await fixture();
  backend.reconnect.mockImplementation(async (_id, _current, onClosingSource) => {
    onClosingSource();
    throw new Error('The original daemon has not confirmed session closure.');
  });
  await reconnectControllerIde(controller, 'session-1');
  expect(snapshots(messages).at(-1)).toMatchObject({ sessionId: 'session-1', connection: { status: 'unavailable' } });
  controller.handleMessage({ type: 'runtime.retry', sessionId: 'session-1' });
  await vi.waitFor(() => expect(replacement.initialize).toHaveBeenCalledWith({ kind: 'resume', sessionId: 'session-1', cwd: 'C:\\workspace-a' }));
  await waitForConnected(messages);
  send(controller, 'session-1', 'turn-after-retry', 'Continue after retry');
  await vi.waitFor(() => expect(replacement.sendTurn).toHaveBeenCalledOnce());
});

it.each(['resolved', 'rejected'] as const)('does not leave the new workspace locked when an old IDE preparation is %s', async outcome => {
  const { controller, messages, workspace, replacement, backend, catalog } = await fixture();
  const preparation = deferred<void>();
  backend.reconnect.mockImplementation(async () => { await preparation.promise; return true; });
  const reconnect = reconnectControllerIde(controller, 'session-1');
  await vi.waitFor(() => expect(backend.reconnect).toHaveBeenCalledOnce());
  replacement.initialize.mockResolvedValue(available('session-2'));
  vi.mocked(catalog.listSessions).mockResolvedValue({ status: 'available', sessions: [catalogEntry('session-2')] });
  workspace.cwd = 'C:\\workspace-b';
  controller.handleWorkspaceContextChanged();
  await vi.waitFor(() => expect(snapshots(messages).at(-1)).toMatchObject({ sessionId: 'session-2', connection: { status: 'connected' } }));
  if (outcome === 'resolved') preparation.resolve();
  else preparation.reject(new Error('The selected session changed.'));
  await reconnect;
  expect(messages.at(-1)).toMatchObject({ type: 'host.ide', sessionId: 'session-2', ide: { status: 'connected', canReconnect: true } });
  send(controller, 'session-2', 'turn-new-workspace', 'Continue in the new workspace');
  await vi.waitFor(() => expect(replacement.sendTurn).toHaveBeenCalledOnce());
});

it.each(['completed', 'failed', 'interrupted'] as const)('automatically reconnects an idle recovered session after its %s turn', async status => {
  const { controller, messages, original, replacement, backend } = await fixture();
  original.readSessionWorkingState = vi.fn(async () => 'idle' as const);
  controller.turnState.turn = { turnId: 'saved-turn', status, activity: createTurnActivityState() };
  backend.read.mockReturnValue({ status: 'reconnect-required', message: 'Earlier backend.' });
  backend.reconnect.mockImplementation(async (_id, _current, closing) => {
    expect(controller.turnState.turn?.status).toBe(status);
    closing();
    backend.read.mockReturnValue({ status: 'connected', message: 'Connected.' });
    return true;
  });
  reconcileDaemonTurn(controller, original, controller.sessionState.runtimeGeneration, 'session-1', 'C:\\workspace-a');
  await vi.waitFor(() => expect(backend.reconnect).toHaveBeenCalledOnce());
  expect(backend.reconnect.mock.calls[0]?.[3]).toBe(true);
  await vi.waitFor(() => expect(controller.ideReconnectInProgress).toBe(false));
  expect(snapshots(messages).at(-1)).toMatchObject({ connection: { status: 'connected' } });
  if (status === 'failed') expect(snapshots(messages).at(-1)?.turn).toMatchObject({ turnId: 'saved-turn', status });
  expect(original.interrupt).not.toHaveBeenCalled();
  send(controller, 'session-1', `after-${status}`, 'Continue with IDE');
  await vi.waitFor(() => expect(replacement.sendTurn).toHaveBeenCalledOnce());
});

it('waits for the recovered turn and automatic reconnection before dispatching its queued prompt', async () => {
  const { controller, messages, original, replacement, backend } = await fixture();
  let working = true;
  original.readSessionWorkingState = vi.fn(async () => working ? 'running' : 'idle');
  backend.read.mockReturnValue({ status: 'reconnect-required', message: 'Earlier backend.' });
  const gate = deferred<void>();
  backend.reconnect.mockImplementation(async (_id, _current, closing) => {
    await gate.promise;
    closing();
    backend.read.mockReturnValue({ status: 'connected', message: 'Connected.' });
    return true;
  });
  reconcileDaemonTurn(controller, original, controller.sessionState.runtimeGeneration, 'session-1', 'C:\\workspace-a');
  await vi.waitFor(() => expect(controller.turnState.turn?.status).toBe('streaming'));
  controller.handleMessage({ type: 'queue.add', sessionId: 'session-1', queueId: 'queued', text: 'Queued continuation' });
  expect(backend.reconnect).not.toHaveBeenCalled();
  working = false;
  await vi.waitFor(() => expect(backend.reconnect).toHaveBeenCalledOnce(), { timeout: 1500 });
  expect(controller.queueState.queuedPrompts.items).toHaveLength(1);
  expect(controller.queueState.queuedPrompts.paused).toBeNull();
  expect(original.sendTurn).not.toHaveBeenCalled();
  expect(replacement.sendTurn).not.toHaveBeenCalled();
  send(controller, 'session-1', 'racing-send', 'A send while reconnecting');
  expect(original.sendTurn).not.toHaveBeenCalled();
  gate.resolve();
  await vi.waitFor(() => expect(replacement.sendTurn).toHaveBeenCalledWith('Queued continuation', undefined));
  expect(controller.queueState.queuedPrompts.items).toHaveLength(0);
  expect(snapshots(messages).at(-1)?.connection.status).toBe('connected');
});

it('consumes an idle recovery intent only after session activation releases its lock', async () => {
  const { controller, original, replacement, backend, factory } = await fixture();
  const rebound = createMockRuntime();
  factory.mockReturnValueOnce(replacement).mockReturnValue(rebound);
  replacement.readSessionWorkingState = vi.fn(async () => 'idle' as const);
  backend.read.mockReturnValue({ status: 'reconnect-required', message: 'Earlier backend.' });
  backend.reconnect.mockImplementation(async (_id, _current, closing) => {
    expect(controller.sessionState.runtime).toBe(replacement);
    closing();
    backend.read.mockReturnValue({ status: 'connected', message: 'Connected.' });
    return true;
  });
  startReplacement(controller, { kind: 'resume', sessionId: 'session-1', cwd: 'C:\\workspace-a' });
  await vi.waitFor(() => expect(rebound.initialize).toHaveBeenCalledOnce());
  await vi.waitFor(() => expect(controller.ideReconnectInProgress).toBe(false));
  expect(backend.reconnect).toHaveBeenCalledOnce();
  expect(original.dispose).toHaveBeenCalledOnce();
  send(controller, 'session-1', 'after-activation', 'Continue after activation');
  await vi.waitFor(() => expect(rebound.sendTurn).toHaveBeenCalledOnce());
});

it.each(['deferred', 'failed'] as const)('does not loop an automatic reconnection that was %s and keeps manual recovery available', async outcome => {
  const { controller, messages, original, backend } = await fixture();
  original.readSessionWorkingState = vi.fn(async () => 'idle' as const);
  backend.read.mockReturnValue({ status: 'reconnect-required', message: 'Earlier backend.' });
  const gate = deferred<void>();
  backend.reconnect.mockImplementation(async () => {
    await gate.promise;
    if (outcome === 'failed') throw new Error('Daemon reconnect failed.');
    return false;
  });
  const generation = controller.sessionState.runtimeGeneration;
  reconcileDaemonTurn(controller, original, generation, 'session-1', 'C:\\workspace-a');
  await vi.waitFor(() => expect(backend.reconnect).toHaveBeenCalledOnce());
  controller.handleMessage({ type: 'queue.add', sessionId: 'session-1', queueId: 'retained', text: 'Retain this continuation' });
  expect(controller.queueState.queuedPrompts.items).toHaveLength(1);
  expect(original.sendTurn).not.toHaveBeenCalled();
  gate.resolve();
  await vi.waitFor(() => expect(controller.ideReconnectInProgress).toBe(false));
  expect(controller.queueState.queuedPrompts).toMatchObject({ items: [{ queueId: 'retained' }], paused: 'dispatch-blocked' });
  expect(original.sendTurn).not.toHaveBeenCalled();
  expect(messages.filter(message => message.type === 'host.ide').at(-1)).toMatchObject({ type: 'host.ide', ide: {
    status: outcome === 'deferred' ? 'reconnect-required' : 'error', canReconnect: true,
  } });
  reconcileDaemonTurn(controller, original, generation, 'session-1', 'C:\\workspace-a');
  await Promise.resolve();
  expect(backend.reconnect).toHaveBeenCalledOnce();
  expect(original.dispose).not.toHaveBeenCalled();
  await reconnectControllerIde(controller, 'session-1');
  expect(backend.reconnect).toHaveBeenCalledTimes(2);
  expect(backend.reconnect.mock.calls[1]?.[3]).toBe(false);
});

it('never initiates automatic IDE migration from an unknown recovered working state', async () => {
  const { controller, original, backend } = await fixture();
  original.readSessionWorkingState = vi.fn(async () => 'unknown' as const);
  backend.read.mockReturnValue({ status: 'reconnect-required', message: 'Earlier backend.' });
  controller.turnState.turn = { turnId: 'saved-turn', status: 'interrupted', activity: createTurnActivityState() };
  reconcileDaemonTurn(controller, original, controller.sessionState.runtimeGeneration, 'session-1', 'C:\\workspace-a');
  await Promise.resolve();
  expect(backend.reconnect).not.toHaveBeenCalled();
  expect(original.dispose).not.toHaveBeenCalled();
});
