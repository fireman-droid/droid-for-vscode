import { execFile, spawn } from 'node:child_process';
import { open, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { MAX_BRIDGE_ID_LENGTH } from '../../shared/bridgeMessages';
import { MAX_CHANGED_FILES_PER_TURN } from '../../shared/protocol/bounds';
import { isSafeWorkspaceRelativePath } from '../../shared/validation/guards';
import { toWorkspaceRelativePath } from '../../runtime/tools/toolFilePath';
import type { TurnSnapshotStore } from './turnSnapshots';

export interface FileChangeStat {
  readonly additions: number | null;
  readonly deletions: number | null;
  /** Includes empty-file creation/deletion and other verified metadata changes. */
  readonly changed?: boolean;
}

export function hasFileChange(value: FileChangeStat | undefined): value is FileChangeStat {
  return value !== undefined && (value.changed ?? (value.additions !== 0 || value.deletions !== 0));
}

export type ChangeStatsWatcher = (root: string, onPaths: (paths: readonly string[]) => void) => { dispose(): void };

export interface ChangeStatsScope {
  readonly sessionId: string;
  readonly turnId: string;
}

export interface CommittedTurnRecord {
  readonly turnId: string;
  readonly hash: string;
  readonly paths: readonly string[];
  readonly stats?: readonly CommittedFileStat[];
}

export interface CommittedFileStat extends FileChangeStat {
  readonly path: string;
}

export interface ChangeStatsPersistence {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): PromiseLike<void>;
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
  captureTurnBaseline?(scope: ChangeStatsScope, paths: readonly string[]): Promise<void>;
  readTurnBaseline?(scope: ChangeStatsScope, path: string): Promise<string | undefined>;
  watch?(onPaths: (paths: readonly string[]) => void): { dispose(): void };
  rememberCommittedTurn?(
    scope: ChangeStatsScope,
    hash: string,
    paths: readonly string[],
    stats?: readonly CommittedFileStat[],
  ): Promise<void>;
  readCommittedTurn?(sessionId: string): CommittedTurnRecord | undefined;
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
const COMMITTED_TURNS_STORAGE_KEY = 'droidvisx.committedTurns';
const COMMITTED_TURNS_VERSION = 1;
const MAX_COMMITTED_SESSIONS = 8;

interface ChangeStatsDependencies {
  readonly readWorkspaceFile: (path: string) => Promise<Buffer | undefined>;
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
  readonly absent: Set<string>;
  bytes: number;
}

/**
 * Parses `git diff --numstat -z` output. Each NUL-terminated record is
 * `additions<TAB>deletions<TAB>path`; binary files report `-` counts.
 */
export function parseGitNumstat(output: string): Map<string, FileChangeStat> {
  const stats = new Map<string, FileChangeStat>();
  for (const record of output.split('\u0000')) {
    const match = /^(\d+|-)\t(\d+|-)\t(.+)$/s.exec(record);
    if (match === null) {
      continue;
    }
    const [, additions, deletions, path] = match;
    if (additions === undefined || deletions === undefined || path === undefined) {
      continue;
    }
    stats.set(path.replaceAll('\\', '/'), parseNumstatCounts(additions, deletions));
  }
  return stats;
}

/** Reads the count prefix from one `git diff --no-index --numstat`. */
export function parseNoIndexNumstat(output: string): FileChangeStat | undefined {
  const match = /^(\d+|-)\t(\d+|-)\t/s.exec(output);
  if (match === null) {
    return undefined;
  }
  return parseNumstatCounts(match[1]!, match[2]!);
}

function parseNumstatCounts(additions: string, deletions: string): FileChangeStat {
  return {
    additions: additions === '-' ? null : Number.parseInt(additions, 10),
    deletions: deletions === '-' ? null : Number.parseInt(deletions, 10),
  };
}

/**
 * Uses the before-turn snapshot for each tool-named file when available.
 * A tool-start notification can arrive after the tool has already written,
 * so reading the working file at that point is only a fallback.
 */
export function createGitChangeStatsReader(
  getWorkspaceRoot: () => string | undefined,
  overrides: Partial<ChangeStatsDependencies> = {},
  persistence?: ChangeStatsPersistence,
  snapshots?: Pick<TurnSnapshotStore, 'readTreeFile'> & Partial<Pick<TurnSnapshotStore, 'readTreeBytes'>>,
  watchFiles?: ChangeStatsWatcher,
): ChangeStatsReader {
  const dependencies: ChangeStatsDependencies = {
    readWorkspaceFile: readBoundedWorkspaceFile,
    readHeadStats,
    readBaselineStat,
    ...overrides,
  };
  const turns = new Map<string, TurnBaselines>();
  const committedTurns = readCommittedTurns(persistence);
  let baselineBytes = 0;

  const persistCommittedTurns = async (): Promise<void> => {
    if (persistence === undefined) {
      return;
    }
    await Promise.resolve(
      persistence.update(COMMITTED_TURNS_STORAGE_KEY, {
        version: COMMITTED_TURNS_VERSION,
        sessions: [...committedTurns.entries()].map(([sessionId, record]) => ({
          sessionId,
          ...record,
        })),
      }),
    ).catch(() => undefined);
  };

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
    return relativePath === undefined ? undefined : join(root, relativePath);
  };

  return {
    async captureTurnBaseline(scope, paths) {
      const committed = committedTurns.get(scope.sessionId);
      if (committed !== undefined && committed.turnId !== scope.turnId) {
        committedTurns.delete(scope.sessionId);
        await persistCommittedTurns();
      }
      const key = scopeKey(scope);
      let turn = turns.get(key);
      if (turn === undefined) {
        while (turns.size >= MAX_BASELINE_TURNS) {
          if (!evictOldestTurn()) {
            break;
          }
        }
        turn = { files: new Map(), absent: new Set(), bytes: 0 };
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
          const captured = await snapshots?.readTreeBytes?.(scope, path, 'before');
          const bytes = captured === null ? Buffer.alloc(0)
            : captured ?? await dependencies.readWorkspaceFile(absolute);
          if (bytes === undefined || bytes.byteLength > MAX_BASELINE_FILE_BYTES) {
            continue;
          }
          while (baselineBytes + bytes.byteLength > MAX_BASELINE_BYTES) {
            if (!evictOldestTurn(key)) {
              break;
            }
          }
          if (baselineBytes + bytes.byteLength > MAX_BASELINE_BYTES) {
            continue;
          }
          turn.files.set(path, bytes);
          if (captured === null) turn.absent.add(path);
          turn.bytes += bytes.byteLength;
          baselineBytes += bytes.byteLength;
        } catch (error) {
          if (isNotFoundError(error)) {
            // A file absent immediately before Create/ApplyPatch has
            // an empty baseline, so its full text counts as additions.
            turn.files.set(path, Buffer.alloc(0));
            turn.absent.add(path);
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
      const baselines = scope === undefined ? undefined : turns.get(scopeKey(scope));
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
        const batch = baselineJobs.slice(offset, offset + BASELINE_DIFF_CONCURRENCY);
        const results = await Promise.all(
          batch.map(async ({ path, absolute, baseline }) => {
            const value = await dependencies.readBaselineStat(absolute, baseline);
            if (value === undefined) return { path, stat: undefined };
            const exists = await stat(absolute).then((file) => file.isFile(), (error: unknown) => {
              if (isNotFoundError(error)) return false;
              return undefined;
            });
            if (exists === undefined) return { path, stat: undefined };
            return { path, stat: { ...value, changed: hasFileChange(value) || exists === baselines!.absent.has(path) } };
          }),
        );
        for (const { path, stat } of results) {
          if (stat !== undefined) {
            stats.set(path, stat);
          }
        }
      }
      // HEAD includes changes made before this turn and is not a turn baseline.
      if (scope === undefined && fallback.length > 0) {
        for (const [path, stat] of await dependencies.readHeadStats(root, fallback)) {
          stats.set(path, stat);
        }
      }
      return stats;
    },
    ...(watchFiles ? { watch: (onPaths: (paths: readonly string[]) => void) => {
      const root = getWorkspaceRoot();
      return root === undefined ? { dispose() {} } : watchFiles(root, onPaths);
    } } : {}),
    async readTurnBaseline(scope, path) {
      const bytes = turns.get(scopeKey(scope))?.files.get(path);
      if (bytes !== undefined) {
        return bytes.length > 0 && bytes.includes(0) ? undefined : bytes.toString('utf8');
      }
      return snapshots?.readTreeFile(scope, path);
    },
    async rememberCommittedTurn(scope, hash, paths, stats) {
      if (!/^[0-9a-f]{4,40}$/.test(hash) || paths.length === 0) {
        return;
      }
      const committedPaths = [...new Set(paths)]
        .filter(isSafeWorkspaceRelativePath)
        .slice(0, MAX_CHANGED_FILES_PER_TURN);
      if (committedPaths.length === 0) {
        return;
      }
      const pathSet = new Set(committedPaths);
      committedTurns.delete(scope.sessionId);
      committedTurns.set(scope.sessionId, {
        turnId: scope.turnId,
        hash,
        paths: committedPaths,
        ...(stats === undefined ? {} : { stats: sanitizeCommittedStats(stats, pathSet) }),
      });
      while (committedTurns.size > MAX_COMMITTED_SESSIONS) {
        const oldest = committedTurns.keys().next().value as string | undefined;
        if (oldest === undefined) {
          break;
        }
        committedTurns.delete(oldest);
      }
      await persistCommittedTurns();
    },
    readCommittedTurn(sessionId) {
      const record = committedTurns.get(sessionId);
      return record === undefined
        ? undefined
        : {
            ...record,
            paths: [...record.paths],
            ...(record.stats === undefined
              ? {}
              : { stats: record.stats.map((stat) => ({ ...stat })) }),
          };
    },
    dispose() {
      turns.clear();
      committedTurns.clear();
      baselineBytes = 0;
    },
  };
}

function readCommittedTurns(
  persistence: ChangeStatsPersistence | undefined,
): Map<string, CommittedTurnRecord> {
  const records = new Map<string, CommittedTurnRecord>();
  const value = persistence?.get<unknown>(COMMITTED_TURNS_STORAGE_KEY);
  if (
    typeof value !== 'object' ||
    value === null ||
    (value as { version?: unknown }).version !== COMMITTED_TURNS_VERSION ||
    !Array.isArray((value as { sessions?: unknown }).sessions)
  ) {
    return records;
  }
  for (const entry of (value as { sessions: unknown[] }).sessions.slice(
    -MAX_COMMITTED_SESSIONS,
  )) {
    if (
      typeof entry !== 'object' ||
      entry === null ||
      typeof (entry as { sessionId?: unknown }).sessionId !== 'string' ||
      (entry as { sessionId: string }).sessionId.length === 0 ||
      (entry as { sessionId: string }).sessionId.length > MAX_BRIDGE_ID_LENGTH ||
      typeof (entry as { turnId?: unknown }).turnId !== 'string' ||
      (entry as { turnId: string }).turnId.length === 0 ||
      (entry as { turnId: string }).turnId.length > MAX_BRIDGE_ID_LENGTH ||
      typeof (entry as { hash?: unknown }).hash !== 'string' ||
      !/^[0-9a-f]{4,40}$/.test((entry as { hash: string }).hash) ||
      !Array.isArray((entry as { paths?: unknown }).paths) ||
      (entry as { paths: unknown[] }).paths.length === 0 ||
      (entry as { paths: unknown[] }).paths.length > MAX_CHANGED_FILES_PER_TURN ||
      !(entry as { paths: unknown[] }).paths.every((path) =>
        isSafeWorkspaceRelativePath(path),
      )
    ) {
      continue;
    }
    const paths = [...new Set((entry as { paths: string[] }).paths)].slice(
      0,
      MAX_CHANGED_FILES_PER_TURN,
    );
    const rawStats = (entry as { stats?: unknown }).stats;
    if (
      rawStats !== undefined &&
      (!Array.isArray(rawStats) || rawStats.length > MAX_CHANGED_FILES_PER_TURN)
    ) {
      continue;
    }
    const stats =
      rawStats === undefined
        ? undefined
        : sanitizeCommittedStats(rawStats, new Set(paths));
    if (rawStats !== undefined && stats?.length !== rawStats.length) {
      continue;
    }
    records.set((entry as { sessionId: string }).sessionId, {
      turnId: (entry as { turnId: string }).turnId,
      hash: (entry as { hash: string }).hash,
      paths,
      ...(stats === undefined ? {} : { stats }),
    });
  }
  return records;
}

function sanitizeCommittedStats(
  values: readonly unknown[],
  paths: ReadonlySet<string>,
): CommittedFileStat[] {
  const stats: CommittedFileStat[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (
      typeof value !== 'object' ||
      value === null ||
      typeof (value as { path?: unknown }).path !== 'string'
    ) {
      continue;
    }
    const candidate = value as {
      path: string;
      additions?: unknown;
      deletions?: unknown;
    };
    if (
      !paths.has(candidate.path) ||
      seen.has(candidate.path) ||
      !isNullableCount(candidate.additions) ||
      !isNullableCount(candidate.deletions)
    ) {
      continue;
    }
    seen.add(candidate.path);
    stats.push({
      path: candidate.path,
      additions: candidate.additions,
      deletions: candidate.deletions,
    });
  }
  return stats;
}

function isNullableCount(value: unknown): value is number | null {
  return value === null || (Number.isSafeInteger(value) && (value as number) >= 0);
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

async function readBoundedWorkspaceFile(path: string): Promise<Buffer | undefined> {
  const file = await open(path, 'r');
  try {
    const { size } = await file.stat();
    if (size > MAX_BASELINE_FILE_BYTES) {
      return undefined;
    }
    const bytes = Buffer.allocUnsafe(size);
    let offset = 0;
    while (offset < bytes.byteLength) {
      const read = await file.read(bytes, offset, bytes.byteLength - offset, offset);
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
    return offset === bytes.byteLength ? bytes : Buffer.from(bytes.subarray(0, offset));
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
      ['diff', '--numstat', '--no-renames', '--relative', '-z', 'HEAD', '--', ...paths],
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

async function readBaselineStat(
  path: string,
  baseline: Buffer,
): Promise<FileChangeStat | undefined> {
  try {
    await stat(path);
  } catch (error) {
    if (!isNotFoundError(error)) return undefined;
    if (baseline.length === 0) return { additions: 0, deletions: 0 };
    path = process.platform === 'win32' ? 'NUL' : '/dev/null';
  }
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
