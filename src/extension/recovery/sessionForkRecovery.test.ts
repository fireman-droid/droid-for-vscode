import { describe, expect, it } from 'vitest';
import { createDurableForkConversation } from '../chat/recovery/conversationLineage';
import {
  SessionRecoveryStore, SESSION_RECOVERY_VERSION, type SessionRecoveryCache,
} from './SessionRecoveryStore';
import { type ConversationRecoveryRecord, type ConversationToolOperation } from './conversationRecoveryState';

const empty: SessionRecoveryCache = { transcript: [], historyStatus: 'complete', truncated: false };
const inherited: SessionRecoveryCache = { ...empty, transcript: [{
  id: 'changes-old', kind: 'changes', turnId: 'old',
  files: [{ path: 'src/app.ts', additions: 1, deletions: 0 }],
}] };
const evidence: ConversationToolOperation = {
  toolUseId: 'edit-old', toolName: 'Edit', executionPhase: 'settled_after_execution',
  operationDiff: { status: 'ready', source: 'tool-result',
    files: [{ path: 'src/app.ts', kind: 'modified', outcome: 'applied', patch: '@@ -1 +1 @@\n-before\n+after' }] },
};

describe('fork recovery with inherited turn metadata', () => {
  it.each(['fork', 'rewind'] as const)(
    'reloads a selected %s with its original Review snapshot owner and new turns', async (relation) => {
      const persistence = memoryPersistence();
      const store = new SessionRecoveryStore(persistence);
      seedSource(store);
      const source = store.readConversation('parent');
      expect(await createDurableForkConversation(
        { recoveryStore: store }, 'parent', 'parent', 'child', relation, inherited,
      )).toBe('child');
      store.recordSettledTurn('child', 'child', 'new', null, [], 'completed', 'message-new');
      await store.dispose();

      const reloaded = new SessionRecoveryStore(persistence);
      await reloaded.load();
      expect(reloaded.getSelectedSessionId()).toBe('child');
      expect(reloaded.readConversation('parent')).toEqual(source);
      expect(reloaded.resolveConversationId('parent')).toBe('parent');
      expect(reloaded.readTurn('child', 'old')).toMatchObject({
        sessionId: 'parent', messageId: 'message-old', toolOperations: [evidence],
        files: inherited.transcript[0]!.kind === 'changes' ? inherited.transcript[0]!.files : [],
        firstRevision: 1, lastRevision: 1,
      });
      expect(reloaded.readTurn('child', 'new')?.sessionId).toBe('child');
      expect(reloaded.readTurn('child', 'omitted')).toBeUndefined();
      expect(reloaded.readConversationQueuedTexts('child')).toEqual([]);
      expect(reloaded.readConversationQueuedTexts('parent')).toEqual(['Unsent parent prompt']);
      await reloaded.dispose();
    },
  );

  it('keeps inherited Review evidence after a second fork and parent eviction', async () => {
    const persistence = memoryPersistence();
    const store = new SessionRecoveryStore(persistence);
    seedSource(store);
    store.forkConversation('parent', 'parent', 'child', 'rewind', inherited);
    store.adoptSuccessor('child', 'child', 'compacted', 'compact');
    store.forkConversation('child', 'compacted', 'grandchild', 'fork', inherited);
    store.selectConversation('grandchild');
    store.discardConversation('parent');
    store.discardConversation('child');
    await store.dispose();
    const reloaded = new SessionRecoveryStore(persistence);
    await reloaded.load();
    expect(reloaded.getSelectedSessionId()).toBe('grandchild');
    expect(reloaded.readTurn('grandchild', 'old')).toMatchObject({
      sessionId: 'parent', toolOperations: [evidence], firstRevision: 1, lastRevision: 1,
    });
    expect(reloaded.resolveConversationId('parent')).toBeUndefined();
    await reloaded.dispose();
  });

  it.each([1, 700])('loads old fork metadata with inherited source revision %i', async (sourceRevision) => {
    const persistence = memoryPersistence();
    const store = new SessionRecoveryStore(persistence);
    seedSource(store);
    store.forkConversation('parent', 'parent', 'child', 'rewind', inherited);
    store.adoptSuccessor('child', 'child', 'compacted', 'compact');
    const fork = store.readConversation('child')!;
    await store.dispose();
    // Reproduce the previous writer: the foreign turn kept its source revision.
    // The source can already have fallen out of the bounded recovery store.
    persistence.value = {
      version: SESSION_RECOVERY_VERSION, selectedConversationId: 'child',
      conversations: [{ ...fork, turns: fork.turns.map((turn) => ({
        ...turn, firstRevision: sourceRevision, lastRevision: sourceRevision,
      })) }],
    };
    const reloaded = new SessionRecoveryStore(persistence);
    await reloaded.load();
    expect(reloaded.getSelectedSessionId()).toBe('compacted');
    expect(reloaded.readTurn('child', 'old')).toMatchObject({
      sessionId: 'parent', firstRevision: 1, lastRevision: 1, toolOperations: [evidence],
    });
    await reloaded.dispose();
    const nextReload = new SessionRecoveryStore(persistence);
    await nextReload.load();
    expect(nextReload.getSelectedSessionId()).toBe('compacted');
    await nextReload.dispose();
  });

  it('still rejects unowned root turns and invalid local or reversed revisions', async () => {
    const seed = new SessionRecoveryStore(memoryPersistence());
    seedSource(seed);
    seed.forkConversation('parent', 'parent', 'child', 'rewind', inherited);
    const fork = seed.readConversation('child')!;
    const parent = seed.readConversation('parent')!;
    await seed.dispose();
    const invalid: ConversationRecoveryRecord[] = [
      { ...parent, turns: parent.turns.map((turn) => ({ ...turn, sessionId: 'unknown' })) },
      { ...fork, turns: fork.turns.map((turn) => ({ ...turn, sessionId: 'child', lastRevision: 700 })) },
      { ...fork, turns: fork.turns.map((turn) => ({ ...turn, firstRevision: 3, lastRevision: 2 })) },
    ];
    for (const conversation of invalid) {
      const store = new SessionRecoveryStore(memoryPersistence({
        version: SESSION_RECOVERY_VERSION,
        selectedConversationId: conversation.conversationId, conversations: [conversation],
      }));
      await store.load();
      expect(store.getSelectedSessionId()).toBeNull();
      expect(store.readConversation(conversation.conversationId)).toBeUndefined();
      await store.dispose();
    }
  });
});

function seedSource(store: SessionRecoveryStore): void {
  store.createConversation('parent', empty);
  store.writeActiveDisplay('parent', 'parent', empty, { turnId: 'old', status: 'streaming' });
  store.writeActiveDisplay('parent', 'parent', empty, { turnId: 'old', status: 'completed' });
  store.recordSettledTurn('parent', 'parent', 'old', null,
    [{ path: 'src/app.ts', additions: 1, deletions: 0 }], 'completed', 'message-old', [evidence]);
  store.recordSettledTurn('parent', 'parent', 'omitted', null, [], 'completed', 'message-omitted');
  store.writeConversationQueuedTexts('parent', ['Unsent parent prompt']);
}

function memoryPersistence(initial?: unknown) {
  return {
    value: initial,
    get<T>(): T | undefined { return this.value as T | undefined; },
    async update(_key: string, value: unknown) { this.value = structuredClone(value); },
  };
}
