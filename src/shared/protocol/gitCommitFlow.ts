/**
 * Payload types, closed enums, and bounds for the git commit flow. The Bridge
 * message shapes and bounds live here so the host workflow, Bridge
 * unions, both validators, and webview share one narrow contract.
 */

/** Closed set of per-file states the commit panel can display. */
export const GIT_FILE_STATUSES = [
  'modified',
  'added',
  'deleted',
  'renamed',
  'untracked',
  'conflicted',
] as const;

export type GitFileStatus = (typeof GIT_FILE_STATUSES)[number];

/**
 * Why `git.status` carries no file list. The webview hides the commit
 * entry for every reason; no raw error text crosses the Bridge.
 */
export const GIT_UNAVAILABLE_REASONS = [
  /** `vscode.git` extension missing or not activated. */
  'no-git-extension',
  /** The workspace root is not inside a git repository. */
  'no-repository',
  /** Multiple repositories or repository root != workspace root. */
  'unsupported-workspace',
  /** The status read itself failed. */
  'status-failed',
] as const;

export type GitUnavailableReason = (typeof GIT_UNAVAILABLE_REASONS)[number];

/** One row of the commit panel's file list. */
export interface GitStatusFile {
  /** Workspace-relative path with forward slashes. */
  readonly path: string;
  readonly status: GitFileStatus;
  /** True when the change is (also) staged in the index. */
  readonly staged: boolean;
  /**
   * True when the just-finished turn's changes summary lists this
   * file; these rows are checked by default in the commit panel.
   */
  readonly inTurn: boolean;
}

export interface GitRequestStatusMessage {
  readonly type: 'git.requestStatus';
  readonly sessionId: string;
  readonly turnId: string;
}

export interface GitCommitRequestMessage {
  readonly type: 'git.commit';
  readonly sessionId: string;
  readonly turnId: string;
  readonly paths: readonly string[];
  readonly message: string;
}

export interface GitStatusMessage {
  readonly type: 'git.status';
  readonly sequence: number;
  readonly sessionId: string;
  readonly turnId: string;
  readonly branch: string | null;
  readonly files: readonly GitStatusFile[];
  /** Latest Changes turn was committed through Droid. */
  readonly committedHash?: string;
  readonly unavailableReason?: GitUnavailableReason;
}

export type GitCommitResultMessage =
  | {
      readonly type: 'git.commitResult';
      readonly sequence: number;
      readonly sessionId: string;
      readonly turnId: string;
      readonly ok: true;
      readonly hash: string;
      readonly subject: string;
    }
  | {
      readonly type: 'git.commitResult';
      readonly sequence: number;
      readonly sessionId: string;
      readonly turnId: string;
      readonly ok: false;
      readonly error: string;
    };

/** One row of the branch review list. */
export interface GitBranchDiffFile {
  /** Workspace-relative path with forward slashes. */
  readonly path: string;
  readonly additions: number;
  readonly deletions: number;
}

/**
 * Why `git.branchDiff` carries no file list. The webview hides the
 * branch view for every reason; no raw error text crosses the Bridge.
 */
export const GIT_BRANCH_DIFF_UNAVAILABLE_REASONS = [
  /** The session backend exposes no branch diff (process mode). */
  'unsupported-runtime',
  /** The backend answered, but could not read the repository. */
  'read-failed',
] as const;

export type GitBranchDiffUnavailableReason =
  (typeof GIT_BRANCH_DIFF_UNAVAILABLE_REASONS)[number];

export interface GitRequestBranchDiffMessage {
  readonly type: 'git.requestBranchDiff';
  readonly sessionId: string;
}

/**
 * The session branch measured against its base branch: every file the
 * branch changed, committed or not. Scope is the branch, not one turn,
 * so it complements rather than replaces the per-turn Changes ledger.
 */
export interface GitBranchDiffMessage {
  readonly type: 'git.branchDiff';
  readonly sequence: number;
  readonly sessionId: string;
  readonly branch: string | null;
  readonly baseBranch: string | null;
  readonly files: readonly GitBranchDiffFile[];
  /** Totals as the backend reports them, over the uncapped file set. */
  readonly additions: number;
  readonly deletions: number;
  readonly commitCount: number;
  readonly unavailableReason?: GitBranchDiffUnavailableReason;
}

/** The branch report the webview keeps, without its Bridge envelope. */
export type GitBranchDiffState = Omit<
  GitBranchDiffMessage,
  'type' | 'sequence' | 'sessionId'
>;

/** Most files one `git.status` message may list (in-turn files first). */
export const MAX_GIT_STATUS_FILES = 100;

/** Most files one `git.branchDiff` message may list. */
export const MAX_GIT_BRANCH_DIFF_FILES = MAX_GIT_STATUS_FILES;

/** Most paths one `git.commit` request may stage. */
export const MAX_GIT_COMMIT_PATHS = MAX_GIT_STATUS_FILES;

export const MAX_GIT_BRANCH_LENGTH = 250;

export const MAX_GIT_COMMIT_MESSAGE_LENGTH = 5_000;

/** Cap for the echoed first line of a committed message. */
export const MAX_GIT_COMMIT_SUBJECT_LENGTH = 200;

/** Cap for git's own error text echoed in `git.commitResult`. */
export const MAX_GIT_COMMIT_ERROR_LENGTH = 2_000;

/** Short-hash prefix length the UI displays. */
export const GIT_SHORT_HASH_LENGTH = 7;

/**
 * Accepts the echoed commit hash: abbreviated through full git object
 * names, or empty when the host could not read the hash back after a
 * commit that itself succeeded.
 */
export function isGitCommitHashEcho(value: unknown): value is string {
  return typeof value === 'string' && (value === '' || /^[0-9a-f]{4,40}$/.test(value));
}
