import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { createTurnSnapshotStore, type TurnSnapshotDependencies } from './turnSnapshots';
import { reviewGit } from '../review/reviewGitComparison';

vi.mock('vscode', () => ({}));
const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });
const scope = { sessionId: 'session', turnId: 'turn' };

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'dvx-snapshot-loading-')); directories.push(directory);
  const root = join(directory, 'workspace'), storage = join(directory, 'store');
  const folder = '深层 space/[literal]/a/b/c';
  await mkdir(join(root, folder), { recursive: true }); await mkdir(join(storage, 'objects'), { recursive: true });
  await reviewGit(root, ['init', '--quiet']);
  await writeFile(join(root, folder, 'kept.ts'), 'saved bytes\n');
  await writeFile(join(root, '.gitignore'), 'ignored/\n');
  await reviewGit(root, ['add', '.']);
  const blob = (await reviewGit(root, ['hash-object', '-w', '--stdin'], 4096, Buffer.from('target'))).toString().trim();
  const index = `120000 ${blob}\tlink\0` + `160000 ${'a'.repeat(40)}\tmodule\0`;
  await reviewGit(root, ['update-index', '-z', '--index-info'], 4096, Buffer.from(index));
  const tree = (await reviewGit(root, ['write-tree'])).toString().trim();
  const runGit = vi.fn<TurnSnapshotDependencies['runGit']>((args, options) => new Promise(resolve => {
    const child = execFile('git', [...args], { cwd: options.cwd, env: options.env,
      timeout: options.timeoutMs, maxBuffer: options.maxStdoutBytes, windowsHide: true, encoding: 'buffer' }, (error, stdout) => {
      resolve({ stdout, code: error === null ? 0 : typeof error.code === 'number' ? error.code : null,
        timedOut: error?.killed === true });
    });
    child.stdin?.on('error', () => {}); child.stdin?.end(options.input);
  }));
  const store = (coverage: boolean) => createTurnSnapshotStore(() => root, storage, {
    get: <T>(key: string) => (key === 'droidvisx.turnSnapshots' ? { version: 1,
      sessions: [{ sessionId: scope.sessionId, turns: [{ turnId: scope.turnId, before: tree,
        workspaceRoot: root, ...(coverage ? { coverage: 'workspace-files-v1' } : {}) }] }] } : undefined) as T,
    update: async () => {},
  }, { runGit });
  return { folder, runGit, store };
}

it('proves a deeply nested new file absent with one metadata batch after its listing', async () => {
  const f = await fixture(), store = f.store(true);
  expect(await store.readTreeBytesBatched!(scope, `${f.folder}/kept.ts`, 'before', 1024)).toEqual(Buffer.from('saved bytes\n'));
  f.runGit.mockClear();
  expect(await store.readTreeBytesBatched!(scope, `${f.folder}/new.ts`, 'before', 1024)).toBeNull();
  expect(f.runGit).toHaveBeenCalledTimes(2);
  expect(f.runGit.mock.calls[1]![0]).toContain('--batch-check');
  expect(f.runGit.mock.calls.some(([args]) => args.includes('show'))).toBe(false);
}, 15_000);

it('distinguishes new directories from gitlinks, symlinks and file ancestors', async () => {
  const f = await fixture(), store = f.store(true);
  const paths = [`${f.folder}/new-dir/new.ts`, 'module/new.ts', 'link/new.ts', `${f.folder}/kept.ts/child`, 'node_modules/new.ts'];
  expect(await Promise.all(paths.map(path => store.readTreeBytesBatched!(scope, path, 'before', 1024))))
    .toEqual([null, undefined, undefined, undefined, undefined]);
}, 15_000);

it('retains ignore evidence for legacy partial snapshots', async () => {
  const f = await fixture();
  expect(await f.store(false).readTreeBytesBatched!(scope, 'ignored/new.ts', 'before', 1024)).toBeUndefined();
  expect(await f.store(true).readTreeBytesBatched!(scope, 'ignored/new.ts', 'before', 1024)).toBeNull();
}, 15_000);
