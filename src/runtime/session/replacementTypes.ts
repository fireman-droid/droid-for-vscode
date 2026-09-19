export interface FactoryDroidSessionRewindParams {
  readonly messageId: string;
  readonly filesToRestore: Array<{
    filePath: string;
    contentHash: string;
    size: number;
  }>;
  readonly filesToDelete: Array<{ filePath: string }>;
  readonly forkTitle: string;
}

export interface FactoryDroidSessionRewindInfo {
  readonly availableFiles: Array<{
    filePath: string;
    contentHash: string;
    size: number;
  }>;
  readonly createdFiles: Array<{ filePath: string }>;
  readonly evictedFiles: Array<{ filePath: string; reason: string }>;
}

export interface FactoryDroidSessionGitDiffSection {
  readonly files: ReadonlyArray<{
    path: string;
    additions: number;
    deletions: number;
    status: string;
  }>;
  readonly patch: string;
}

/** The daemon's overall report, with separately scoped Review data on demand. */
export interface FactoryDroidSessionGitDiff {
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
  readonly comparisons?: {
    readonly branch: FactoryDroidSessionGitDiffSection;
    readonly workspace: FactoryDroidSessionGitDiffSection;
  };
}
