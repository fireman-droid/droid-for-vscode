import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it, vi } from 'vitest';
import { createTurnSnapshotStore, MAX_SNAPSHOT_OBJECT_BYTES, type TurnSnapshotStore } from './turnSnapshots';
import type { ChangeStatsPersistence } from './changeStats';
import { readInlineDiff } from './inlineDiff';
import { readReviewPatch } from '../review/reviewContent';
import { loadTurnReviewScope } from '../review/reviewTurnScope';

vi.mock('vscode', () => ({}));

const execute = promisify(execFile);
const stores: TurnSnapshotStore[] = [];
const directories: string[] = [];
const scope = { sessionId: 'session', turnId: 'turn' };
function memory(): ChangeStatsPersistence {
  const data = new Map<string, unknown>();
  return { get: <T>(key: string) => data.get(key) as T | undefined, update: async (key, value) => { data.set(key, value); } };
}
afterEach(async () => {
  await Promise.all(stores.splice(0).map((store) => store.dispose()));
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

it('captures real before/after bytes in a non-Git workspace containing a nested repository', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dvx-folder-snapshots-'));
  directories.push(directory);
  const root = join(directory, 'workspace');
  const nested = join(root, 'project');
  await mkdir(nested, { recursive: true });
  await execute('git', ['init', '--quiet', nested], { windowsHide: true });
  await writeFile(join(nested, '.gitignore'), 'ignored.txt\nnode_modules/\n');
  await writeFile(join(nested, 'ignored.txt'), 'ignored output\n');
  await writeFile(join(nested, 'app.ts'), 'before\n');
  await writeFile(join(nested, 'deleted.ts'), 'removed\n');
  await execute('git', ['-C', nested, 'add', 'app.ts'], { windowsHide: true });
  const index = await readFile(join(nested, '.git/index'));
  const persistence = memory();
  const storage = join(directory, 'store');
  const store = createTurnSnapshotStore(() => root, storage, persistence);
  stores.push(store);
  expect(await store.capture(scope, 'before')).toMatch(/^[0-9a-f]{40}$/);
  await writeFile(join(nested, 'app.ts'), 'after\n');
  await rm(join(nested, 'deleted.ts'));
  await writeFile(join(nested, 'created.ts'), 'created\n');
  await store.capturePaths(scope, [join(nested, 'app.ts'), join(nested, 'created.ts')]);
  expect(await store.capture(scope, 'after')).toMatch(/^[0-9a-f]{40}$/);
  expect(await store.readTreeBytes(scope, 'project/app.ts', 'before')).toEqual(Buffer.from('before\n'));
  expect(await store.readTreeBytes(scope, 'project/app.ts', 'after')).toEqual(Buffer.from('after\n'));
  expect(await store.readTreeBytes(scope, 'project/created.ts', 'before')).toBeNull();
  expect(await store.readTreeBytes(scope, 'project/deleted.ts', 'after')).toBeNull();
  // An ignored file omitted from the capture is unknown, not proven absent.
  expect(await store.readTreeBytes(scope, 'project/ignored.txt', 'before')).toBeUndefined();
  expect(await readFile(join(nested, '.git/index'))).toEqual(index);
  await expect(access(join(root, '.git'))).rejects.toMatchObject({ code: 'ENOENT' });
  await writeFile(join(nested, 'app.ts'), 'later unrelated edit\n');
  const reloaded = createTurnSnapshotStore(() => root, storage, persistence);
  stores.push(reloaded);
  await reloaded.prune();
  expect(await readInlineDiff(reloaded, scope, root, 'project/app.ts', 'settled')).toMatchObject({
    status: 'ready', patch: expect.stringContaining('-before\n+after'),
  });
  expect((await reloaded.diff(scope)).get('project/created.ts')).toEqual({ additions: 1, deletions: 0 });
  const options = { snapshots: reloaded, getWorkspaceRoot: () => root,
    readCanonicalTurnFiles: () => [{ path: 'project/app.ts', additions: 1, deletions: 1 }],
  };
  const review = loadTurnReviewScope(options, new Map(), null, scope.sessionId, scope.turnId);
  expect(review.lifecycle).toBe('settled');
  // A workspace snapshot proves versions, not exclusive authorship for undo.
  expect(review.files[0]).toMatchObject({ comparable: true, restorable: false });
  expect(await readReviewPatch(options, review, 'project/app.ts', 3)).toMatchObject({
    patch: expect.stringContaining('-before\n+after'), truncated: false,
  });
  const other = createTurnSnapshotStore(() => root, storage, memory());
  stores.push(other);
  await other.prune();
  expect(await reloaded.readTreeBytes(scope, 'project/app.ts', 'before')).toEqual(Buffer.from('before\n'));
  const isolated = createTurnSnapshotStore(() => root, join(directory, 'isolated'), persistence, undefined, storage);
  stores.push(isolated);
  await isolated.prune();
  expect(await isolated.readTreeBytes(scope, 'project/app.ts', 'before')).toEqual(Buffer.from('before\n'));
}, 30_000);

it('preserves the original Git baseline when Execute changes precede a named file tool', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dvx-git-snapshots-'));
  directories.push(directory);
  const root = join(directory, 'workspace');
  await mkdir(root);
  await execute('git', ['init', '--quiet', root], { windowsHide: true });
  await writeFile(join(root, 'file.ts'), 'original\n');
  const store = createTurnSnapshotStore(() => root, join(directory, 'store'), memory());
  stores.push(store);
  await store.capture(scope, 'before');
  await writeFile(join(root, 'file.ts'), 'execute edit\n');
  await writeFile(join(root, 'created.ts'), 'execute creation\n');
  await store.capturePaths(scope, [join(root, 'file.ts'), join(root, 'created.ts')]);
  await writeFile(join(root, 'file.ts'), 'final\n');
  await store.capture(scope, 'after');
  expect(await store.readTreeBytes(scope, 'file.ts', 'before')).toEqual(Buffer.from('original\n'));
  expect(await store.readTreeBytes(scope, 'created.ts', 'before')).toBeNull();
  expect(await readInlineDiff(store, scope, root, 'file.ts', 'settled')).toMatchObject({
    status: 'ready', patch: expect.stringContaining('-original\n+final'),
  });
}, 30_000);

it('prunes unreachable private objects while keeping retained history after reload', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dvx-snapshot-prune-'));
  directories.push(directory);
  const root = join(directory, 'workspace');
  const storage = join(directory, 'store');
  await mkdir(root);
  await execute('git', ['init', '--quiet', root], { windowsHide: true });
  const persistence = memory();
  const store = createTurnSnapshotStore(() => root, storage, persistence);
  stores.push(store);
  await writeFile(join(root, 'file.ts'), 'expired original\n');
  const expired = await store.capture(scope, 'before');
  await writeFile(join(root, 'file.ts'), 'expired final\n');
  await store.capture(scope, 'after');
  const kept = { sessionId: 'session', turnId: 'kept' };
  await writeFile(join(root, 'file.ts'), 'retained original\n');
  await store.capture(kept, 'before');
  await writeFile(join(root, 'file.ts'), 'retained final\n');
  await store.capture(kept, 'after');
  const keptRecord = store.read(kept.sessionId, kept.turnId)!;
  await store.dispose();
  await persistence.update('droidvisx.turnSnapshots', {
    version: 1, sessions: [{ sessionId: kept.sessionId, turns: [keptRecord] }],
  });
  const reloaded = createTurnSnapshotStore(() => root, storage, persistence, {
    stat: async path => {
      const info = await stat(path);
      return { size: info.isDirectory() ? 0 : MAX_SNAPSHOT_OBJECT_BYTES + info.size, isDirectory: () => info.isDirectory() };
    },
  });
  stores.push(reloaded);
  await reloaded.prune();
  expect(await reloaded.readTreeBytes(kept, 'file.ts', 'before')).toEqual(Buffer.from('retained original\n'));
  expect(await reloaded.readTreeBytes(kept, 'file.ts', 'after')).toEqual(Buffer.from('retained final\n'));
  await expect(access(join(storage, 'objects', expired!.slice(0, 2), expired!.slice(2)))).rejects.toMatchObject({ code: 'ENOENT' });
  expect(reloaded.read(kept.sessionId, kept.turnId)).toEqual(keptRecord);
}, 30_000);
