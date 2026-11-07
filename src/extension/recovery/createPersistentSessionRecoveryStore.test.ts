import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { createPersistentSessionRecoveryStore } from './createPersistentSessionRecoveryStore';
import { createRootConversation, type ConversationToolOperation } from './conversationRecoveryState';
import { SESSION_RECOVERY_STORAGE_KEY, SESSION_RECOVERY_VERSION, type SessionRecoveryPersistence } from './SessionRecoveryStore';

vi.mock('node:fs/promises', async original => ({ ...await original<typeof import('node:fs/promises')>() }));

const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(directories.splice(0).map(directory => fs.rm(directory, { recursive: true, force: true })));
});

async function storage() {
  const fsPath = await fs.mkdtemp(path.join(tmpdir(), 'droid-recovery-storage-'));
  directories.push(fsPath);
  return { uri: { fsPath }, file: path.join(fsPath, 'session-recovery.json') };
}

function state() {
  const root = createRootConversation('session-root', { transcript: [], historyStatus: 'complete', truncated: false }, 1, ['Unsent queue']);
  const operations: ConversationToolOperation[] = [0, 1, 2, 3].map(index => ({
    toolUseId: `write-${index}`, toolName: 'Create', executionPhase: 'settled_after_execution',
    operationDiff: { status: 'ready', source: 'tool-result', callId: `write-${index}`, sourceSessionId: 'session-root',
      files: [{ path: `src/generated-${index}.ts`, kind: 'added', outcome: 'applied', reversible: false,
        patch: '', submittedContent: 'x'.repeat(120_000) }] },
  }));
  return { version: SESSION_RECOVERY_VERSION, selectedConversationId: root.conversationId, conversations: [{
    ...root, activeSessionId: 'session-successor',
    nodes: [...root.nodes, { sessionId: 'session-successor', relation: 'compact', parentConversationId: root.conversationId,
      parentSessionId: 'session-root', checkpointRevision: 1 }],
    turns: [{ turnId: 'turn-1', sessionId: 'session-root', prompt: null, status: 'completed', changesSettled: true,
      files: [{ path: 'src/generated-0.ts', additions: 1, deletions: 0 }], toolOperations: operations, firstRevision: 1, lastRevision: 1 }],
  }] };
}

function memory(initial: unknown = state()) {
  let value = initial;
  const update = vi.fn(async (_key: string, next: unknown) => { value = next; });
  const persistence: SessionRecoveryPersistence = { get: <T>() => value as T, update };
  return { persistence, update, value: () => value, set: (next: unknown) => { value = next; } };
}

it('commits complete recovery evidence before replacing Memento and restores it in the same workspace', async () => {
  const disk = await storage(), memento = memory(), initial = memento.value();
  const store = createPersistentSessionRecoveryStore(memento.persistence, disk.uri);
  await store.load();
  expect(memento.update).not.toHaveBeenCalled();
  memento.update.mockImplementationOnce(async (_key, marker) => {
    expect(JSON.parse(await fs.readFile(disk.file, 'utf8'))).toEqual(initial);
    expect(Buffer.byteLength(JSON.stringify(marker))).toBeLessThan(100);
    memento.set(marker);
  });
  await store.flush();
  expect(memento.update).toHaveBeenCalledWith(SESSION_RECOVERY_STORAGE_KEY, { storage: 'workspace-file', version: 1 });
  await store.dispose();
  const restored = createPersistentSessionRecoveryStore(memento.persistence, disk.uri);
  await restored.load();
  expect(restored.getSelectedSessionId()).toBe('session-successor');
  expect(restored.readConversation('session-root')).toEqual(state().conversations[0]);
  await restored.dispose();
  const other = createPersistentSessionRecoveryStore(memory(null).persistence, (await storage()).uri);
  await other.load();
  expect(other.getSelectedSessionId()).toBeNull();
  await other.dispose();
});

it.each(['open', 'rename'] as const)('retains legacy Memento when the first file %s fails, then retries', async operation => {
  const disk = await storage(), memento = memory(), initial = memento.value();
  const store = createPersistentSessionRecoveryStore(memento.persistence, disk.uri);
  await store.load();
  const failure = Object.assign(new Error('Storage unavailable'), { code: 'EACCES' });
  const write = vi.spyOn(fs, operation).mockRejectedValueOnce(failure);
  await expect(store.flush()).rejects.toBe(failure);
  expect(memento.value()).toEqual(initial);
  expect(memento.update).not.toHaveBeenCalled();
  await expect(fs.readFile(disk.file)).rejects.toMatchObject({ code: 'ENOENT' });
  write.mockRestore();
  await store.flush();
  expect(JSON.parse(await fs.readFile(disk.file, 'utf8'))).toEqual(initial);
  await store.dispose();
});

it('keeps the previous committed file on a failed replacement without truncating pending recovery', async () => {
  const disk = await storage(), memento = memory();
  const store = createPersistentSessionRecoveryStore(memento.persistence, disk.uri);
  await store.load();
  await store.flush();
  const committed = await fs.readFile(disk.file, 'utf8');
  store.writeConversationQueuedTexts('session-root', ['New unsent queue']);
  const failure = new Error('Rename failed');
  const rename = vi.spyOn(fs, 'rename').mockRejectedValueOnce(failure);
  await expect(store.flush()).rejects.toBe(failure);
  expect(await fs.readFile(disk.file, 'utf8')).toBe(committed);
  expect(store.readConversationQueuedTexts('session-root')).toEqual(['New unsent queue']);
  rename.mockRestore();
  await store.flush();
  expect(JSON.parse(await fs.readFile(disk.file, 'utf8')).conversations[0].queuedTexts).toEqual(['New unsent queue']);
  expect(memento.update).toHaveBeenCalledTimes(1);
  await store.dispose();
});

it('recovers the newer committed file if replacing the legacy Memento fails after rename', async () => {
  const disk = await storage(), memento = memory(), initial = memento.value();
  const store = createPersistentSessionRecoveryStore(memento.persistence, disk.uri);
  await store.load();
  store.writeConversationQueuedTexts('session-root', ['Newest unsent queue']);
  memento.update.mockRejectedValueOnce(new Error('Memento unavailable'));
  await expect(store.flush()).rejects.toThrow('Memento unavailable');
  expect(memento.value()).toEqual(initial);
  const restored = createPersistentSessionRecoveryStore(memento.persistence, disk.uri);
  await restored.load();
  expect(restored.readConversationQueuedTexts('session-root')).toEqual(['Newest unsent queue']);
  expect(restored.readTurn('session-root', 'turn-1')?.toolOperations).toEqual(state().conversations[0].turns[0].toolOperations);
  await store.dispose();
  await restored.dispose();
  expect(memento.value()).toEqual({ storage: 'workspace-file', version: 1 });
});

it.each(['missing', 'invalid', 'unreadable'] as const)('does not replace %s migrated recovery with an empty state', async condition => {
  const disk = await storage(), memento = memory({ storage: 'workspace-file', version: 1 });
  if (condition !== 'missing') await fs.writeFile(disk.file, condition === 'invalid' ? 'private malformed content' : JSON.stringify(state()));
  const prior = condition === 'missing' ? undefined : await fs.readFile(disk.file, 'utf8');
  if (condition === 'unreadable') vi.spyOn(fs, 'readFile').mockRejectedValueOnce(Object.assign(new Error('Read unavailable'), { code: 'EACCES' }));
  const store = createPersistentSessionRecoveryStore(memento.persistence, disk.uri);
  await expect(store.load()).rejects.toThrow(condition === 'missing' ? 'file is missing' : condition === 'invalid' ? 'file is invalid' : 'Read unavailable');
  store.createConversation('another', { transcript: [], historyStatus: 'complete', truncated: false });
  await expect(store.flush()).rejects.toThrow('must be loaded');
  expect(memento.update).not.toHaveBeenCalled();
  if (prior !== undefined) expect(await fs.readFile(disk.file, 'utf8')).toBe(prior);
  else await expect(fs.readFile(disk.file)).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(store.dispose()).rejects.toThrow('must be loaded');
});

it('retains the original Memento behavior when workspace storage is unavailable', async () => {
  const memento = memory();
  const store = createPersistentSessionRecoveryStore(memento.persistence, undefined);
  await store.load();
  store.writeConversationQueuedTexts('session-root', ['Empty-window queue']);
  await store.flush();
  expect(memento.value()).toMatchObject({ version: SESSION_RECOVERY_VERSION, conversations: [
    expect.objectContaining({ queuedTexts: ['Empty-window queue'] }),
  ] });
  await store.dispose();
});
