import { describe, expect, it, vi } from 'vitest';
import { handleReady } from './sessions/runtimeLifecycle';
import {
  available, catalogEntry, createCatalog, createController, createHostTranscriptState,
  createMemoryPersistence, createMockRuntime, deferred, retry, SessionRecoveryStore, snapshots,
} from './controllerTestHarness';

describe('retrying a failed initial recovery read', () => {
  it.each(['ready', 'retry'] as const)('retries the same controller through %s without sending a prompt', async trigger => {
    const persistence = createMemoryPersistence();
    const recovery = new SessionRecoveryStore(persistence);
    const conversationId = recovery.createConversation('saved-session', createHostTranscriptState('complete'))!;
    recovery.selectConversation(conversationId);
    recovery.writeConversationQueuedTexts(conversationId, ['Keep this pending']);
    await recovery.flush();
    const load = recovery.load.bind(recovery);
    const reads = vi.spyOn(recovery, 'load').mockRejectedValueOnce(new Error('Temporary read failure')).mockImplementation(load);
    const runtime = createMockRuntime();
    runtime.initialize.mockResolvedValue(available('saved-session'));
    const { controller, messages } = createController(() => runtime, undefined,
      createCatalog([catalogEntry('saved-session')]), recovery,
      { loadHistory: async () => ({ status: 'available', state: createHostTranscriptState('complete') }) });
    try {
      // Observe the baseline's rejected promise too, rather than leaking it as an unhandled rejection.
      await handleReady(controller).catch(() => undefined);
      expect(runtime.initialize).not.toHaveBeenCalled();
      if (trigger === 'ready') await handleReady(controller).catch(() => undefined);
      else retry(controller, null);
      await vi.waitFor(() => expect(reads).toHaveBeenCalledTimes(2));
      await vi.waitFor(() => expect(snapshots(messages).at(-1)).toMatchObject({
        sessionId: 'saved-session', connection: { status: 'connected' },
      }));
      expect(messages).toContainEqual(expect.objectContaining({ type: 'runtime.diagnostic', code: 'session-initialization-failed' }));
      expect(runtime.initialize).toHaveBeenCalledExactlyOnceWith({ kind: 'resume', cwd: 'C:\\workspace', sessionId: 'saved-session' });
      expect(recovery.readConversationQueuedTexts(conversationId)).toEqual(['Keep this pending']);
      expect(runtime.sendTurn).not.toHaveBeenCalled();
    } finally { await controller.dispose(); }
  });

  it('does not let a stale failing initialization replace a newer owner', async () => {
    const recovery = new SessionRecoveryStore(createMemoryPersistence());
    const read = deferred<void>();
    vi.spyOn(recovery, 'load').mockImplementation(() => read.promise);
    const runtime = createMockRuntime();
    const { controller, messages } = createController(() => runtime, undefined, createCatalog([]), recovery);
    const attempt = handleReady(controller).catch(() => undefined);
    const newer = Promise.resolve();
    controller.sessionState.initialization = newer;
    controller.sessionState.runtimeGeneration++;
    controller.sessionState.connection = { status: 'connected' };
    read.reject(new Error('Old read failed'));
    await attempt;
    expect(controller.sessionState.initialization).toBe(newer);
    expect(controller.sessionState.connection.status).toBe('connected');
    expect(messages.some(message => message.type === 'runtime.diagnostic' && message.code === 'session-initialization-failed')).toBe(false);
    await controller.dispose();
  });
});
