import { describe, expect, it } from 'vitest';

import { MAX_GIT_BRANCH_DIFF_FILES } from '../../shared/bridgeMessages';
import { parseGitBranchDiff } from './parseGitBranchDiff';

function message(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'git.branchDiff',
    sequence: 7,
    sessionId: 'session-a',
    branch: 'feature/dock',
    baseBranch: 'main',
    files: [{ path: 'src/app.tsx', additions: 4, deletions: 2 }],
    additions: 4,
    deletions: 2,
    commitCount: 3,
    ...overrides,
  };
}

describe('parseGitBranchDiff', () => {
  it('accepts a complete report', () => {
    expect(parseGitBranchDiff(message())).toEqual({
      type: 'git.branchDiff',
      sequence: 7,
      sessionId: 'session-a',
      branch: 'feature/dock',
      baseBranch: 'main',
      files: [{ path: 'src/app.tsx', additions: 4, deletions: 2 }],
      additions: 4,
      deletions: 2,
      commitCount: 3,
    });
  });

  it('accepts an unavailable report that carries no repository data', () => {
    const parsed = parseGitBranchDiff(
      message({
        branch: null,
        baseBranch: null,
        files: [],
        additions: 0,
        deletions: 0,
        commitCount: 0,
        unavailableReason: 'unsupported-runtime',
      }),
    );

    expect(parsed?.unavailableReason).toBe('unsupported-runtime');
    expect(parsed?.files).toEqual([]);
  });

  it('rejects an unavailable report that still names a branch or files', () => {
    expect(
      parseGitBranchDiff(
        message({ files: [], unavailableReason: 'read-failed' }),
      ),
    ).toBeUndefined();
    expect(
      parseGitBranchDiff(
        message({ branch: null, baseBranch: null, unavailableReason: 'read-failed' }),
      ),
    ).toBeUndefined();
  });

  it('rejects unknown reasons, extra keys, and missing keys', () => {
    expect(
      parseGitBranchDiff(message({ branch: null, baseBranch: null, files: [],
        unavailableReason: 'nope' })),
    ).toBeUndefined();
    expect(parseGitBranchDiff(message({ extra: 1 }))).toBeUndefined();
    const { commitCount: _dropped, ...withoutCount } = message();
    expect(parseGitBranchDiff(withoutCount)).toBeUndefined();
  });

  it('rejects unsafe paths, negative counts, and oversized file lists', () => {
    expect(
      parseGitBranchDiff(
        message({ files: [{ path: '../escape.ts', additions: 1, deletions: 0 }] }),
      ),
    ).toBeUndefined();
    expect(
      parseGitBranchDiff(
        message({ files: [{ path: 'src/app.tsx', additions: -1, deletions: 0 }] }),
      ),
    ).toBeUndefined();
    expect(parseGitBranchDiff(message({ additions: 1.5 }))).toBeUndefined();
    expect(
      parseGitBranchDiff(
        message({
          files: Array.from(
            { length: MAX_GIT_BRANCH_DIFF_FILES + 1 },
            (_unused, index) => ({
              path: `src/file-${index}.ts`,
              additions: 0,
              deletions: 0,
            }),
          ),
        }),
      ),
    ).toBeUndefined();
  });

  it('rejects an empty branch name and an empty session id', () => {
    expect(parseGitBranchDiff(message({ branch: '' }))).toBeUndefined();
    expect(parseGitBranchDiff(message({ sessionId: '' }))).toBeUndefined();
  });
});
