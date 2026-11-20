import { expect, it, vi } from 'vitest';
import { createRewindCheckpointStore } from '../../runtime/daemon/rewindCheckpoint';
import {
  available, catalogEntry, createCatalog, createController, createMemoryPersistence, createMockRuntime,
  lastMessage, ready, SessionRecoveryStore, waitForConnected,
} from './controllerTestHarness';

it.each(['complete', 'partial', 'unknown'] as const)(
  'reopens a saved rewind and reconnects without sending (%s file result)', async (kind) => {
    const persistence = createMemoryPersistence();
    const writer = new SessionRecoveryStore(persistence);
    const transcript = { historyStatus: 'complete' as const, truncated: false, transcript: [
      { id: 'user-1', kind: 'user' as const, messageId: 'anchor', text: 'Original prompt' },
    ] };
    writer.createConversation('source', transcript);
    writer.selectConversation('source');
    await writer.dispose();
    const counts = { restoredCount: 2, deletedCount: 1, failedRestoreCount: kind === 'partial' ? 1 : 0, failedDeleteCount: 0 };
    const saved = { sourceSessionId: 'source', newSessionId: 'successor', messageId: 'anchor',
      filesRequested: true, ...(kind === 'unknown' ? {} : { files: counts }) };
    await createRewindCheckpointStore(persistence).write('C:\\workspace', saved);
    const restored = createRewindCheckpointStore(persistence);
    const runtime = Object.assign(createMockRuntime(), {
      readPendingRewind: () => restored.read('C:\\workspace', 'source'),
      clearPendingRewind: vi.fn(async () => restored.clear('C:\\workspace', saved)),
      rewind: vi.fn(async () => ({ sessionId: 'successor', filesRequested: true as const,
        reconnected: true as const, ...(kind === 'unknown' ? {} : { files: counts }) })),
    });
    runtime.initialize.mockResolvedValue(available('source'));
    const { controller, messages } = createController(() => runtime, undefined,
      createCatalog([catalogEntry('source')]), new SessionRecoveryStore(persistence),
      { loadHistory: async () => ({ status: 'available', state: transcript }) });
    try {
      ready(controller);
      await waitForConnected(messages);
      expect(lastMessage(messages, 'turn.editResendRejected')).toMatchObject({ messageId: 'anchor', reason: 'resume-failed' });
      controller.handleMessage({ type: 'turn.editResend', sessionId: 'source', turnId: 'retry',
        messageId: 'anchor', text: 'Edited but unsent', restoreFiles: false });
      await vi.waitFor(() => expect(lastMessage(messages, 'rewind.result')).toMatchObject({
        sessionId: 'successor', messageId: 'anchor', reconnected: true, filesRequested: true,
        unsentText: 'Edited but unsent', ...(kind === 'unknown' ? {} : { files: counts }),
      }));
      expect(runtime.sendTurn).not.toHaveBeenCalled();
      expect(runtime.clearPendingRewind).toHaveBeenCalledOnce();
      expect(createRewindCheckpointStore(persistence).read('C:\\workspace', 'source')).toBeUndefined();
      expect(controller.recoveryStore.getSelectedConversationId()).toBe('successor');
    } finally {
      await controller.dispose();
    }
  },
);
