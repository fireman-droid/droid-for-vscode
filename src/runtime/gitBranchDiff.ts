import { MAX_GIT_BRANCH_DIFF_FILES } from '../shared/bridgeMessages';
import type { RuntimeGitDiff, RuntimeGitDiffFile } from './DroidRuntime';
import { toWorkspaceRelativePath } from './toolFilePath';

/** The branch-versus-base report as the SDK git resource returns it. */
export interface SdkGitDiff {
  readonly branch: string;
  readonly baseBranch: string;
  readonly files: ReadonlyArray<{
    path: string;
    additions: number;
    deletions: number;
  }>;
  readonly totalAdditions: number;
  readonly totalDeletions: number;
  readonly commitCount: number;
}

/**
 * Projects an SDK branch diff onto the runtime contract. Totals stay
 * as the backend reported them over the whole branch, so they can
 * exceed the sum of the capped file list.
 */
export function projectGitDiff(
  diff: SdkGitDiff,
  workspaceRoot: string | null,
): RuntimeGitDiff {
  const files: RuntimeGitDiffFile[] = [];
  for (const file of diff.files) {
    if (files.length >= MAX_GIT_BRANCH_DIFF_FILES) {
      break;
    }
    const path =
      workspaceRoot === null
        ? undefined
        : toWorkspaceRelativePath(workspaceRoot, file.path);
    if (path !== undefined) {
      files.push({
        path,
        additions: Math.max(0, Math.round(file.additions)),
        deletions: Math.max(0, Math.round(file.deletions)),
      });
    }
  }
  return {
    branch: diff.branch,
    baseBranch: diff.baseBranch,
    files,
    additions: Math.max(0, Math.round(diff.totalAdditions)),
    deletions: Math.max(0, Math.round(diff.totalDeletions)),
    commitCount: Math.max(0, Math.round(diff.commitCount)),
  };
}
