import type { ChangeStatsScope } from './changeStats';

/** `not-found` marks a path with no file on disk (vs. an open error),
 * so the host can word the failure honestly — e.g. a chip clicked
 * while Droid is still writing the file. */
export type FileDiffOutcome =
  | 'opened-diff'
  | 'opened-file'
  | 'not-found'
  | 'failed';

/**
 * Opens a native comparison (or the plain file) for a validated
 * workspace-relative path. Implementations own absolute-path
 * resolution and containment checks against the real workspace root.
 */
export interface FileDiffOpener {
  openDiff(
    relativePath: string,
    scope: ChangeStatsScope,
    options?: {
      /** Commit produced from the latest turn, retained across Reload. */
      readonly committedRef?: string;
      /** Explicit Git baseline for Workspace/Branch review. */
      readonly baselineRef?: string;
      readonly baselineLabel?: string;
    },
  ): Promise<FileDiffOutcome>;
  dispose?(): void;
}

export function createUnavailableFileDiffOpener(): FileDiffOpener {
  return {
    openDiff: () => Promise.resolve('failed'),
  };
}
