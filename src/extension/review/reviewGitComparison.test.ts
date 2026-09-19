import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it } from 'vitest';
import { loadReviewGitScope, readReviewVersion, reviewGit } from './reviewGitComparison';

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
