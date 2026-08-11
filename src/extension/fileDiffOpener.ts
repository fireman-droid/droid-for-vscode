export type FileDiffOutcome = 'opened-diff' | 'opened-file' | 'failed';

/**
 * Opens a native comparison (or the plain file) for a validated
 * workspace-relative path. Implementations own absolute-path
 * resolution and containment checks against the real workspace root.
 */
export interface FileDiffOpener {
  openDiff(relativePath: string): Promise<FileDiffOutcome>;
}

export function createUnavailableFileDiffOpener(): FileDiffOpener {
  return {
    openDiff: () => Promise.resolve('failed'),
  };
}
