import { expect, it } from 'vitest';
import type { GitStatusMessage } from './gitCommitFlow';
import { gitStatusPages, mergeGitStatusPage } from './gitStatusPaging';

it('delivers all files before enabling a commit, including staged files beyond the first page', () => {
  const files = Array.from({ length: 205 }, (_, index) => ({ path: `${index}.txt`, status: 'modified' as const, staged: index === 204, inTurn: false }));
  const pages = gitStatusPages({ files, snapshotId: 'preview-a' });
  let report: ReturnType<typeof mergeGitStatusPage>;
  pages.forEach((page, index) => {
    report = mergeGitStatusPage(report ?? null, { type: 'git.status', sequence: index, sessionId: 'session-a', turnId: 'turn-a', branch: 'main', ...page });
    expect(report?.complete).toBe(index === pages.length - 1);
  });
  expect(report?.files).toEqual(files);
  expect(report?.files.at(-1)?.staged).toBe(true);
});

it('rejects a page from a different preview or a missing preceding page', () => {
  const page: GitStatusMessage = { type: 'git.status', sequence: 1, sessionId: 'a', turnId: 'b', branch: null,
    files: [{ path: 'next.txt', status: 'modified', staged: true, inTurn: false }], snapshotId: 'new', offset: 1, totalFiles: 2 };
  expect(mergeGitStatusPage(null, page)).toBeUndefined();
  expect(mergeGitStatusPage({ files: [{ ...page.files[0]!, path: 'old.txt' }], snapshotId: 'old' }, page)).toBeUndefined();
});
