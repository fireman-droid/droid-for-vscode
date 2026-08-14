import { execFile, spawn } from 'node:child_process';
import { open } from 'node:fs/promises';
import { join } from 'node:path';

import { MAX_CHANGED_FILES_PER_TURN } from '../shared/bridgeMessages';
import { toWorkspaceRelativePath } from '../runtime/toolFilePath';

export interface FileChangeStat {
  readonly additions: number | null;
  readonly deletions: number | null;
}

export interface ChangeStatsScope {
  readonly sessionId: string;
  readonly turnId: string;
}

/**
 * Reads per-file added/deleted line counts for workspace-relative
 * paths. Production readers can capture the pre-tool file once per
 * turn so non-git workspaces and files already dirty before the turn
 * still report the change made by this turn.
 */
export interface ChangeStatsReader {
  read(
    paths: readonly string[],
    scope?: ChangeStatsScope,
  ): Promise<ReadonlyMap<string, FileChangeStat>>;
  captureTurnBaseline?(
    scope: ChangeStatsScope,
    paths: readonly string[],
  ): Promise<void>;
  readTurnBaseline?(
    scope: ChangeStatsScope,
    path: string,
  ): Promise<string | undefined>;
  dispose?(): void;
}

export function createUnavailableChangeStatsReader(): ChangeStatsReader {
  return {
    read: () => Promise.resolve(new Map()),
  };
}

const MAX_NUMSTAT_OUTPUT_BYTES = 1024 * 1024;
const GIT_TIMEOUT_MS = 5_000;
const MAX_BASELINE_FILE_BYTES = 4 * 1024 * 1024;
const MAX_BASELINE_BYTES = 16 * 1024 * 1024;
const MAX_BASELINE_TURNS = 4;
const BASELINE_DIFF_CONCURRENCY = 4;

interface ChangeStatsDependencies {
  readonly readWorkspaceFile: (
    path: string,
  ) => Promise<Buffer | undefined>;
  readonly readHeadStats: (
    root: string,
    paths: readonly string[],
  ) => Promise<ReadonlyMap<string, FileChangeStat>>;
  readonly readBaselineStat: (
    path: string,
    baseline: Buffer,
  ) => Promise<FileChangeStat | undefined>;
}

interface TurnBaselines {
  readonly files: Map<string, Buffer>;
  bytes: number;
}

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
    stats.set(
      path.replaceAll('\\', '/'),
      parseNumstatCounts(additions, deletions),
    );
  }
  return stats;
}

/** Reads the count prefix from one `git diff --no-index --numstat`. */
export function parseNoIndexNumstat(
  output: string,
): FileChangeStat | undefined {
  const match = /^(\d+|-)\t(\d+|-)\t/s.exec(output);
  if (match === null) {
    return undefined;
  }
  return parseNumstatCounts(match[1]!, match[2]!);
}

function parseNumstatCounts(
  additions: string,
  deletions: string,
): FileChangeStat {
  return {
    additions: additions === '-' ? null : Number.parseInt(additions, 10),
    deletions: deletions === '-' ? null : Number.parseInt(deletions, 10),
  };
}

/**
 * Captures each tool-named file before the tool executes, then compares
 * the current file with that in-memory baseline. Git HEAD remains the
 * fallback for recovered/history rows that have no live baseline.
 */
export function createGitChangeStatsReader(
  getWorkspaceRoot: () => string | undefined,
  overrides: Partial<ChangeStatsDependencies> = {},
): ChangeStatsReader {
  const dependencies: ChangeStatsDependencies = {
    readWorkspaceFile: readBoundedWorkspaceFile,
    readHeadStats,
    readBaselineStat,
    ...overrides,
  };
  const turns = new Map<string, TurnBaselines>();
  let baselineBytes = 0;

  const evictOldestTurn = (preserveKey?: string): boolean => {
    for (const [key, turn] of turns) {
      if (key === preserveKey) {
        continue;
      }
      turns.delete(key);
      baselineBytes -= turn.bytes;
      return true;
    }
    return false;
  };

  const getFile = (path: string): string | undefined => {
    const root = getWorkspaceRoot();
    if (root === undefined) {
      return undefined;
    }
    const relativePath = toWorkspaceRelativePath(root, path);
    return relativePath === undefined
      ? undefined
      : join(root, relativePath);
  };

  return {
    async captureTurnBaseline(scope, paths) {
      const key = scopeKey(scope);
      let turn = turns.get(key);
      if (turn === undefined) {
        while (turns.size >= MAX_BASELINE_TURNS) {
          if (!evictOldestTurn()) {
            break;
          }
        }
        turn = { files: new Map(), bytes: 0 };
        turns.set(key, turn);
      }
      for (const path of paths.slice(0, MAX_CHANGED_FILES_PER_TURN)) {
        if (turn.files.has(path)) {
          continue;
        }
        if (turn.files.size >= MAX_CHANGED_FILES_PER_TURN) {
          break;
        }
        const absolute = getFile(path);
        if (absolute === undefined) {
          continue;
        }
        try {
          const bytes = await dependencies.readWorkspaceFile(absolute);
          if (bytes === undefined) {
            continue;
          }
          while (
            baselineBytes + bytes.byteLength > MAX_BASELINE_BYTES
          ) {
            if (!evictOldestTurn(key)) {
              break;
            }
          }
          if (
            baselineBytes + bytes.byteLength > MAX_BASELINE_BYTES
          ) {
            continue;
          }
          turn.files.set(path, bytes);
          turn.bytes += bytes.byteLength;
          baselineBytes += bytes.byteLength;
        } catch (error) {
          if (isNotFoundError(error)) {
            // A file absent immediately before Create/ApplyPatch has
            // an empty baseline, so its full text counts as additions.
            turn.files.set(path, Buffer.alloc(0));
          }
        }
      }
    },
    async read(paths, scope) {
      const root = getWorkspaceRoot();
      if (root === undefined || paths.length === 0) {
        return new Map();
      }
      const stats = new Map<string, FileChangeStat>();
      const baselines =
        scope === undefined ? undefined : turns.get(scopeKey(scope));
      const fallback: string[] = [];
      const baselineJobs: Array<{
        path: string;
        absolute: string;
        baseline: Buffer;
      }> = [];
      for (const path of paths) {
        const baseline = baselines?.files.get(path);
        const absolute = getFile(path);
        if (baseline === undefined || absolute === undefined) {
          fallback.push(path);
          continue;
        }
        baselineJobs.push({ path, absolute, baseline });
      }
      for (
        let offset = 0;
        offset < baselineJobs.length;
        offset += BASELINE_DIFF_CONCURRENCY
      ) {
        const batch = baselineJobs.slice(
          offset,
          offset + BASELINE_DIFF_CONCURRENCY,
        );
        const results = await Promise.all(
          batch.map(async ({ path, absolute, baseline }) => ({
            path,
            stat: await dependencies.readBaselineStat(
              absolute,
              baseline,
            ),
          })),
        );
        for (const { path, stat } of results) {
          if (stat !== undefined) {
            stats.set(path, stat);
          }
        }
      }
      if (fallback.length > 0) {
        for (const [path, stat] of await dependencies.readHeadStats(
          root,
          fallback,
        )) {
          stats.set(path, stat);
        }
      }
      return stats;
    },
    async readTurnBaseline(scope, path) {
      const bytes = turns.get(scopeKey(scope))?.files.get(path);
      return bytes === undefined || bytes.includes(0)
        ? undefined
        : bytes.toString('utf8');
    },
    dispose() {
      turns.clear();
      baselineBytes = 0;
    },
  };
}

function scopeKey(scope: ChangeStatsScope): string {
  return `${scope.sessionId}\u0000${scope.turnId}`;
}

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  );
}

async function readBoundedWorkspaceFile(
  path: string,
): Promise<Buffer | undefined> {
  const file = await open(path, 'r');
  try {
    const { size } = await file.stat();
    if (size > MAX_BASELINE_FILE_BYTES) {
      return undefined;
    }
    const bytes = Buffer.allocUnsafe(size);
    let offset = 0;
    while (offset < bytes.byteLength) {
      const read = await file.read(
        bytes,
        offset,
        bytes.byteLength - offset,
        offset,
      );
      if (read.bytesRead === 0) {
        break;
      }
      offset += read.bytesRead;
    }
    const extra = Buffer.allocUnsafe(1);
    const grew = await file.read(extra, 0, 1, offset);
    if (grew.bytesRead > 0) {
      return undefined;
    }
    return offset === bytes.byteLength
      ? bytes
      : Buffer.from(bytes.subarray(0, offset));
  } finally {
    await file.close();
  }
}

function readHeadStats(
  root: string,
  paths: readonly string[],
): Promise<ReadonlyMap<string, FileChangeStat>> {
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
}

function readBaselineStat(
  path: string,
  baseline: Buffer,
): Promise<FileChangeStat | undefined> {
  return new Promise((resolve) => {
    const child = spawn(
      'git',
      [
        '-c',
        'core.autocrlf=false',
        'diff',
        '--no-index',
        '--numstat',
        '--no-renames',
        '--',
        '-',
        path,
      ],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] },
    );
    const chunks: Buffer[] = [];
    let outputBytes = 0;
    let settled = false;
    const finish = (value: FileChangeStat | undefined): void => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        resolve(value);
      }
    };
    const timeout = setTimeout(() => {
      child.kill();
      finish(undefined);
    }, GIT_TIMEOUT_MS);
    child.stdout.on('data', (chunk: Buffer) => {
      outputBytes += chunk.byteLength;
      if (outputBytes > MAX_NUMSTAT_OUTPUT_BYTES) {
        child.kill();
        finish(undefined);
        return;
      }
      chunks.push(chunk);
    });
    child.on('error', () => finish(undefined));
    child.on('close', (code) => {
      if (code !== 0 && code !== 1) {
        finish(undefined);
        return;
      }
      finish(
        code === 0
          ? { additions: 0, deletions: 0 }
          : parseNoIndexNumstat(Buffer.concat(chunks).toString('utf8')),
      );
    });
    child.stdin.on('error', () => finish(undefined));
    child.stdin.end(baseline);
  });
}
