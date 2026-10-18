import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TurnSnapshotStore } from '../changes/turnSnapshots';
import type { ReviewScopeState } from '../../shared/protocol/reviewProtocol';
import { ReviewCoordinator } from './reviewCoordinator';
import { ReviewReadCache, reviewDisplayVersion } from './reviewReadCache';
import { createActiveScope } from './reviewCoordinatorSupport';

vi.mock('vscode', () => ({ workspace: {
  createFileSystemWatcher: () => ({ dispose() {}, onDidChange: () => ({ dispose() {} }),
    onDidCreate: () => ({ dispose() {} }), onDidDelete: () => ({ dispose() {} }) }),
  onDidChangeTextDocument: () => ({ dispose() {} }), textDocuments: [],
} }));
const directories: string[] = [];
const coordinators: ReviewCoordinator[] = [];
afterEach(async () => {
  coordinators.splice(0).forEach(coordinator => coordinator.dispose());
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'droid-review-loading-')); directories.push(root);
  let after = 'after-tree';
  const read = vi.fn(async (_scope: unknown, path: string, side: string): Promise<Buffer> => Buffer.from(`${side}-${path}-${side === 'after' ? after : ''}\n`));
  const snapshots = { read: () => ({ before: 'before-tree', after }), readTreeBytes: read } as unknown as TurnSnapshotStore;
  let state: ReviewScopeState;
  const coordinator = new ReviewCoordinator({
    getWorkspaceRoot: () => root, snapshots, openSelectionInEditor: false,
    fileDiff: { openDiff: async () => 'opened-diff' }, storageDir: join(root, 'storage'),
    persistence: { get: () => undefined, update: async () => {} },
    publish: message => { if (message.type === 'review.state') state = message.state; },
    readCanonicalTurnFiles: () => Array.from({ length: 100 }, (_, index) => ({ path: `file-${index}.ts`, additions: 1, deletions: 1 })),
    readTurnOperations: () => Array.from({ length: 100 }, (_, index) => ({
      sequence: index, sessionId: 'session', toolUseId: `edit-${index}`, toolName: 'Edit',
      operationDiff: { status: 'ready', source: 'tool-result', files: [{
        path: `file-${index}.ts`, kind: 'modified', outcome: 'applied', patch: '@@ -1 +1 @@\n-before\n+after',
      }] },
    })),
    readWorkspaceFiles: async () => undefined, readBranchDiff: async () => undefined,
  });
  coordinators.push(coordinator);
  const open = async () => {
    coordinator.handle({ type: 'review.open', sessionId: 'session', scopeKind: 'turn', turnId: 'turn' });
    await coordinator.replay('session');
    return state!;
  };
  const request = (state: ReviewScopeState, path = state.files[0]!.path, context: 3 | 20 | 'all' = 3) =>
    ({ sessionId: state.sessionId, reviewScopeId: state.reviewScopeId, baseline: state.baseline, path, context });
  return { root, snapshots, coordinator, read, open, request, change: () => { after = 'new-after-tree'; } };
}

it('publishes 100 files without reading bodies, reuses contents across contexts and reopening, and invalidates a new snapshot', async () => {
  const f = await fixture();
  let state = await f.open();
  expect(state.files).toHaveLength(100); expect(f.read).not.toHaveBeenCalled();
  const [first, duplicate] = await Promise.all([f.coordinator.readFile(f.request(state)), f.coordinator.readFile(f.request(state))]);
  expect(first).toEqual(duplicate); expect(f.read).toHaveBeenCalledTimes(2);
  await f.coordinator.readFile(f.request(state, state.files[0]!.path, 'all'));
  state = await f.open(); await f.coordinator.readFile(f.request(state));
  expect(f.read).toHaveBeenCalledTimes(2);
  f.coordinator.handle({ type: 'review.markReviewed', ...f.request(state), version: first.version, advance: false });
  await f.coordinator.replay('session');
  expect(f.read).toHaveBeenCalledTimes(4); // Rechecking the action bypasses display caches.
  f.change(); state = await f.open();
  const changed = await f.coordinator.readFile(f.request(state));
  expect(changed.version).not.toBe(first.version); expect(changed.patch).toContain('new-after-tree');
  expect(f.read).toHaveBeenCalledTimes(6);
});

it('rejects old scope results after another comparison opens', async () => {
  const f = await fixture(); const state = await f.open();
  let resolve!: (value: Buffer) => void;
  const gate = { promise: new Promise<Buffer>(done => { resolve = done; }), resolve: (value: Buffer) => resolve(value) };
  f.read.mockImplementationOnce(() => gate.promise);
  const pending = f.coordinator.readFile(f.request(state));
  const rejected = expect(pending).rejects.toThrow('changed while loading');
  await vi.waitFor(() => expect(f.read).toHaveBeenCalled());
  f.change(); await f.open(); gate.resolve(Buffer.from('old\n')); await rejected;
});

it('changes the live display revision for same-size saves with distinct file timestamps', async () => {
  const f = await fixture(); const path = 'same.ts'; await writeFile(join(f.root, path), 'before\n');
  const savedAt = new Date('2026-01-01T00:00:00Z');
  await utimes(join(f.root, path), savedAt, savedAt);
  const scope = createActiveScope({ type: 'review.open', sessionId: 's', scopeKind: 'workspace' }, 'head:worktree', 'HEAD',
    [{ path, additions: 1, deletions: 1 }], new Map());
  const source = { snapshots: f.snapshots, getWorkspaceRoot: () => f.root };
  const first = await reviewDisplayVersion(source, scope, path);
  await writeFile(join(f.root, path), 'after!\n');
  // Display versions use file metadata; two fast writes can share a filesystem clock tick.
  const nextSave = new Date(savedAt.getTime() + 1_000);
  await utimes(join(f.root, path), nextSave, nextSave);
  expect(await reviewDisplayVersion(source, scope, path)).not.toBe(first);
});

it('bounds cached bytes, deduplicates pending loads, and does not cache errors', async () => {
  const cache = new ReviewReadCache<string>(value => value.length, 6);
  const load = vi.fn(async () => 'aaaa');
  await Promise.all([cache.read('a', load), cache.read('a', load)]); expect(load).toHaveBeenCalledOnce();
  await cache.read('b', async () => 'bbbb'); await cache.read('a', load); expect(load).toHaveBeenCalledTimes(2);
  await expect(cache.read('bad', async () => { throw new Error('failed'); })).rejects.toThrow('failed');
  expect(await cache.read('bad', async () => 'ok')).toBe('ok');
});
