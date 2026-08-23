// Host->webview validator for `git.branchDiff`, kept beside
// validateHostMessage so that file stays within its line budget.
import {
  GIT_BRANCH_DIFF_UNAVAILABLE_REASONS,
  MAX_BRIDGE_ID_LENGTH,
  MAX_GIT_BRANCH_DIFF_FILES,
  MAX_GIT_BRANCH_LENGTH,
  type GitBranchDiffFile,
  type GitBranchDiffMessage,
  type GitBranchDiffUnavailableReason,
} from '../../shared/bridgeMessages';
import {
  hasExactKeys,
  isExactArray,
  isStrictRecord,
  type UnknownRecord,
} from '../../shared/strictValidation';
import { isSafeWorkspaceRelativePath } from '../../shared/validateMessage';

export function parseGitBranchDiff(
  value: UnknownRecord,
): GitBranchDiffMessage | undefined {
  if (
    !hasExactKeys(
      value,
      ['type', 'sequence', 'sessionId', 'branch', 'baseBranch', 'files',
        'additions', 'deletions', 'commitCount'],
      ['unavailableReason'],
    ) ||
    !isCount(value.sequence) ||
    !isBoundedId(value.sessionId) ||
    !isCount(value.additions) ||
    !isCount(value.deletions) ||
    !isCount(value.commitCount) ||
    !isBranchName(value.branch) ||
    !isBranchName(value.baseBranch)
  ) {
    return undefined;
  }
  const reason = value.unavailableReason;
  if (reason !== undefined && !isUnavailableReason(reason)) {
    return undefined;
  }
  const files = parseFiles(value.files);
  // An unavailable report must not smuggle repository data.
  if (
    files === undefined ||
    (reason !== undefined && (files.length > 0 || value.branch !== null))
  ) {
    return undefined;
  }
  return {
    type: 'git.branchDiff',
    sequence: value.sequence,
    sessionId: value.sessionId,
    branch: value.branch,
    baseBranch: value.baseBranch,
    files,
    additions: value.additions,
    deletions: value.deletions,
    commitCount: value.commitCount,
    ...(reason === undefined ? {} : { unavailableReason: reason }),
  };
}

function parseFiles(value: unknown): GitBranchDiffFile[] | undefined {
  if (!isExactArray(value, 0, MAX_GIT_BRANCH_DIFF_FILES)) {
    return undefined;
  }
  const files: GitBranchDiffFile[] = [];
  for (const entry of value) {
    if (
      !isStrictRecord(entry) ||
      !hasExactKeys(entry, ['path', 'additions', 'deletions']) ||
      !isSafeWorkspaceRelativePath(entry.path) ||
      !isCount(entry.additions) ||
      !isCount(entry.deletions)
    ) {
      return undefined;
    }
    files.push({
      path: entry.path,
      additions: entry.additions,
      deletions: entry.deletions,
    });
  }
  return files;
}

function isCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isBoundedId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_BRIDGE_ID_LENGTH
  );
}

function isBranchName(value: unknown): value is string | null {
  return (
    value === null ||
    (typeof value === 'string' &&
      value.length > 0 &&
      value.length <= MAX_GIT_BRANCH_LENGTH)
  );
}

function isUnavailableReason(
  value: unknown,
): value is GitBranchDiffUnavailableReason {
  return (GIT_BRANCH_DIFF_UNAVAILABLE_REASONS as readonly unknown[]).includes(
    value,
  );
}
