import { execFile } from 'node:child_process';

export interface FileChangeStat {
  readonly additions: number | null;
  readonly deletions: number | null;
}

/**
 * Reads per-file added/deleted line counts against git HEAD for
 * workspace-relative paths. Files without a measurable diff (untracked,
 * binary, or no git) are simply absent from the result.
 */
export interface ChangeStatsReader {
  read(
    paths: readonly string[],
  ): Promise<ReadonlyMap<string, FileChangeStat>>;
}

export function createUnavailableChangeStatsReader(): ChangeStatsReader {
  return {
    read: () => Promise.resolve(new Map()),
  };
}

const MAX_NUMSTAT_OUTPUT_BYTES = 1024 * 1024;
const GIT_TIMEOUT_MS = 5_000;

/**
 * Parses `git diff --numstat -z` output. Each NUL-terminated record is
 * `additions<TAB>deletions<TAB>path`; binary files report `-` counts.
 */
export function parseGitNumstat(
  output: string,
): Map<string, FileChangeStat> {
  const stats = new Map<string, FileChangeStat>();
  for (const record of output.split('\u0000')) {
    const match = /^(\d+|-)\t(\d+|-)\t(.+)$/s.exec(record);
    if (match === null) {
      continue;
    }
    const [, additions, deletions, path] = match;
    if (
      additions === undefined ||
      deletions === undefined ||
      path === undefined
    ) {
      continue;
    }
    stats.set(path.replaceAll('\\', '/'), {
      additions: additions === '-' ? null : Number.parseInt(additions, 10),
      deletions: deletions === '-' ? null : Number.parseInt(deletions, 10),
    });
  }
  return stats;
}

/**
 * Runs `git diff --numstat` for the given workspace-relative paths in
 * the workspace root. Never rejects; any git failure yields an empty
 * result so callers can still report the changed files without counts.
 */
export function createGitChangeStatsReader(
  getWorkspaceRoot: () => string | undefined,
): ChangeStatsReader {
  return {
    read(paths) {
      const root = getWorkspaceRoot();
      if (root === undefined || paths.length === 0) {
        return Promise.resolve(new Map());
      }
      return new Promise((resolve) => {
        execFile(
          'git',
          [
            'diff',
            '--numstat',
            '--no-renames',
            '--relative',
            '-z',
            'HEAD',
            '--',
            ...paths,
          ],
          {
            cwd: root,
            timeout: GIT_TIMEOUT_MS,
            maxBuffer: MAX_NUMSTAT_OUTPUT_BYTES,
            windowsHide: true,
          },
          (error, stdout) => {
            resolve(error === null ? parseGitNumstat(stdout) : new Map());
          },
        );
      });
    },
  };
}
