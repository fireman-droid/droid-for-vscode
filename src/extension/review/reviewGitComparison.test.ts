import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it } from 'vitest';
import { loadReviewGitScope, readReviewBranches, readReviewVersion, reviewGit } from './reviewGitComparison';

const execute = promisify(execFile);
let root: string | undefined;
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); });
it('compares index and worktree independently while keeping index contents unchanged', async () => {
  root = await mkdtemp(join(tmpdir(), 'dvx-review-scope-'));
  // Clone the local committed baseline; tests never set Git identity or create commits.
  await execute('git', ['clone', '--no-hardlinks', '--quiet', process.cwd(), root], { windowsHide: true });
  await writeFile(join(root, 'scope-fixture.txt'), 'staged version\n');
  await reviewGit(root, ['add', '--', 'scope-fixture.txt']);
  const indexBefore = (await reviewGit(root, ['write-tree'])).toString();
  await writeFile(join(root, 'scope-fixture.txt'), 'working version\n');
  await writeFile(join(root, 'new-fixture.txt'), 'untracked\n');
  const staged = await loadReviewGitScope(root, 'staged');
  const unstaged = await loadReviewGitScope(root, 'unstaged');
  const workspace = await loadReviewGitScope(root, 'workspace');
  expect(staged.files).toContainEqual({ path: 'scope-fixture.txt', additions: 1, deletions: 0, changeKind: 'added' });
  expect(staged.files.some((file) => file.path === 'new-fixture.txt')).toBe(false);
  expect(unstaged.files).toContainEqual({ path: 'scope-fixture.txt', additions: 1, deletions: 1, changeKind: 'modified' });
  expect(unstaged.files.some((file) => file.path === 'new-fixture.txt')).toBe(true);
  expect(await readReviewVersion(root, staged.comparison.before, 'scope-fixture.txt')).toBeNull();
  expect((await readReviewVersion(root, staged.comparison.after, 'scope-fixture.txt'))?.toString()).toBe('staged version\n');
  expect((await readReviewVersion(root, unstaged.comparison.before, 'scope-fixture.txt'))?.toString()).toBe('staged version\n');
  expect((await readReviewVersion(root, workspace.comparison.after, 'scope-fixture.txt'))?.toString()).toBe('working version\n');
  expect((await reviewGit(root, ['write-tree'])).toString()).toBe(indexBefore);
  const branch = await loadReviewGitScope(root, 'branch', 'HEAD');
  expect(branch.files).toEqual([]);
  expect(branch.commitCount).toBe(0);
  expect(branch.comparison.after).not.toBe('worktree');
}, 30_000);

it('compares an unborn repository against the empty tree without creating a commit or changing the index', async () => {
  root = await mkdtemp(join(tmpdir(), 'dvx-review-unborn-'));
  await reviewGit(root, ['init', '--quiet']);
  expect(await readReviewBranches(root)).toEqual({ refs: [] });
  await writeFile(join(root, 'a.txt'), 'staged\n');
  await reviewGit(root, ['add', '--', 'a.txt']);
  const index = await reviewGit(root, ['write-tree']);
  await writeFile(join(root, 'a.txt'), 'working\n');
  await writeFile(join(root, 'empty.txt'), '');
  const staged = await loadReviewGitScope(root, 'staged');
  const unstaged = await loadReviewGitScope(root, 'unstaged');
  const workspace = await loadReviewGitScope(root, 'workspace');
  expect(await readReviewVersion(root, staged.comparison.before, 'a.txt')).toBeNull();
  expect((await readReviewVersion(root, staged.comparison.after, 'a.txt'))?.toString()).toBe('staged\n');
  expect((await readReviewVersion(root, unstaged.comparison.before, 'a.txt'))?.toString()).toBe('staged\n');
  expect(workspace.files.map(file => file.path)).toEqual(['a.txt', 'empty.txt']);
  expect(await reviewGit(root, ['write-tree'])).toEqual(index);
  await expect(reviewGit(root, ['rev-parse', '--verify', '--quiet', 'HEAD'])).rejects.toBeDefined();
  await expect(loadReviewGitScope(root, 'branch')).rejects.toThrow('first commit');
}, 30_000);

it('offers local refs and uses only an explicit unique remote HEAD default', async () => {
  root = await mkdtemp(join(tmpdir(), 'dvx-review-refs-'));
  // Import a real existing commit without fetching or creating any commit.
  await execute('git', ['clone', '--no-hardlinks', '--quiet', process.cwd(), root], { windowsHide: true });
  const head = (await reviewGit(root, ['rev-parse', 'HEAD'])).toString().trim();
  await reviewGit(root, ['update-ref', 'refs/heads/review-base', head]);
  const branches = await readReviewBranches(root);
  expect(branches.refs).toContain('refs/heads/review-base');
  expect(branches.refs.some(ref => ref.endsWith('/HEAD'))).toBe(false);
  expect(branches.defaultBranch).toMatch(/^refs\/remotes\/origin\//);
  const scope = await loadReviewGitScope(root, 'branch', 'refs/heads/review-base');
  expect(scope.files).toEqual([]);
  expect(scope.comparison.after).toBe(head);
}, 30_000);
