import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { reviewGit } from '../review/reviewGitComparison';
import { createGitCommitSnapshots } from './gitCommitSnapshot';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dvx-commit-preview-'));
  await reviewGit(root, ['init', '--quiet']);
  await writeFile(join(root, 'a.txt'), 'staged content\n');
  await reviewGit(root, ['add', '--', 'a.txt']);
  await writeFile(join(root, 'a.txt'), 'working content\n');
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
const files = [{ path: 'a.txt', status: 'modified' as const, staged: true, inTurn: true }];

it('binds a commit preview to the actual file bytes and staged objects', async () => {
  const snapshots = createGitCommitSnapshots();
  const id = await snapshots.capture(root, files);
  await expect(snapshots.verify(id, root, ['a.txt'], 'files')).resolves.toBeUndefined();
  await expect(snapshots.verify(id, root, ['a.txt'], 'files', false)).rejects.toThrow('changed');
  await writeFile(join(root, 'a.txt'), 'later worker content\n');
  await expect(snapshots.verify(id, root, ['a.txt'], 'files')).rejects.toThrow('changed');
  await expect(snapshots.verify(id, root, ['a.txt'], 'staged')).resolves.toBeUndefined();
  expect((await reviewGit(root, ['show', ':a.txt'])).toString()).toBe('staged content\n');
  await reviewGit(root, ['add', '--', 'a.txt']);
  await expect(snapshots.verify(id, root, ['a.txt'], 'staged')).rejects.toThrow('changed');
}, 30_000);

it('rejects a switched unborn branch or a file absent from the preview', async () => {
  const snapshots = createGitCommitSnapshots();
  const id = await snapshots.capture(root, files);
  await expect(snapshots.verify(id, root, ['unreviewed.txt'], 'files')).rejects.toThrow('preview');
  await reviewGit(root, ['symbolic-ref', 'HEAD', 'refs/heads/other-preview-branch']);
  await expect(snapshots.verify(id, root, ['a.txt'], 'staged')).rejects.toThrow('changed');
}, 30_000);
