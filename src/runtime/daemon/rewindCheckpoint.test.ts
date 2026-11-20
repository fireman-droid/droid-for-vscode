import { describe, expect, it, vi } from 'vitest';
import type { DaemonApi } from './api';
import { createDaemonDroidSession } from './createDaemonDroidSession';
import { createRewindCheckpointStore } from './rewindCheckpoint';
import { cancellingRuntimeInteractionHandler } from '../events/runtimeInteractions';
import type { FactoryDroidSession } from '../session/sessionTypes';
import { rewind, type ReplacementContext } from '../session/replacements';
import { FactoryDroidRuntime } from '../FactoryDroidRuntime';
import { createDaemonSessionFactory } from './createDaemonDroidSession';
import { catalogEntry, createCatalog, createController, lastMessage, ready, SessionRecoveryStore, waitForConnected } from '../../extension/chat/controllerTestHarness';

function handle(id: string) {
  return {
    id, cwd: 'C:/workspace', settings: {}, detach: vi.fn(async () => {}),
    onNotification: vi.fn(() => () => {}), readMissionSnapshot: () => null,
    subscribeMissionSnapshot: () => () => {},
    stream: vi.fn(async function* () {}),
    rewind: vi.fn(async () => ({ newSessionId: 'successor', restoredCount: 2, deletedCount: 1,
      failedRestoreCount: 1, failedDeleteCount: 0 })),
  };
}

function context(initial: FactoryDroidSession): ReplacementContext {
  let session = initial;
  return {
    get session() { return session; },
    active: false, recordDiagnostic: () => {},
    adoptSession(next) { session = next; },
  };
}

describe('durable daemon rewind handoff', () => {
  it.each(['partial', 'unknown'] as const)('recreates the runtime and reconnects without another rewind (%s files)', async (kind) => {
    const storage = new Map<string, unknown>();
    const persistence = {
      get: <T>(key: string) => storage.get(key) as T | undefined,
      update: async (key: string, value: unknown) => { if (value === undefined) storage.delete(key); else storage.set(key, structuredClone(value)); },
    };
    const source = handle('source');
    const resumedSource = handle('source');
    if (kind === 'unknown') source.rewind.mockResolvedValueOnce({ newSessionId: 'successor' } as never);
    const target = handle('successor');
    let failAttach = true;
    const sessions = {
      create: vi.fn(async () => source),
      resume: vi.fn(async (id: string) => {
        if (id === 'source') return resumedSource;
        if (failAttach) { failAttach = false; throw new Error('attach failed'); }
        return target;
      }),
      getRewindInfo: vi.fn(async () => ({ availableFiles: [], createdFiles: [], evictedFiles: [] })),
    };
    const droid = { sessions } as unknown as DaemonApi;
    const options = { getDroid: async () => droid, interactionHandler: cancellingRuntimeInteractionHandler };
    const first = context(await createDaemonDroidSession({ ...options, target: { kind: 'new', cwd: 'C:/workspace' },
      rewindStore: createRewindCheckpointStore(persistence) }));
    await expect(rewind(first, { messageId: 'anchor', forkTitle: 'Edit', restoreFiles: true }))
      .rejects.toMatchObject({ name: 'RewindAttachmentError' });
    expect(source.rewind).toHaveBeenCalledOnce();

    const restoredStore = createRewindCheckpointStore(persistence);
    const second = context(await createDaemonDroidSession({ ...options,
      target: { kind: 'resume', cwd: 'C:/workspace', sessionId: 'source' }, rewindStore: restoredStore }));
    expect(second.session.readPendingRewind?.()).toMatchObject({
      sourceSessionId: 'source', newSessionId: 'successor', messageId: 'anchor', filesRequested: true,
      ...(kind === 'partial' ? { files: { restoredCount: 2, deletedCount: 1, failedRestoreCount: 1, failedDeleteCount: 0 } } : {}),
    });
    await expect(rewind(second, { messageId: 'other', forkTitle: 'Other', restoreFiles: true }))
      .rejects.toMatchObject({ name: 'RewindAnchorConflictError' });
    const outcome = await rewind(second, { messageId: 'anchor', forkTitle: 'Edit', restoreFiles: false });
    expect(outcome).toEqual({ sessionId: 'successor', filesRequested: true, reconnected: true,
      ...(kind === 'partial' ? { files: { restoredCount: 2, deletedCount: 1, failedRestoreCount: 1, failedDeleteCount: 0 } } : {}) });
    expect(resumedSource.rewind).not.toHaveBeenCalled();
    expect(sessions.getRewindInfo).toHaveBeenCalledOnce();
    expect(restoredStore.read('C:/other', 'source')).toBeUndefined();
    expect(restoredStore.read('C:/workspace', 'source')).toBeDefined();
    await second.session.clearPendingRewind?.();
    expect(createRewindCheckpointStore(persistence).read('C:/workspace', 'source')).toBeUndefined();
  });

  it('blocks another native rewind after result persistence fails and the host is recreated', async () => {
    const storage = new Map<string, unknown>();
    let updates = 0;
    const persistence = {
      get: <T>(key: string) => storage.get(key) as T | undefined,
      update: async (key: string, value: unknown) => {
        if (++updates === 2) throw new Error('storage unavailable');
        storage.set(key, structuredClone(value));
      },
    };
    const source = handle('source');
    const resumed = handle('source');
    const sessions = {
      create: vi.fn(async () => source), resume: vi.fn(async () => resumed),
      getRewindInfo: vi.fn(async () => ({ availableFiles: [], createdFiles: [], evictedFiles: [] })),
    };
    const options = { getDroid: async () => ({ sessions } as unknown as DaemonApi),
      interactionHandler: cancellingRuntimeInteractionHandler };
    const first = context(await createDaemonDroidSession({ ...options, target: { kind: 'new', cwd: 'C:/workspace' },
      rewindStore: createRewindCheckpointStore(persistence) }));
    await expect(rewind(first, { messageId: 'anchor', forkTitle: 'Edit', restoreFiles: true }))
      .rejects.toMatchObject({ name: 'RewindAttachmentError' });
    expect(sessions.resume).not.toHaveBeenCalled();
    const restored = context(await createDaemonDroidSession({ ...options,
      target: { kind: 'resume', cwd: 'C:/workspace', sessionId: 'source' },
      rewindStore: createRewindCheckpointStore(persistence) }));
    expect(restored.session.readPendingRewind?.()).toMatchObject({ messageId: 'anchor', newSessionId: null, filesRequested: true });
    await expect(rewind(restored, { messageId: 'anchor', forkTitle: 'Edit', restoreFiles: false }))
      .rejects.toMatchObject({ name: 'RewindOutcomeUnknownError' });
    expect(resumed.rewind).not.toHaveBeenCalled();
  });

  it('preserves a conversation-only rewind even if retry requests files', async () => {
    const values = new Map<string, unknown>();
    const persistence = {
      get: <T>(key: string) => values.get(key) as T | undefined,
      update: async (key: string, value: unknown) => { values.set(key, value); },
    };
    const store = createRewindCheckpointStore(persistence);
    await store.write('C:/workspace', { sourceSessionId: 'source', messageId: 'anchor',
      newSessionId: 'successor', filesRequested: false });
    const source = handle('source');
    const sessions = { resume: vi.fn(async (id: string) => id === 'source' ? source : handle(id)),
      getRewindInfo: vi.fn(async () => ({ availableFiles: [], createdFiles: [], evictedFiles: [] })) };
    const restored = context(await createDaemonDroidSession({
      target: { kind: 'resume', cwd: 'C:/workspace', sessionId: 'source' },
      getDroid: async () => ({ sessions } as unknown as DaemonApi),
      interactionHandler: cancellingRuntimeInteractionHandler, rewindStore: createRewindCheckpointStore(persistence),
    }));
    await expect(rewind(restored, { messageId: 'anchor', forkTitle: 'Edit', restoreFiles: true }))
      .resolves.toEqual({ sessionId: 'successor', reconnected: true });
    expect(source.rewind).not.toHaveBeenCalled();
    expect(sessions.getRewindInfo).not.toHaveBeenCalled();
  });

  it('recreates controller, daemon runtime and storage before adopting a saved successor', async () => {
    const values = new Map<string, unknown>();
    const persistence = {
      get: <T>(key: string) => values.get(key) as T | undefined,
      update: async (key: string, value: unknown) => { if (value === undefined) values.delete(key); else values.set(key, structuredClone(value)); },
    };
    const history = { historyStatus: 'complete' as const, truncated: false, transcript: [
      { kind: 'user' as const, id: 'row', messageId: 'anchor', text: 'Original' },
    ] };
    const savedHistory = new SessionRecoveryStore(persistence);
    savedHistory.createConversation('source', history);
    savedHistory.selectConversation('source');
    await savedHistory.dispose();
    const source = handle('source');
    const resumed = handle('source');
    const successor = handle('successor');
    let attachFails = true;
    const sessions = {
      create: vi.fn(async () => source),
      resume: vi.fn(async (id: string) => {
        if (id === 'source') return resumed;
        if (attachFails) { attachFails = false; throw new Error('offline'); }
        return successor;
      }),
      getRewindInfo: vi.fn(async () => ({ availableFiles: [], createdFiles: [], evictedFiles: [] })),
      listOpened: vi.fn(async () => []),
    };
    const droid = { sessions, models: { list: vi.fn(async () => []) } } as unknown as DaemonApi;
    const factory = () => createDaemonSessionFactory(async () => droid, undefined, undefined, createRewindCheckpointStore(persistence));
    const first = new FactoryDroidRuntime({ interactionHandler: cancellingRuntimeInteractionHandler, createSdkSession: factory() });
    await first.initialize({ kind: 'new', cwd: 'C:/workspace' });
    await expect(first.rewind({ messageId: 'anchor', forkTitle: 'Edit', restoreFiles: true }))
      .rejects.toMatchObject({ name: 'RewindAttachmentError' });
    await first.dispose();

    const runtime = new FactoryDroidRuntime({ interactionHandler: cancellingRuntimeInteractionHandler, createSdkSession: factory() });
    const { controller, messages } = createController(() => runtime, { cwd: 'C:/workspace', trusted: true },
      createCatalog([catalogEntry('source')]), new SessionRecoveryStore(persistence),
      { loadHistory: async () => ({ status: 'available', state: history }) });
    try {
      ready(controller);
      await waitForConnected(messages);
      expect(lastMessage(messages, 'turn.editResendRejected')).toMatchObject({ messageId: 'anchor', reason: 'resume-failed' });
      controller.handleMessage({ type: 'turn.editResend', sessionId: 'source', turnId: 'retry', messageId: 'anchor',
        text: 'Edited', restoreFiles: false });
      await vi.waitFor(() => expect(lastMessage(messages, 'rewind.result')).toMatchObject({
        sessionId: 'successor', reconnected: true, filesRequested: true, unsentText: 'Edited',
        files: { restoredCount: 2, deletedCount: 1, failedRestoreCount: 1, failedDeleteCount: 0 },
      }));
      expect(source.rewind).toHaveBeenCalledOnce();
      expect(resumed.rewind).not.toHaveBeenCalled();
      expect(successor.stream).not.toHaveBeenCalled();
      expect(createRewindCheckpointStore(persistence).read('C:/workspace', 'source')).toBeUndefined();
    } finally {
      await controller.dispose();
    }
  });
});
