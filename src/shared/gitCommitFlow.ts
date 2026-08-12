/**
 * Payload types, closed enums, and bounds for the git commit flow
 * (slice A of `docs/product/git-pr-workflow-design.md`). The Bridge
 * message shapes themselves live in `bridgeMessages.ts`; this
 * satellite exists so the host workflow module, both validators, and
 * the webview commit panel import the same constants instead of
 * duplicating numbers.
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

export type GitUnavailableReason =
  (typeof GIT_UNAVAILABLE_REASONS)[number];

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

/** Most files one `git.status` message may list (in-turn files first). */
export const MAX_GIT_STATUS_FILES = 100;

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
  return (
    typeof value === 'string' &&
    (value === '' || /^[0-9a-f]{4,40}$/.test(value))
  );
}
