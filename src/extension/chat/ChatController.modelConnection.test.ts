import { expect, it, vi } from 'vitest';
import { createController, createMockRuntime, deferred, lastMessage, ready, send, waitForConnected,
  type RuntimeEvent } from './controllerTestHarness';
import { readHostMessage } from '../../webview-v2/bridge/validateHostMessage';

function connectionController(runtime: ReturnType<typeof createMockRuntime>) {
  const fixture = createController(() => runtime);
  Object.defineProperty(fixture.controller, 'turnSnapshots', { value: {
    capture: async () => 'saved-tree', capturePaths: async () => {},
    read: () => undefined, diff: async () => new Map(), dispose: async () => {},
  } });
  return fixture;
}

it.each<RuntimeEvent>([
  { type: 'text-delta', text: 'Connected again' },
  { type: 'thinking-delta', text: 'Checking', messageId: 'thinking-1', blockIndex: 0 },
  { type: 'tool-start', toolName: 'Read', toolUseId: 'read-1', action: 'Read code' },
  { type: 'turn-complete', outcome: 'success' },
])('retains model failure through retry and snapshot until real progress: $type', async (progress) => {
  const resume = deferred<void>();
  const runtime = createMockRuntime(async function* (text) {
    if (text === 'First') {
      yield { type: 'error', message: 'Connection error.', modelConnectionFailed: true };
      yield { type: 'turn-complete', outcome: 'error_during_execution' };
      return;
    }
    yield { type: 'working-state', isWorking: true };
    await resume.promise;
    yield progress;
    if (progress.type !== 'turn-complete') yield { type: 'turn-complete', outcome: 'success' };
  });
  const { controller, messages } = connectionController(runtime);
  try {
    ready(controller);
    await waitForConnected(messages);
    send(controller, 'session-1', 'turn-1', 'First');
    await vi.waitFor(() => expect(lastMessage(messages, 'turn.state')?.status).toBe('failed'));
    expect(lastMessage(messages, 'turn.error')).toMatchObject({ code: 'runtime-execution-failed', message: 'Connection error.' });
    expect(lastMessage(messages, 'host.connection')?.connection).toEqual({ status: 'connected', modelRequestFailed: true });
    // A remounted webview receives the same independent model status through the strict parser.
    ready(controller);
    await vi.waitFor(() => expect(lastMessage(messages, 'host.snapshot')?.connection.modelRequestFailed).toBe(true));
    const snapshot = lastMessage(messages, 'host.snapshot');
    expect(readHostMessage(snapshot)).toEqual(snapshot);
    send(controller, 'session-1', 'turn-2', 'Retry');
    await vi.waitFor(() => expect(runtime.sendTurn).toHaveBeenCalledTimes(2));
    expect(controller.sessionState.connection.modelRequestFailed).toBe(true);
    resume.resolve();
    await vi.waitFor(() => expect(lastMessage(messages, 'turn.state')?.status).toBe('completed'));
    expect(lastMessage(messages, 'host.connection')?.connection).toEqual({ status: 'connected' });
  } finally {
    resume.resolve();
    await controller.dispose();
  }
});

it.each([true, false])('distinguishes an authoritative model connection failure from ordinary terminal errors: %s', async (modelFailure) => {
  const runtime = createMockRuntime(async function* () {
    yield { type: 'turn-complete', outcome: 'error_during_execution', errorMessage: 'Request failed',
      ...(modelFailure ? { modelConnectionFailed: true as const } : {}) };
  });
  const { controller, messages } = connectionController(runtime);
  try {
    ready(controller);
    await waitForConnected(messages);
    send(controller, 'session-1', 'turn-1', 'Ask');
    await vi.waitFor(() => expect(lastMessage(messages, 'turn.state')?.status).toBe('failed'));
    expect(Boolean(controller.sessionState.connection.modelRequestFailed)).toBe(modelFailure);
    expect(controller.sessionState.connection.status).toBe('connected');
  } finally { await controller.dispose(); }
});
