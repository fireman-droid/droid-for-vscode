import { describe, expect, it, vi } from 'vitest';
import type { SessionTranscriptItem } from '../../shared/protocol/transcript';
import {
  MAX_RECOVERY_SESSIONS, SESSION_RECOVERY_STORAGE_KEY, SESSION_RECOVERY_VERSION,
  SessionRecoveryStore, type SessionRecoveryCache, type SessionRecoveryPersistence,
} from './SessionRecoveryStore';
import {
  createRootConversation, LEGACY_SESSION_RECOVERY_VERSION,
  type ConversationRecoveryRecord, type ConversationToolOperation,
} from './conversationRecoveryState';

describe('SessionRecoveryStore', () => {
  it('keeps compact successors in one conversation with its queued messages', async () => {
    const persistence = memoryPersistence();
    const store = new SessionRecoveryStore(persistence);
    const conversationId = writeQueuedText(store, 'session-root', 'Continue after compact');
    store.selectConversation(conversationId);
    expect(store.adoptSuccessor(conversationId, 'session-root', 'session-compact', 'compact')).toBe(true);
    expect(store.getSelectedConversationId()).toBe(conversationId);
    expect(store.getSelectedSessionId()).toBe('session-compact');
    expect(store.readConversationQueuedTexts(conversationId)).toEqual(['Continue after compact']);
    await store.flush();
    const reloaded = new SessionRecoveryStore(persistence);
    await reloaded.load();
    expect(reloaded.getSelectedConversationId()).toBe(conversationId);
    expect(reloaded.getSelectedSessionId()).toBe('session-compact');
    expect(reloaded.readConversationQueuedTexts(conversationId)).toEqual(['Continue after compact']);
    expect(reloaded.readConversation(conversationId)?.nodes).toMatchObject([
      { sessionId: 'session-root', relation: 'root' },
      { sessionId: 'session-compact', relation: 'compact', parentSessionId: 'session-root' },
    ]);
  });

  it('forks a separate conversation without mutating the source queue or lineage', () => {
    const store = new SessionRecoveryStore(memoryPersistence());
    const sourceId = writeQueuedText(store, 'session-root', 'Only in source');
    const forkId = store.forkConversation(sourceId, 'session-root', 'session-fork', 'fork', cache([]));
    expect(forkId).toBe('session-fork');
    expect(store.readConversationQueuedTexts(forkId!)).toEqual([]);
    store.writeConversationQueuedTexts(forkId!, ['Only in fork']);
    expect(store.readConversationQueuedTexts(sourceId)).toEqual(['Only in source']);
    expect(store.readConversationQueuedTexts(forkId!)).toEqual(['Only in fork']);
    expect(store.readConversation(sourceId)?.nodes).toMatchObject([{ sessionId: 'session-root', relation: 'root' }]);
    expect(store.readConversation(forkId!)?.nodes).toMatchObject([{
      sessionId: 'session-fork', relation: 'fork', parentConversationId: sourceId, parentSessionId: 'session-root',
    }]);
  });

  it('keeps the latest actual changes after an empty settled turn', () => {
    const store = new SessionRecoveryStore(memoryPersistence());
    const conversationId = store.createConversation('session-1', cache([]))!;
    expect(store.recordSettledTurn(conversationId, 'session-1', 'turn-1', null,
      [{ path: 'src/a.ts', additions: 1, deletions: 0 }], 'completed')).toBe(true);
    expect(store.recordSettledTurn(conversationId, 'session-1', 'turn-2', null, [], 'completed')).toBe(true);
    expect(store.readLatestChanges(conversationId)).toMatchObject({
      turnId: 'turn-1', changesSettled: true, files: [{ path: 'src/a.ts', additions: 1, deletions: 0 }],
    });
    expect(store.readTurn(conversationId, 'turn-2')).toMatchObject({ changesSettled: true, files: [] });
  });

  it('round-trips active turn metadata without retaining a display cache', async () => {
    const persistence = memoryPersistence();
    const store = new SessionRecoveryStore(persistence);
    const conversationId = store.createConversation('session-1', cache([]))!;
    expect(store.writeActiveDisplay(conversationId, 'session-1', cache([
      { id: 'user-1', kind: 'user', text: 'History comes from Droid' },
    ]), { turnId: 'turn-live', status: 'streaming' })).toBe(true);
    await store.flush();
    const reloaded = new SessionRecoveryStore(persistence);
    await reloaded.load();
    expect(reloaded.readDisplay(conversationId)?.turn).toEqual({ turnId: 'turn-live', status: 'streaming' });
    expect(storedConversation(persistence.value, conversationId).display.transcript.transcript).toEqual([]);
    expect(JSON.stringify(persistence.value)).not.toContain('History comes from Droid');
  });

  it('migrates legacy selection and queues while dropping obsolete display text', async () => {
    const persistence = memoryPersistence({
      version: LEGACY_SESSION_RECOVERY_VERSION, selectedSessionId: 'session-1', sessions: [{
        sessionId: 'session-1', lastAccess: 7, historyStatus: 'complete', truncated: false,
        transcript: [{ id: 'user-1', kind: 'user', text: 'Obsolete display payload' }],
        queuedTexts: ['Still waiting to send'],
      }],
    });
    const store = new SessionRecoveryStore(persistence);
    await store.load();
    expect(store.getSelectedSessionId()).toBe('session-1');
    expect(store.readConversationQueuedTexts('session-1')).toEqual(['Still waiting to send']);
    await store.flush();
    expect(persistence.value).toMatchObject({ version: SESSION_RECOVERY_VERSION, selectedConversationId: 'session-1' });
    expect(storedConversation(persistence.value, 'session-1').queuedTexts).toEqual(['Still waiting to send']);
    expect(JSON.stringify(persistence.value)).not.toContain('Obsolete display payload');
  });

  it('round-trips tool operation evidence and per-turn changes summaries', async () => {
    const persistence = memoryPersistence();
    const store = new SessionRecoveryStore(persistence);
    const conversationId = store.createConversation('session-1', cache([]))!;
    const files = [
      { path: 'src/app.ts', additions: 3, deletions: 1 },
      { path: 'docs/new.md', additions: null, deletions: null },
    ];
    expect(store.recordSettledTurn(conversationId, 'session-1', 'turn-1', null,
      files, 'completed', 'message-1', [operation()])).toBe(true);
    await store.flush();
    const reloaded = new SessionRecoveryStore(persistence);
    await reloaded.load();
    expect(reloaded.readTurn(conversationId, 'turn-1')).toMatchObject({
      messageId: 'message-1', changesSettled: true, files, toolOperations: [operation()],
    });
  });

  it('rejects unsafe operation paths and malformed current changes summaries', async () => {
    const persistence = memoryPersistence();
    const writer = new SessionRecoveryStore(persistence);
    const conversationId = writer.createConversation('session-1', cache([]))!;
    writer.recordSettledTurn(conversationId, 'session-1', 'turn-1', null,
      [{ path: 'src/app.ts', additions: 1, deletions: 0 }], 'completed', undefined, [operation()]);
    await writer.flush();
    const safe = storedConversation(persistence.value, conversationId);
    const valid = new SessionRecoveryStore(memoryPersistence(persistence.value));
    await valid.load();
    expect(valid.readLatestOperations(conversationId)?.toolOperations).toEqual([operation()]);
    const turn = safe.turns[0]!;
    const unsafeOperation = operation();
    if (unsafeOperation.operationDiff.status !== 'ready') throw new Error('Expected ready evidence');
    const unsafeDiff = { ...unsafeOperation.operationDiff, files: [{
      ...unsafeOperation.operationDiff.files[0], path: '../outside.ts',
    }] };
    for (const changed of [
      { ...turn, toolOperations: [{ ...unsafeOperation, operationDiff: unsafeDiff }] },
      { ...turn, files: [{ path: 'src/app.ts', additions: -1, deletions: 0 }] },
      { ...turn, files: [{ path: 'src/app.ts', additions: 1, deletions: 0, patch: 'raw diff in summary' }] },
    ]) {
      const store = new SessionRecoveryStore(memoryPersistence({
        version: SESSION_RECOVERY_VERSION, selectedConversationId: conversationId,
        conversations: [{ ...safe, turns: [changed] }],
      }));
      await store.load();
      expect(store.readConversation(conversationId)).toBeUndefined();
      expect(store.getSelectedSessionId()).toBeNull();
    }
  });

  it('round-trips an explicitly empty canonical changes settlement', async () => {
    const persistence = memoryPersistence();
    const store = new SessionRecoveryStore(persistence);
    const conversationId = store.createConversation('session-1', cache([]))!;
    store.recordSettledTurn(conversationId, 'session-1', 'turn-1', null, [], 'completed');
    await store.flush();
    const reloaded = new SessionRecoveryStore(persistence);
    await reloaded.load();
    expect(reloaded.readTurn(conversationId, 'turn-1')).toMatchObject({
      turnId: 'turn-1', status: 'completed', changesSettled: true, files: [],
    });
  });

  it('does not promote a live writing row to canonical settlement', async () => {
    const persistence = memoryPersistence();
    const store = new SessionRecoveryStore(persistence);
    const conversationId = store.createConversation('session-1', cache([]))!;
    store.writeActiveDisplay(conversationId, 'session-1', cache([{
      id: 'changes-1', kind: 'changes', turnId: 'turn-1',
      files: [{ path: 'src/app.ts', additions: null, deletions: null }], writing: true,
    }]), { turnId: 'turn-1', status: 'streaming' });
    await store.flush();
    expect(store.readTurn(conversationId, 'turn-1')).toBeUndefined();
    expect(storedConversation(persistence.value, conversationId).turns).toEqual([]);
    expect(storedConversation(persistence.value, conversationId).display.turn).toEqual({ turnId: 'turn-1', status: 'streaming' });
  });

  it('rejects future, oversized, extra-key, symbol, and accessor state', async () => {
    const empty = { version: SESSION_RECOVERY_VERSION, selectedConversationId: null, conversations: [] };
    const hostileValues: unknown[] = [
      { ...empty, version: SESSION_RECOVERY_VERSION + 1 },
      { ...empty, extra: true },
      Object.assign({ ...empty }, { [Symbol('hostile')]: 'secret' }),
      { version: SESSION_RECOVERY_VERSION, selectedConversationId: null,
        get conversations() { throw new Error('accessor executed'); } },
      { ...empty, conversations: Array.from({ length: MAX_RECOVERY_SESSIONS + 1 }, (_, index) =>
        createRootConversation(`session-${index}`, cache([]), index)) },
    ];
    for (const value of hostileValues) {
      const persistence = memoryPersistence(value);
      const store = new SessionRecoveryStore(persistence);
      await expect(store.load()).resolves.toBeUndefined();
      expect(store.getSelectedSessionId()).toBeNull();
      expect(store.readConversation('session-0')).toBeUndefined();
      expect(persistence.get).toHaveBeenCalledOnce();
    }
  });

  it('drops malformed conversation entries without exposing raw payloads', async () => {
    const safe = createRootConversation('safe', cache([]), 1, ['Keep this queued text']);
    const persistence = memoryPersistence({
      version: SESSION_RECOVERY_VERSION, selectedConversationId: 'safe', conversations: [safe, {
        ...createRootConversation('raw', cache([]), 2),
        sdkEvent: 'raw-sdk-event', input: { secret: 'raw-input' }, result: 'raw-result',
      }],
    });
    const store = new SessionRecoveryStore(persistence);
    await store.load();
    expect(store.readConversationQueuedTexts('safe')).toEqual(['Keep this queued text']);
    expect(store.readConversation('raw')).toBeUndefined();
    expect(store.getSelectedSessionId()).toBe('safe');
    await store.flush();
    expect(JSON.stringify(persistence.value)).not.toContain('raw-');
  });

  it('enforces deterministic LRU limits using explicit conversation selection', () => {
    const store = new SessionRecoveryStore(memoryPersistence());
    for (let index = 0; index < MAX_RECOVERY_SESSIONS; index++) {
      store.createConversation(`session-${index}`, cache([]));
    }
    store.selectConversation('session-0');
    store.createConversation('session-new', cache([]));
    expect(store.readConversation('session-0')).toBeDefined();
    expect(store.readConversation('session-1')).toBeUndefined();
    expect(store.resolveConversationId('session-1')).toBeUndefined();
    expect(store.readConversation('session-new')).toBeDefined();
  });

  it('debounces writes, flushes immediately, and persists selection', async () => {
    vi.useFakeTimers();
    try {
      const persistence = memoryPersistence();
      const store = new SessionRecoveryStore(persistence, SESSION_RECOVERY_STORAGE_KEY, 250);
      writeQueuedText(store, 'session-1', 'one');
      store.selectConversation('session-1');
      writeQueuedText(store, 'session-1', 'two');
      await vi.advanceTimersByTimeAsync(249);
      expect(persistence.update).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(persistence.update).toHaveBeenCalledOnce();
      expect(persistence.value).toMatchObject({ version: SESSION_RECOVERY_VERSION, selectedConversationId: 'session-1' });
      expect(storedConversation(persistence.value, 'session-1').queuedTexts).toEqual(['two']);
      store.selectConversation(null);
      await store.flush();
      expect(persistence.update).toHaveBeenCalledTimes(2);
      expect(persistence.value).toMatchObject({ selectedConversationId: null });
    } finally { vi.useRealTimers(); }
  });

  it.each(['synchronous', 'asynchronous'] as const)(
    'rejects %s write failures and retries the latest dirty state', async (failureKind) => {
      const failure = new Error('write failure');
      let stored: unknown;
      let fail = false;
      const persistence: SessionRecoveryPersistence = {
        get<T>(): T | undefined { return stored as T | undefined; },
        update: vi.fn((_key: string, value: unknown) => {
          if (fail) {
            if (failureKind === 'synchronous') throw failure;
            return Promise.reject(failure);
          }
          stored = value;
          return Promise.resolve();
        }),
      };
      const store = new SessionRecoveryStore(persistence);
      writeQueuedText(store, 'session-1', 'committed');
      await store.flush();
      fail = true;
      writeQueuedText(store, 'session-1', 'first');
      await expect(store.flush()).rejects.toBe(failure);
      expect(storedConversation(stored, 'session-1').queuedTexts).toEqual(['committed']);
      writeQueuedText(store, 'session-1', 'latest');
      fail = false;
      await expect(store.flush()).resolves.toBeUndefined();
      expect(storedConversation(stored, 'session-1').queuedTexts).toEqual(['latest']);
    },
  );

  it.each(['pending success', 'synchronous failure', 'asynchronous failure'] as const)(
    'makes dispose join the same %s outcome', async (outcome) => {
      const failure = new Error('final write failure');
      let stored: unknown;
      let resolvePending!: () => void;
      const persistence: SessionRecoveryPersistence = {
        get<T>(): T | undefined { return stored as T | undefined; },
        update: vi.fn((_key: string, value: unknown) => {
          if (outcome === 'synchronous failure') throw failure;
          if (outcome === 'asynchronous failure') return Promise.reject(failure);
          return new Promise<void>((resolve) => {
            resolvePending = () => { stored = value; resolve(); };
          });
        }),
      };
      const store = new SessionRecoveryStore(persistence);
      writeQueuedText(store, 'session-1', 'pending');
      const first = store.dispose();
      const joiner = store.dispose();
      expect(joiner).toBe(first);
      if (outcome === 'pending success') {
        await Promise.resolve();
        expect(stored).toBeUndefined();
        resolvePending();
        await expect(first).resolves.toBeUndefined();
        await expect(joiner).resolves.toBeUndefined();
        expect(storedConversation(stored, 'session-1').queuedTexts).toEqual(['pending']);
        return;
      }
      await expect(first).rejects.toBe(failure);
      await expect(joiner).rejects.toBe(failure);
      expect(persistence.update).toHaveBeenCalledOnce();
    },
  );

  it.each(['synchronous', 'asynchronous'] as const)(
    'contains one %s background failure and leaves state retryable', async (failureKind) => {
      const failure = new Error('sensitive write failure');
      let stored: unknown;
      let fail = true;
      const persistence: SessionRecoveryPersistence = {
        get<T>(): T | undefined { return stored as T | undefined; },
        update: vi.fn((_key: string, value: unknown) => {
          if (fail) {
            if (failureKind === 'synchronous') throw failure;
            return Promise.reject(failure);
          }
          stored = value;
          return Promise.resolve();
        }),
      };
      const store = new SessionRecoveryStore(persistence);
      const reportFailure = vi.fn();
      store.setBackgroundFlushFailureReporter(reportFailure);
      writeQueuedText(store, 'session-1', 'retry');
      store.flushInBackground();
      await vi.waitFor(() => expect(reportFailure).toHaveBeenCalledOnce());
      expect(reportFailure).toHaveBeenCalledWith();
      expect(stored).toBeUndefined();
      fail = false;
      await store.flush();
      expect(storedConversation(stored, 'session-1').queuedTexts).toEqual(['retry']);
    },
  );

  it('persists pending queue changes when disposed before the debounce fires', async () => {
    const persistence = memoryPersistence();
    const store = new SessionRecoveryStore(persistence, SESSION_RECOVERY_STORAGE_KEY, 60_000);
    writeQueuedText(store, 'session-1', 'pending');
    await store.dispose();
    expect(persistence.update).toHaveBeenCalledOnce();
    expect(storedConversation(persistence.value, 'session-1').queuedTexts).toEqual(['pending']);
  });

  it('does not allow callers to mutate queued text or operation evidence by reference', () => {
    const store = new SessionRecoveryStore(memoryPersistence());
    const conversationId = store.createConversation('session-1', cache([]))!;
    const queued = ['safe'];
    const original = operation();
    store.writeConversationQueuedTexts(conversationId, queued);
    store.recordSettledTurn(conversationId, 'session-1', 'turn-1', null,
      [{ path: 'src/app.ts', additions: 1, deletions: 1 }], 'completed', undefined, [original]);
    queued[0] = 'caller queue mutation';
    if (original.operationDiff.status === 'ready') {
      (original.operationDiff.files[0] as { patch: string }).patch = 'caller evidence mutation';
    }
    const read = store.readConversation(conversationId)!;
    (read.queuedTexts as string[])[0] = 'read queue mutation';
    const readDiff = read.turns[0]!.toolOperations![0]!.operationDiff;
    if (readDiff.status === 'ready') (readDiff.files[0] as { patch: string }).patch = 'read evidence mutation';
    expect(store.readConversationQueuedTexts(conversationId)).toEqual(['safe']);
    expect(store.readLatestOperations(conversationId)?.toolOperations).toEqual([operation()]);
  });
});

function operation(): ConversationToolOperation {
  return { toolUseId: 'use-1', toolName: 'Edit', executionPhase: 'settled_after_execution',
    operationDiff: { status: 'ready', source: 'tool-result', callId: 'use-1', sourceSessionId: 'session-1',
      files: [{ path: 'src/app.ts', kind: 'modified', outcome: 'applied', reversible: false, patch: '@@ -1 +1 @@\n-before\n+after' }] } };
}

function writeQueuedText(store: SessionRecoveryStore, sessionId: string, text: string): string {
  const conversationId = store.resolveConversationId(sessionId) ?? store.createConversation(sessionId, cache([]))!;
  store.writeConversationQueuedTexts(conversationId, [text]);
  return conversationId;
}

function storedConversation(value: unknown, conversationId: string): ConversationRecoveryRecord {
  const state = value as { conversations?: readonly ConversationRecoveryRecord[] };
  const conversation = state.conversations?.find((entry) => entry.conversationId === conversationId);
  if (conversation === undefined) throw new Error(`Missing stored conversation ${conversationId}`);
  return conversation;
}

function memoryPersistence(initial?: unknown) {
  const persistence = { value: initial as unknown };
  const get = vi.fn((_key: string) => persistence.value) as unknown as SessionRecoveryPersistence['get'] & ReturnType<typeof vi.fn>;
  const update = vi.fn(async (_key: string, value: unknown) => { persistence.value = value; });
  return Object.assign(persistence, { get, update });
}

function cache(transcript: readonly SessionTranscriptItem[]): SessionRecoveryCache {
  return { transcript, historyStatus: 'complete', truncated: false };
}
