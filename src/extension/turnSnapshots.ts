import { execFile } from 'node:child_process';
import {
  copyFile as fsCopyFile,
  mkdir as fsMkdir,
  readdir as fsReaddir,
  rm as fsRm,
  stat as fsStat,
  unlink as fsUnlink,
} from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';

import {
  MAX_BRIDGE_ID_LENGTH,
  MAX_CHANGED_FILES_PER_TURN,
} from '../shared/bridgeMessages';
import { isSafeWorkspaceRelativePath } from '../shared/validateMessage';
import type { RuntimeDiagnosticEvent } from '../runtime/runtimeDiagnostics';
import {
  parseGitNumstat,
  type ChangeStatsPersistence,
  type ChangeStatsScope,
  type CommittedFileStat,
  type FileChangeStat,
} from './changeStats';

export const SNAPSHOT_TIMEOUT_MS = 10_000;
export const MAX_SNAPSHOT_SESSIONS = 8;
export const MAX_SNAPSHOT_TURNS_PER_SESSION = 24;
export const MAX_SNAPSHOT_OBJECT_BYTES = 256 * 1024 * 1024;
export const MAX_NUMSTAT_OUTPUT_BYTES = 1024 * 1024;
export const MAX_OPEN_BASELINE_BYTES = 16 * 1024 * 1024;
export const TURN_SNAPSHOTS_STORAGE_KEY = 'droidvisx.turnSnapshots';
export const TURN_SNAPSHOTS_VERSION = 1;

const TREE_OID = /^[0-9a-f]{40}$/;
const GIT_CONFIG_ARGS = [
  '-c',
  'core.autocrlf=false',
  '-c',
  'core.safecrlf=false',
] as const;

export interface TurnSnapshotScope {
  readonly sessionId: string;
  readonly turnId: string;
}

export interface TurnSnapshotRecord {
  readonly turnId: string;
  readonly before?: string;
  readonly after?: string;
  readonly files?: readonly CommittedFileStat[];
}

export interface GitRunResult {
  readonly stdout: Buffer;
  readonly code: number | null;
  readonly timedOut: boolean;
}

export interface TurnSnapshotDependencies {
  readonly runGit: (
    args: readonly string[],
    options: {
      readonly cwd: string;
      readonly env: NodeJS.ProcessEnv;
      readonly timeoutMs: number;
      readonly maxStdoutBytes: number;
    },
  ) => Promise<GitRunResult>;
  readonly copyFile: (source: string, destination: string) => Promise<void>;
  readonly unlink: (path: string) => Promise<void>;
  readonly mkdir: (path: string) => Promise<void>;
  readonly rm: (path: string) => Promise<void>;
  readonly readdir: (path: string) => Promise<readonly string[]>;
  readonly stat: (
    path: string,
  ) => Promise<{ readonly size: number; isDirectory(): boolean }>;
  readonly now: () => number;
  readonly recordDiagnostic: (event: RuntimeDiagnosticEvent) => void;
}

export interface TurnSnapshotStore {
  capture(
    scope: TurnSnapshotScope,
    phase: 'before' | 'after',
  ): Promise<string | undefined>;
  diff(scope: TurnSnapshotScope): Promise<ReadonlyMap<string, FileChangeStat>>;
  readTreeFile(scope: TurnSnapshotScope, path: string): Promise<string | undefined>;
  rememberFiles(
    scope: TurnSnapshotScope,
    files: readonly CommittedFileStat[],
  ): Promise<void>;
  read(sessionId: string, turnId?: string): TurnSnapshotRecord | undefined;
  readTurns(sessionId: string): readonly TurnSnapshotRecord[];
  prune(): Promise<void>;
  dispose(): void;
}

interface GitLayout {
  readonly root: string;
  readonly gitDir: string;
  readonly repoObjectsDir: string;
}

export function createTurnSnapshotStore(
  getWorkspaceRoot: () => string | undefined,
  storageDir: string,
  persistence: ChangeStatsPersistence,
  overrides?: Partial<TurnSnapshotDependencies>,
): TurnSnapshotStore {
  const dependencies: TurnSnapshotDependencies = {
    runGit: runGitCommand,
    copyFile: fsCopyFile,
    unlink: fsUnlink,
    mkdir: (path) => fsMkdir(path, { recursive: true }).then(() => undefined),
    rm: (path) => fsRm(path, { recursive: true, force: true }),
    readdir: fsReaddir,
    stat: fsStat,
    now: () => Date.now(),
    recordDiagnostic: () => undefined,
    ...overrides,
  };
  const objectsDir = join(storageDir, 'objects');
  const sessions = readPersistedSessions(persistence);
  const disabledSessions = new Set<string>();
  let storeDisabled = false;
  let layout: GitLayout | undefined;
  let indexSeq = 0;
  let queue: Promise<void> = Promise.resolve();
  let disposed = false;

  const enqueue = <T,>(work: () => Promise<T>): Promise<T> => {
    const run = queue.then(work, work);
    queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  const persist = async (): Promise<void> => {
    await Promise.resolve(
      persistence.update(TURN_SNAPSHOTS_STORAGE_KEY, serializeSessions(sessions)),
    ).catch(() => undefined);
  };

  const failCapture = (
    scope: TurnSnapshotScope,
    phase: 'before' | 'after',
    reason: string,
  ): undefined => {
    disabledSessions.add(scope.sessionId);
    dependencies.recordDiagnostic({
      level: 'warn',
      name: 'host.changes.snapshot-failed',
      attributes: {
        sessionId: scope.sessionId,
        turnId: scope.turnId,
        phase,
        reason,
      },
    });
    return undefined;
  };

  const remainingMs = (deadline: number): number =>
    Math.max(1, deadline - dependencies.now());

  const git = async (
    cwd: string,
    args: readonly string[],
    env: NodeJS.ProcessEnv,
    deadline: number,
    maxStdoutBytes: number,
  ): Promise<GitRunResult> =>
    dependencies.runGit([...GIT_CONFIG_ARGS, ...args], {
      cwd,
      env,
      timeoutMs: remainingMs(deadline),
      maxStdoutBytes,
    });

  const resolveLayout = async (
    root: string,
    deadline: number,
  ): Promise<GitLayout | undefined> => {
    if (layout?.root === root) {
      return layout;
    }
    const gitDirResult = await git(
      root,
      ['rev-parse', '--absolute-git-dir'],
      process.env,
      deadline,
      4096,
    );
    if (gitDirResult.timedOut || gitDirResult.code !== 0) {
      storeDisabled = true;
      return undefined;
    }
    const gitDir = gitDirResult.stdout.toString('utf8').trim();
    if (gitDir.length === 0) {
      storeDisabled = true;
      return undefined;
    }
    const objectsResult = await git(
      root,
      ['rev-parse', '--git-path', 'objects'],
      process.env,
      deadline,
      4096,
    );
    const objectsPath = objectsResult.stdout.toString('utf8').trim();
    const repoObjectsDir =
      objectsResult.timedOut || objectsResult.code !== 0 || objectsPath.length === 0
        ? join(gitDir, 'objects')
        : isAbsolute(objectsPath)
          ? objectsPath
          : resolve(root, objectsPath);
    layout = { root, gitDir, repoObjectsDir };
    return layout;
  };

  const snapshotEnv = (indexFile: string, repoObjectsDir: string): NodeJS.ProcessEnv => ({
    ...process.env,
    GIT_INDEX_FILE: indexFile,
    GIT_OBJECT_DIRECTORY: objectsDir,
    GIT_ALTERNATE_OBJECT_DIRECTORIES: repoObjectsDir,
  });

  // Tree-to-tree reads need no index; binding one would make git
  // resolve paths against a stale or absent index file.
  const readEnv = (repoObjectsDir: string): NodeJS.ProcessEnv => ({
    ...process.env,
    GIT_OBJECT_DIRECTORY: objectsDir,
    GIT_ALTERNATE_OBJECT_DIRECTORIES: repoObjectsDir,
  });

  const captureNow = async (
    scope: TurnSnapshotScope,
    phase: 'before' | 'after',
  ): Promise<string | undefined> => {
    if (disposed || storeDisabled || disabledSessions.has(scope.sessionId)) {
      return undefined;
    }
    const root = getWorkspaceRoot();
    if (root === undefined) {
      return undefined;
    }
    const deadline = dependencies.now() + SNAPSHOT_TIMEOUT_MS;
    const resolved = await resolveLayout(root, deadline);
    if (resolved === undefined) {
      return failCapture(scope, phase, 'not-a-git-workspace');
    }
    const indexFile = join(storageDir, `index-${++indexSeq}`);
    try {
      await dependencies.mkdir(objectsDir);
      try {
        await dependencies.copyFile(join(resolved.gitDir, 'index'), indexFile);
      } catch (error) {
        if (!isNotFoundError(error)) {
          return failCapture(scope, phase, 'copy-index-failed');
        }
      }
      const env = snapshotEnv(indexFile, resolved.repoObjectsDir);
      const add = await git(root, ['add', '-A'], env, deadline, 4096);
      if (add.timedOut || add.code !== 0) {
        return failCapture(
          scope,
          phase,
          add.timedOut ? 'timeout' : 'add-failed',
        );
      }
      const written = await git(root, ['write-tree'], env, deadline, 4096);
      if (written.timedOut || written.code !== 0) {
        return failCapture(
          scope,
          phase,
          written.timedOut ? 'timeout' : 'write-tree-failed',
        );
      }
      const oid = written.stdout.toString('utf8').trim().toLowerCase();
      if (!TREE_OID.test(oid)) {
        return failCapture(scope, phase, 'invalid-tree-oid');
      }
      upsertTurn(sessions, scope, { [phase]: oid });
      await persist();
      return oid;
    } catch (error) {
      return failCapture(
        scope,
        phase,
        error instanceof Error ? error.message : 'capture-failed',
      );
    } finally {
      await dependencies.unlink(indexFile).catch(() => undefined);
    }
  };

  return {
    capture(scope, phase) {
      return enqueue(() => captureNow(scope, phase));
    },
    async diff(scope) {
      const record = readTurn(sessions, scope.sessionId, scope.turnId);
      // Both trees are required: comparing a tree against the working
      // copy would need a populated index, and an empty one makes git
      // report every tracked file as deleted.
      if (
        record?.before === undefined ||
        record.after === undefined ||
        disposed ||
        storeDisabled
      ) {
        return new Map();
      }
      const root = getWorkspaceRoot();
      if (root === undefined) {
        return new Map();
      }
      const deadline = dependencies.now() + SNAPSHOT_TIMEOUT_MS;
      const resolved = await resolveLayout(root, deadline);
      if (resolved === undefined) {
        return new Map();
      }
      const result = await git(
        root,
        [
          'diff',
          '--numstat',
          '--no-renames',
          '--relative',
          '-z',
          record.before,
          record.after,
        ],
        readEnv(resolved.repoObjectsDir),
        deadline,
        MAX_NUMSTAT_OUTPUT_BYTES,
      );
      if (result.timedOut || (result.code !== 0 && result.code !== 1)) {
        dependencies.recordDiagnostic({
          level: 'warn',
          name: 'host.changes.snapshot-failed',
          attributes: {
            sessionId: scope.sessionId,
            turnId: scope.turnId,
            phase: 'diff',
            reason: result.timedOut ? 'timeout' : 'diff-failed',
          },
        });
        return new Map();
      }
      return parseGitNumstat(result.stdout.toString('utf8'));
    },
    async readTreeFile(scope, path) {
      if (
        !isSafeWorkspaceRelativePath(path) ||
        disposed ||
        storeDisabled
      ) {
        return undefined;
      }
      const record = readTurn(sessions, scope.sessionId, scope.turnId);
      if (record?.before === undefined) {
        return undefined;
      }
      const root = getWorkspaceRoot();
      if (root === undefined) {
        return undefined;
      }
      const deadline = dependencies.now() + SNAPSHOT_TIMEOUT_MS;
      const resolved = await resolveLayout(root, deadline);
      if (resolved === undefined) {
        return undefined;
      }
      const env = readEnv(resolved.repoObjectsDir);
      const result = await git(
        root,
        ['show', `${record.before}:${path}`],
        env,
        deadline,
        MAX_OPEN_BASELINE_BYTES,
      );
      if (result.timedOut) {
        return undefined;
      }
      if (result.code !== 0) {
        // 128 covers both "path absent from the before-tree" (created
        // this turn, so an empty baseline is correct) and "the tree
        // itself is gone", which must not render as an all-new file.
        if (result.code !== 128) {
          return undefined;
        }
        const tree = await git(
          root,
          ['cat-file', '-e', `${record.before}^{tree}`],
          env,
          deadline,
          4096,
        );
        return tree.timedOut || tree.code !== 0 ? undefined : '';
      }
      if (result.stdout.includes(0)) {
        return undefined;
      }
      return result.stdout.toString('utf8');
    },
    rememberFiles(scope, files) {
      return enqueue(async () => {
        if (disposed) {
          return;
        }
        const sanitized = sanitizeFiles(files);
        if (sanitized === undefined) {
          return;
        }
        upsertTurn(sessions, scope, { files: sanitized });
        await persist();
      });
    },
    read(sessionId, turnId) {
      return cloneRecord(readTurn(sessions, sessionId, turnId));
    },
    readTurns(sessionId) {
      return (sessions.get(sessionId) ?? []).map(
        (record) => cloneRecord(record)!,
      );
    },
    prune() {
      return enqueue(async () => {
        if (disposed) {
          return;
        }
        const empty = sessions.size === 0;
        const bytes = empty
          ? 0
          : await directoryBytes(objectsDir, dependencies);
        if (!empty && bytes <= MAX_SNAPSHOT_OBJECT_BYTES) {
          return;
        }
        await dependencies.rm(objectsDir).catch(() => undefined);
        sessions.clear();
        await persist();
      });
    },
    dispose() {
      disposed = true;
      sessions.clear();
      disabledSessions.clear();
      layout = undefined;
    },
  };
}

function readTurn(
  sessions: Map<string, TurnSnapshotRecord[]>,
  sessionId: string,
  turnId?: string,
): TurnSnapshotRecord | undefined {
  const turns = sessions.get(sessionId);
  if (turns === undefined || turns.length === 0) {
    return undefined;
  }
  if (turnId === undefined) {
    return turns[turns.length - 1];
  }
  return turns.find((turn) => turn.turnId === turnId);
}

function upsertTurn(
  sessions: Map<string, TurnSnapshotRecord[]>,
  scope: ChangeStatsScope,
  patch: Partial<Omit<TurnSnapshotRecord, 'turnId'>>,
): void {
  let turns = sessions.get(scope.sessionId);
  if (turns === undefined) {
    while (sessions.size >= MAX_SNAPSHOT_SESSIONS) {
      const oldest = sessions.keys().next().value as string | undefined;
      if (oldest === undefined) {
        break;
      }
      sessions.delete(oldest);
    }
    turns = [];
    sessions.set(scope.sessionId, turns);
  }
  const index = turns.findIndex((turn) => turn.turnId === scope.turnId);
  if (index === -1) {
    turns.push({ turnId: scope.turnId, ...patch });
    if (turns.length > MAX_SNAPSHOT_TURNS_PER_SESSION) {
      turns.splice(0, turns.length - MAX_SNAPSHOT_TURNS_PER_SESSION);
    }
    return;
  }
  turns[index] = { ...turns[index]!, ...patch };
}

function serializeSessions(
  sessions: Map<string, TurnSnapshotRecord[]>,
): {
  readonly version: typeof TURN_SNAPSHOTS_VERSION;
  readonly sessions: ReadonlyArray<{
    readonly sessionId: string;
    readonly turns: readonly TurnSnapshotRecord[];
  }>;
} {
  return {
    version: TURN_SNAPSHOTS_VERSION,
    sessions: [...sessions.entries()].map(([sessionId, turns]) => ({
      sessionId,
      turns,
    })),
  };
}

function readPersistedSessions(
  persistence: ChangeStatsPersistence,
): Map<string, TurnSnapshotRecord[]> {
  const records = new Map<string, TurnSnapshotRecord[]>();
  const value = persistence.get<unknown>(TURN_SNAPSHOTS_STORAGE_KEY);
  if (
    typeof value !== 'object' ||
    value === null ||
    (value as { version?: unknown }).version !== TURN_SNAPSHOTS_VERSION ||
    !Array.isArray((value as { sessions?: unknown }).sessions)
  ) {
    return records;
  }
  for (const entry of (value as { sessions: unknown[] }).sessions.slice(
    -MAX_SNAPSHOT_SESSIONS,
  )) {
    const parsed = parseSessionEntry(entry);
    if (parsed === undefined) {
      continue;
    }
    records.set(parsed.sessionId, parsed.turns);
  }
  return records;
}

function parseSessionEntry(
  entry: unknown,
): { readonly sessionId: string; readonly turns: TurnSnapshotRecord[] } | undefined {
  if (typeof entry !== 'object' || entry === null) {
    return undefined;
  }
  const sessionId = (entry as { sessionId?: unknown }).sessionId;
  const turnsValue = (entry as { turns?: unknown }).turns;
  if (
    !isBridgeId(sessionId) ||
    !Array.isArray(turnsValue) ||
    turnsValue.length > MAX_SNAPSHOT_TURNS_PER_SESSION
  ) {
    return undefined;
  }
  const turns: TurnSnapshotRecord[] = [];
  for (const turn of turnsValue) {
    const parsed = parseTurnEntry(turn);
    if (parsed === undefined) {
      continue;
    }
    turns.push(parsed);
  }
  return turns.length === 0 ? undefined : { sessionId, turns };
}

function parseTurnEntry(entry: unknown): TurnSnapshotRecord | undefined {
  if (typeof entry !== 'object' || entry === null) {
    return undefined;
  }
  const turnId = (entry as { turnId?: unknown }).turnId;
  if (!isBridgeId(turnId)) {
    return undefined;
  }
  const before = optionalOid((entry as { before?: unknown }).before);
  const after = optionalOid((entry as { after?: unknown }).after);
  if (before === 'invalid' || after === 'invalid') {
    return undefined;
  }
  const filesValue = (entry as { files?: unknown }).files;
  if (filesValue === undefined) {
    return {
      turnId,
      ...(before === undefined ? {} : { before }),
      ...(after === undefined ? {} : { after }),
    };
  }
  if (
    !Array.isArray(filesValue) ||
    filesValue.length > MAX_CHANGED_FILES_PER_TURN
  ) {
    return undefined;
  }
  const files = sanitizeFiles(filesValue);
  if (files === undefined || files.length !== filesValue.length) {
    return undefined;
  }
  return {
    turnId,
    ...(before === undefined ? {} : { before }),
    ...(after === undefined ? {} : { after }),
    ...(files.length === 0 ? {} : { files }),
  };
}

function optionalOid(value: unknown): string | undefined | 'invalid' {
  if (value === undefined) {
    return undefined;
  }
  return typeof value === 'string' && TREE_OID.test(value.toLowerCase())
    ? value.toLowerCase()
    : 'invalid';
}

function sanitizeFiles(
  values: readonly unknown[],
): CommittedFileStat[] | undefined {
  if (values.length > MAX_CHANGED_FILES_PER_TURN) {
    return undefined;
  }
  const files: CommittedFileStat[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (typeof value !== 'object' || value === null) {
      return undefined;
    }
    const candidate = value as {
      path?: unknown;
      additions?: unknown;
      deletions?: unknown;
    };
    if (
      !isSafeWorkspaceRelativePath(candidate.path) ||
      seen.has(candidate.path) ||
      !isNullableCount(candidate.additions) ||
      !isNullableCount(candidate.deletions)
    ) {
      return undefined;
    }
    seen.add(candidate.path);
    files.push({
      path: candidate.path,
      additions: candidate.additions,
      deletions: candidate.deletions,
    });
  }
  return files;
}

function isNullableCount(value: unknown): value is number | null {
  return (
    value === null ||
    (Number.isSafeInteger(value) && (value as number) >= 0)
  );
}

function isBridgeId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_BRIDGE_ID_LENGTH
  );
}

function cloneRecord(
  record: TurnSnapshotRecord | undefined,
): TurnSnapshotRecord | undefined {
  if (record === undefined) {
    return undefined;
  }
  return {
    turnId: record.turnId,
    ...(record.before === undefined ? {} : { before: record.before }),
    ...(record.after === undefined ? {} : { after: record.after }),
    ...(record.files === undefined
      ? {}
      : { files: record.files.map((file) => ({ ...file })) }),
  };
}

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  );
}

async function directoryBytes(
  dir: string,
  dependencies: TurnSnapshotDependencies,
): Promise<number> {
  const stack = [dir];
  let total = 0;
  while (stack.length > 0) {
    const current = stack.pop()!;
    let names: readonly string[];
    try {
      names = await dependencies.readdir(current);
    } catch {
      return total;
    }
    for (const name of names) {
      const full = join(current, name);
      try {
        const info = await dependencies.stat(full);
        if (info.isDirectory()) {
          stack.push(full);
        } else {
          total += info.size;
        }
      } catch {
        // Skip entries that disappear mid-walk.
      }
    }
  }
  return total;
}

function runGitCommand(
  args: readonly string[],
  options: {
    readonly cwd: string;
    readonly env: NodeJS.ProcessEnv;
    readonly timeoutMs: number;
    readonly maxStdoutBytes: number;
  },
): Promise<GitRunResult> {
  return new Promise((resolve) => {
    execFile(
      'git',
      [...args],
      {
        cwd: options.cwd,
        env: options.env,
        timeout: options.timeoutMs,
        maxBuffer: options.maxStdoutBytes,
        windowsHide: true,
        encoding: 'buffer',
      },
      (error, stdout) => {
        const timedOut =
          error !== null &&
          typeof error === 'object' &&
          'killed' in error &&
          (error as { killed?: unknown }).killed === true;
        const code =
          error === null
            ? 0
            : typeof (error as { code?: unknown }).code === 'number'
              ? (error as { code: number }).code
              : null;
        resolve({
          stdout: Buffer.isBuffer(stdout) ? stdout : Buffer.alloc(0),
          code: timedOut ? null : code,
          timedOut,
        });
      },
    );
  });
}
