import { describe, expect, it } from 'vitest';

import { MAX_GIT_BRANCH_DIFF_FILES } from '../../shared/bridgeMessages';
import { projectGitDiff, type SdkGitDiff } from './gitBranchDiff';

const root = process.platform === 'win32' ? 'D:\\repo' : '/repo';

function diff(overrides: Partial<SdkGitDiff> = {}): SdkGitDiff {
  return {
    branch: 'feature/dock',
    baseBranch: 'main',
    files: [],
    totalAdditions: 0,
    totalDeletions: 0,
    commitCount: 0,
    ...overrides,
  };
}

describe('projectGitDiff', () => {
  it('relativizes workspace files and drops the ones outside it', () => {
    const projected = projectGitDiff(
      diff({
        files: [
          {
            path: `${root}${root.includes('\\') ? '\\' : '/'}src/app.tsx`,
            additions: 4,
            deletions: 2,
          },
          { path: 'docs/readme.md', additions: 1, deletions: 0 },
          {
            path: process.platform === 'win32' ? 'D:\\other\\x.ts' : '/other/x.ts',
            additions: 9,
            deletions: 9,
          },
        ],
      }),
      root,
    );

    expect(projected.files).toEqual([
      { path: 'src/app.tsx', additions: 4, deletions: 2 },
      { path: 'docs/readme.md', additions: 1, deletions: 0 },
    ]);
    expect(projected.branch).toBe('feature/dock');
    expect(projected.baseBranch).toBe('main');
  });

  it('reports no files when the runtime has no workspace root', () => {
    const projected = projectGitDiff(
      diff({ files: [{ path: 'src/app.tsx', additions: 1, deletions: 1 }] }),
      null,
    );

    expect(projected.files).toEqual([]);
  });

  it('caps the file list while totals stay branch-wide', () => {
    const files = Array.from(
      { length: MAX_GIT_BRANCH_DIFF_FILES + 5 },
      (_unused, index) => ({
        path: `src/file-${index}.ts`,
        additions: 1,
        deletions: 1,
      }),
    );

    const projected = projectGitDiff(
      diff({ files, totalAdditions: files.length, totalDeletions: files.length }),
      root,
    );

    expect(projected.files).toHaveLength(MAX_GIT_BRANCH_DIFF_FILES);
    expect(projected.additions).toBe(files.length);
    expect(projected.deletions).toBe(files.length);
  });

  it('rounds and floors the counts the backend reports', () => {
    const projected = projectGitDiff(
      diff({
        files: [{ path: 'src/app.tsx', additions: 2.4, deletions: -3 }],
        totalAdditions: 7.6,
        totalDeletions: -1,
        commitCount: 2.2,
      }),
      root,
    );

    expect(projected.files[0]).toEqual({
      path: 'src/app.tsx',
      additions: 2,
      deletions: 0,
    });
    expect(projected.additions).toBe(8);
    expect(projected.deletions).toBe(0);
    expect(projected.commitCount).toBe(2);
  });
});
