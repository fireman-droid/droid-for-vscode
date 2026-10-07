import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { reviewGit } from '../review/reviewGitComparison';
import { createGitWorkflow, type GitChangeLike, type GitRepositoryLike } from './gitWorkflow';

let root: string;
const git = async (...args: string[]) => (await reviewGit(root, args)).toString().trim();
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dvx-review-commit-'));
  await git('init', '--quiet');
  await git('config', 'user.name', 'Review test');
  await git('config', 'user.email', 'review-test@example.invalid');
  await git('config', 'commit.gpgsign', 'false');
  await mkdir(join(root, 'hooks'));
  await git('config', 'core.hooksPath', join(root, 'hooks').replaceAll('\\', '/'));
  await writeFile(join(root, 'a.txt'), 'base a\n');
  await writeFile(join(root, 'b.txt'), 'base b\n');
  await git('add', '--', 'a.txt', 'b.txt');
  await git('commit', '-qm', 'baseline');
  await writeFile(join(root, 'a.txt'), 'staged a\n');
  await git('add', '--', 'a.txt');
  await writeFile(join(root, 'a.txt'), 'working a\n');
  await writeFile(join(root, 'b.txt'), 'working b\n');
});
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); });

function workflow() {
  const state = { HEAD: { name: '', commit: '' }, workingTreeChanges: [] as GitChangeLike[],
    indexChanges: [] as GitChangeLike[], mergeChanges: [] as GitChangeLike[] };
  // Adapt the public VS Code Git interface to real git commands in this fixture.
  const repository: GitRepositoryLike = {
    rootUri: { fsPath: root }, state,
    async status() {
      state.HEAD = { name: await git('symbolic-ref', '--short', 'HEAD'), commit: await git('rev-parse', 'HEAD') };
      state.workingTreeChanges = []; state.indexChanges = [];
      const rows = (await reviewGit(root, ['status', '--porcelain=v1', '-z', '--untracked-files=no'])).toString().split('\0').filter(Boolean);
      for (const row of rows) {
        const uri = { fsPath: join(root, row.slice(3)) };
        if (row[0] !== ' ') state.indexChanges.push({ uri, status: 0 });
        if (row[1] !== ' ') state.workingTreeChanges.push({ uri, status: 5 });
      }
    },
    async add(paths) { await git('add', '--', ...paths); },
    async commit(message) { await git('commit', '-m', message); },
    async getCommit(ref) { return { hash: await git('rev-parse', ref) }; },
  };
  return createGitWorkflow(async () => ({ repositories: [repository] }));
}

it.each(['files', 'staged'] as const)('commits real %s content and preserves unselected working files', async mode => {
  const flow = workflow();
  const status = await flow.status(root, new Set(['a.txt']));
  if (!status.available) throw new Error('Expected a Git preview');
  const result = await flow.commit(root, ['a.txt'], `Review ${mode}`, undefined, { snapshotId: status.snapshotId, mode });
  expect(result).toMatchObject({ ok: true, hash: expect.any(String) });
  expect(await git('show', 'HEAD:a.txt')).toBe(mode === 'staged' ? 'staged a' : 'working a');
  expect(await git('show', 'HEAD:b.txt')).toBe('base b');
  expect(await readFile(join(root, 'b.txt'), 'utf8')).toBe('working b\n');
  expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('working a\n');
}, 30_000);

it('reports a real rejecting Git hook without claiming a commit or discarding working files', async () => {
  const before = await git('rev-parse', 'HEAD');
  await writeFile(join(root, 'hooks', 'pre-commit'), '#!/bin/sh\necho review-hook-rejected >&2\nexit 1\n', { mode: 0o755 });
  const flow = workflow(), status = await flow.status(root, new Set());
  if (!status.available) throw new Error('Expected a Git preview');
  expect(await flow.commit(root, ['a.txt'], 'Rejected', undefined, { snapshotId: status.snapshotId, mode: 'staged' }))
    .toMatchObject({ ok: false, error: expect.stringContaining('review-hook-rejected') });
  expect(await git('rev-parse', 'HEAD')).toBe(before);
  expect(await git('show', ':a.txt')).toBe('staged a');
  expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('working a\n');
}, 30_000);
