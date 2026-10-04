import { describe, expect, it, vi } from 'vitest';
import { ChatController, type ControllerHostMessage } from './ChatController';
import { available, createMockRuntime, deferred, lastMessage, ready, retry } from './controllerTestHarness';
import { readHostMessage } from '../../webview-v2/bridge/validateHostMessage';

function fixture() {
  const runtime = createMockRuntime();
  runtime.initialize.mockResolvedValue(available('child-session'));
  const loadHistory = vi.fn(async () => ({
    status: 'available' as const,
    state: { transcript: [], historyStatus: 'complete' as const, truncated: false },
  }));
  const controller = new ChatController({
    createRuntime: () => runtime,
    getWorkspaceContext: () => ({ cwd: 'C:\\workspace', trusted: true }),
    childSession: { sessionId: 'child-session', cwd: 'C:\\workspace' },
    sessionHistory: { loadHistory },
  });
  const messages: ControllerHostMessage[] = [];
  controller.subscribe(message => messages.push(message));
  return { controller, runtime, loadHistory, messages };
}

describe('child conversation startup', () => {
  it('waits for the original child attachment before reading newly created history, including retry', async () => {
    const { controller, runtime, loadHistory, messages } = fixture();
    const attaching = deferred<ReturnType<typeof available>>();
    runtime.initialize.mockReturnValueOnce(attaching.promise);
    try {
      ready(controller);
      await vi.waitFor(() => expect(runtime.initialize).toHaveBeenCalledOnce());
      expect(loadHistory).not.toHaveBeenCalled();
      attaching.resolve(available('child-session'));
      await controller.sessionState.initialization;
      expect(readHostMessage(lastMessage(messages, 'host.snapshot'))).toMatchObject({
        sessionId: 'child-session', conversationId: 'child-session', connection: { status: 'connected' },
      });
      expect(loadHistory).toHaveBeenCalledOnce();

      const reattaching = deferred<ReturnType<typeof available>>();
      runtime.initialize.mockReturnValueOnce(reattaching.promise);
      loadHistory.mockClear();
      controller.sessionState.connection = { status: 'unavailable', message: 'Connection lost' };
      retry(controller, 'child-session');
      await vi.waitFor(() => expect(runtime.initialize).toHaveBeenCalledTimes(2));
      expect(loadHistory).not.toHaveBeenCalled();
      reattaching.resolve(available('child-session'));
      await vi.waitFor(() => expect(controller.sessionState.connection.status).toBe('connected'));
      expect(loadHistory).toHaveBeenCalledOnce();
      expect(runtime.sendTurn).not.toHaveBeenCalled();
    } finally {
      attaching.resolve(available('child-session'));
      await controller.dispose();
    }
  });

  it('publishes a valid unavailable snapshot without a saved conversation and can retry the same child', async () => {
    const { controller, runtime, loadHistory, messages } = fixture();
    loadHistory.mockRejectedValueOnce(new Error('History read failed'));
    try {
      ready(controller);
      await controller.sessionState.initialization;
      expect(readHostMessage(lastMessage(messages, 'host.snapshot'))).toMatchObject({
        sessionId: 'child-session', conversationId: 'child-session', connection: { status: 'unavailable' },
      });
      retry(controller, 'child-session');
      await vi.waitFor(() => expect(controller.sessionState.connection.status).toBe('connected'));
      expect(runtime.initialize).toHaveBeenLastCalledWith({
        kind: 'resume', child: true, sessionId: 'child-session', cwd: 'C:\\workspace',
      });
      expect(runtime.sendTurn).not.toHaveBeenCalled();
      expect(runtime.interrupt).not.toHaveBeenCalled();
    } finally { await controller.dispose(); }
  });
});
