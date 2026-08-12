export type OpenPathOutcome = 'opened' | 'revealed' | 'failed';

/**
 * Opens a path the user clicked in transcript markdown: text files in
 * an editor (optionally at a line and column), non-text files through
 * the platform handler, and directories by revealing them in the OS
 * file manager. Implementations own absolute-path resolution against
 * the workspace root and existence checks; paths outside the
 * workspace are allowed because only explicit clicks reach here.
 */
export interface PathOpener {
  openPath(
    path: string,
    line?: number,
    column?: number,
  ): Promise<OpenPathOutcome>;
}

export function createUnavailablePathOpener(): PathOpener {
  return {
    openPath: () => Promise.resolve('failed'),
  };
}
