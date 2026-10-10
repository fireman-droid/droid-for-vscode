import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it, vi } from 'vitest';
import { createTurnSnapshotStore, MAX_SNAPSHOT_OBJECT_BYTES, type TurnSnapshotStore } from './turnSnapshots';
import { createGitChangeStatsReader, type ChangeStatsPersistence } from './changeStats';
import { readInlineDiff } from './inlineDiff';
import { readReviewPatch } from '../review/reviewContent';
import { loadTurnReviewScope, refreshTurnReviewStats } from '../review/reviewTurnScope';
import type { RecordedOperation } from '../review/reviewOperationScope';

vi.mock('vscode', () => ({}));

const execute = promisify(execFile);
const stores: TurnSnapshotStore[] = [];
const directories: string[] = [];
const scope = { sessionId: 'session', turnId: 'turn' };

it('keeps turn counts and patches consistent across CRLF changes, settlement and history reload', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dvx-turn-eol-'));
  directories.push(directory);
  const root = join(directory, 'workspace');
  const storage = join(directory, 'store');
  await mkdir(root);
  await execute('git', ['init', '--quiet', root], { windowsHide: true });
  const before = 'first\nold\nlast\n';
  const after = 'first\r\nnew\r\nlast\r\n';
  await writeFile(join(root, 'app.ts'), before);
  await writeFile(join(root, 'eol.ts'), before);
  await execute('git', ['-C', root, 'add', '.'], { windowsHide: true });
  const persistence = memory();
  const store = createTurnSnapshotStore(() => root, storage, persistence);
  stores.push(store);
  await store.capture(scope, 'before');
  const live = createGitChangeStatsReader(() => root, {}, undefined, store);
  await live.captureTurnBaseline!(scope, ['app.ts', 'eol.ts']);
  await writeFile(join(root, 'app.ts'), after);
  await writeFile(join(root, 'eol.ts'), before.replaceAll('\n', '\r\n'));
  const liveStats = await live.read(['app.ts', 'eol.ts'], scope);
  expect(liveStats.get('app.ts')).toMatchObject({ additions: 1, deletions: 1 });
  expect(liveStats.get('eol.ts')).toMatchObject({ additions: 0, deletions: 0 });
  await store.capture(scope, 'after');
  expect((await store.diff(scope)).get('app.ts')).toEqual({ additions: 1, deletions: 1 });
  expect(await store.readTreeBytes(scope, 'app.ts', 'before')).toEqual(Buffer.from(before));
  expect(await store.readTreeBytes(scope, 'app.ts', 'after')).toEqual(Buffer.from(after));
  const reloaded = createTurnSnapshotStore(() => root, storage, persistence);
  stores.push(reloaded);
  await writeFile(join(root, 'app.ts'), 'later unrelated edit\n');
  const paths = ['app.ts', 'eol.ts'];
  const options = { snapshots: reloaded, getWorkspaceRoot: () => root,
    readCanonicalTurnFiles: () => paths.map(path => ({ path, additions: 3, deletions: 3 })),
    readTurnOperations: (): RecordedOperation[] => paths.map((path, sequence) => ({
      sequence, sessionId: scope.sessionId, toolUseId: `edit-${sequence}`, toolName: 'Edit',
      operationDiff: { status: 'ready', source: 'tool-result', files: [{ path,
        kind: 'modified', outcome: 'applied', patch: '@@ -1 +1 @@\n-old\n+new' }] },
    })),
  };
  const review = await refreshTurnReviewStats(options,
    loadTurnReviewScope(options, new Map(), null, scope.sessionId, scope.turnId));
  expect(review.files).toEqual([
    expect.objectContaining({ path: 'app.ts', additions: 1, deletions: 1 }),
    expect.objectContaining({ path: 'eol.ts', additions: 0, deletions: 0 }),
  ]);
  for (const context of [3, 'all'] as const) {
    const result = await readReviewPatch(options, review, 'app.ts', context);
    expect(result.patch).toContain('-old\n+new\r');
    expect(result.patch).not.toContain('-first');
    expect(result.patch).not.toContain('later unrelated edit');
    expect(await readReviewPatch(options, review, 'eol.ts', context)).toMatchObject({ patch: '', truncated: false });
  }
  expect(await reloaded.readTreeBytes(scope, 'app.ts', 'before')).toEqual(Buffer.from(before));
  expect(await reloaded.readTreeBytes(scope, 'app.ts', 'after')).toEqual(Buffer.from(after));
}, 30_000);
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
    readTurnOperations: (): RecordedOperation[] => [{ sequence: 0, sessionId: scope.sessionId, toolUseId: 'edit', toolName: 'Edit',
      operationDiff: { status: 'ready', source: 'tool-result', files: [{ path: 'project/app.ts',
        kind: 'modified', outcome: 'applied', patch: '@@ -1 +1 @@\n-before\n+after' }] } }],
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

it('never treats files below a Git submodule as newly added when the snapshot contains only its gitlink', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dvx-gitlink-review-'));
  directories.push(directory);
  const root = join(directory, 'workspace');
  const nested = join(root, '.cursor', 'skills');
  await mkdir(nested, { recursive: true });
  const git = (cwd: string, ...args: string[]) => execute('git', ['-C', cwd, ...args], { windowsHide: true });
  await git(root, 'init', '--quiet');
  await git(nested, 'init', '--quiet');
  await writeFile(join(nested, 'mcp.json'), '{"fixture":true}\n');
  await git(nested, 'add', 'mcp.json');
  await git(nested, '-c', 'user.name=Diff regression', '-c', 'user.email=diff@example.invalid', 'commit', '-qm', 'fixture');
  await writeFile(join(root, 'app.ts'), 'before\n');
  await git(root, 'add', 'app.ts', '.cursor/skills');
  const index = await readFile(join(root, '.git', 'index'));
  const store = createTurnSnapshotStore(() => root, join(directory, 'store'), memory());
  stores.push(store);
  expect(await store.capture(scope, 'before')).toMatch(/^[0-9a-f]{40}$/);
  expect(await store.readTreeBytes(scope, '.cursor/skills/mcp.json', 'before')).toBeUndefined();
  expect(await store.readTreeBytesBatched!(scope, '.cursor/skills/mcp.json', 'before', 1024)).toBeUndefined();
  expect(await store.readTreeBytes(scope, '.cursor/skills/new.json', 'before')).toBeUndefined();
  expect(await store.readTreeBytes(scope, 'new.ts', 'before')).toBeNull();
  await writeFile(join(root, 'app.ts'), 'after\n');
  await store.capture(scope, 'after');
  expect([...await store.diff(scope)].map(([path]) => path)).toEqual(['app.ts']);
  expect(await store.readTreeBytes(scope, 'app.ts', 'before')).toEqual(Buffer.from('before\n'));
  expect(await store.readTreeBytes(scope, 'app.ts', 'after')).toEqual(Buffer.from('after\n'));
  expect(await readFile(join(root, '.git', 'index'))).toEqual(index);
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
