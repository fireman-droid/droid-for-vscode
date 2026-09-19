import { execFile } from 'node:child_process';
import {
  copyFile as fsCopyFile,
  mkdir as fsMkdir,
  readdir as fsReaddir,
  rm as fsRm,
  stat as fsStat,
  unlink as fsUnlink,
} from 'node:fs/promises';
import { delimiter, isAbsolute, join, resolve } from 'node:path';
import { MAX_CHANGED_FILES_PER_TURN } from '../../shared/protocol/bounds';
import { isSafeWorkspaceRelativePath } from '../../shared/validation/guards';
import type { RuntimeDiagnosticEvent } from '../../runtime/runtimeDiagnostics';
import { toWorkspaceRelativePath } from '../../runtime/tools/toolFilePath';
import {
  parseGitNumstat,
  type ChangeStatsPersistence,
  type FileChangeStat,
} from './changeStats';
import {
  cloneRecord,
  cloneSessions,
  readPersistedSessions,
  readTurn,
  serializeSessions,
  type TurnSnapshotRecord,
  upsertTurn,
} from './turnSnapshotRecords';
import { snapshotWorkspaceFiles } from './snapshotWorkspaceFiles';
export {
  MAX_SNAPSHOT_SESSIONS,
  MAX_SNAPSHOT_TURNS_PER_SESSION,
  TURN_SNAPSHOTS_VERSION,
  type TurnSnapshotRecord,
} from './turnSnapshotRecords';

export const SNAPSHOT_TIMEOUT_MS = 10_000;
export const MAX_SNAPSHOT_OBJECT_BYTES = 256 * 1024 * 1024;
export const MAX_NUMSTAT_OUTPUT_BYTES = 1024 * 1024;
export const MAX_OPEN_BASELINE_BYTES = 16 * 1024 * 1024;
export const TURN_SNAPSHOTS_STORAGE_KEY = 'droidvisx.turnSnapshots';
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
      readonly input?: Buffer;
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
  capturePaths(scope: TurnSnapshotScope, paths: readonly string[]): Promise<void>;
  diff(scope: TurnSnapshotScope): Promise<ReadonlyMap<string, FileChangeStat>>;
  readTreeFile(scope: TurnSnapshotScope, path: string): Promise<string | undefined>;
  /**
   * Reads exact bounded bytes from one captured tree. `null` means the
   * path was absent from that valid tree; `undefined` means unavailable.
   */
  readTreeBytes(
    scope: TurnSnapshotScope,
    path: string,
    phase: 'before' | 'after',
  ): Promise<Buffer | null | undefined>;
  read(sessionId: string, turnId?: string): TurnSnapshotRecord | undefined;
  readTurns(sessionId: string): readonly TurnSnapshotRecord[];
  prune(): Promise<void>;
  dispose(): Promise<void>;
}

interface GitLayout {
  readonly root: string;
  readonly gitDir: string;
  readonly repoObjectsDir: string;
  readonly privateRepository?: boolean;
}

export function createTurnSnapshotStore(
  getWorkspaceRoot: () => string | undefined,
  storageDir: string,
  persistence: ChangeStatsPersistence,
  overrides?: Partial<TurnSnapshotDependencies>,
  legacyStorageDir?: string,
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
  let sessions = readPersistedSessions(persistence);
  let pendingSessions: Map<string, TurnSnapshotRecord[]> | undefined;
  const disabledSessions = new Set<string>();
  let storeDisabled = false;
  let layout: GitLayout | undefined;
  let indexSeq = 0;
  let queue: Promise<void> = Promise.resolve();
  let persistenceFailure: unknown | undefined;
  let persistenceFailed = false;
  let disposeOutcome: Promise<void> | undefined;
  let closing = false;
  let disposed = false;

  const enqueue = <T>(work: () => Promise<T>): Promise<T> => {
    const run = queue.then(work, work);
    queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  const persist = async (
    nextSessions: Map<string, TurnSnapshotRecord[]>,
  ): Promise<void> => {
    try {
      await Promise.resolve().then(() =>
        persistence.update(TURN_SNAPSHOTS_STORAGE_KEY, serializeSessions(nextSessions)),
      );
    } catch (error) {
      pendingSessions = nextSessions;
      persistenceFailure = error;
      persistenceFailed = true;
      throw error;
    }
    sessions = nextSessions;
    pendingSessions = undefined;
    persistenceFailure = undefined;
    persistenceFailed = false;
  };

  const flushPending = async (): Promise<void> => {
    const pending = pendingSessions;
    if (pending !== undefined) {
      await persist(pending);
    }
  };

  const persistPatch = async (
    scope: TurnSnapshotScope,
    patch: Partial<Omit<TurnSnapshotRecord, 'turnId'>>,
  ): Promise<void> => {
    await flushPending();
    const nextSessions = cloneSessions(sessions);
    upsertTurn(nextSessions, scope, patch);
    await persist(nextSessions);
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
    input?: Buffer,
  ): Promise<GitRunResult> =>
    dependencies.runGit([...GIT_CONFIG_ARGS, ...args], {
      cwd,
      env,
      timeoutMs: remainingMs(deadline),
      maxStdoutBytes,
      ...(input === undefined ? {} : { input }),
    });

  const addSnapshotPaths = async (
    root: string,
    paths: readonly string[],
    env: NodeJS.ProcessEnv,
    deadline: number,
  ): Promise<'ok' | 'timeout' | 'failed'> => {
    for (const path of paths) {
      const added = await git(root, ['add', '-f', '-A', '--', path], env, deadline, 4096);
      if (added.timedOut) return 'timeout';
      if (added.code !== 0 && added.code !== 128) return 'failed';
    }
    return 'ok';
  };
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
    if (gitDirResult.timedOut || gitDirResult.code === null) return undefined;
    if (gitDirResult.code !== 0) {
      const gitDir = join(storageDir, 'repository.git');
      await dependencies.mkdir(storageDir);
      const initialized = await git(root, ['init', '--bare', '--quiet', '--template=', gitDir], process.env, deadline, 4096);
      if (initialized.code !== 0 || initialized.timedOut) return undefined;
      layout = { root, gitDir, repoObjectsDir: join(gitDir, 'objects'), privateRepository: true };
      return layout;
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
    GIT_ALTERNATE_OBJECT_DIRECTORIES: [repoObjectsDir, ...(legacyStorageDir ? [join(legacyStorageDir, 'objects')] : [])].join(delimiter),
    ...(layout?.privateRepository ? { GIT_DIR: layout.gitDir, GIT_WORK_TREE: layout.root } : {}),
  });

  // Tree-to-tree reads need no index; binding one would make git
  // resolve paths against a stale or absent index file.
  const readEnv = (repoObjectsDir: string): NodeJS.ProcessEnv => ({
    ...process.env,
    GIT_OBJECT_DIRECTORY: objectsDir,
    GIT_ALTERNATE_OBJECT_DIRECTORIES: [repoObjectsDir, ...(legacyStorageDir ? [join(legacyStorageDir, 'objects')] : [])].join(delimiter),
    ...(layout?.privateRepository ? { GIT_DIR: layout.gitDir, GIT_WORK_TREE: layout.root } : {}),
  });

  const captureNow = async (
    scope: TurnSnapshotScope,
    phase: 'before' | 'after',
  ): Promise<string | undefined> => {
    const started = dependencies.now();
    if (disposed || storeDisabled || disabledSessions.has(scope.sessionId)) {
      dependencies.recordDiagnostic({ level: 'warn', name: 'host.changes.snapshot.skipped',
        attributes: { ...scope, phase, reason: disposed ? 'disposed' : storeDisabled ? 'store-disabled' : 'session-disabled' } });
      return undefined;
    }
    await flushPending();
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
      let add: GitRunResult;
      if (resolved.privateRepository) {
        const paths = await snapshotWorkspaceFiles(root);
        const input = Buffer.from(paths.length ? `${paths.join('\0')}\0` : '');
        const ignored = await git(root, ['check-ignore', '--no-index', '-z', '--stdin'], env, deadline, MAX_NUMSTAT_OUTPUT_BYTES, input);
        if (ignored.timedOut || (ignored.code !== 0 && ignored.code !== 1))
          return failCapture(scope, phase, 'ignore-check-failed');
        const excluded = new Set(ignored.stdout.toString('utf8').split('\0'));
        const included = paths.filter((path) => !excluded.has(path));
        add = await git(root, ['update-index', '--add', '--remove', '-z', '--stdin'], env, deadline, 4096,
          Buffer.from(included.length ? `${included.join('\0')}\0` : ''));
      } else add = await git(root, ['add', '-A'], env, deadline, 4096);
      if (add.timedOut || add.code !== 0) {
        return failCapture(scope, phase, add.timedOut ? 'timeout' : 'add-failed');
      }
      if (!resolved.privateRepository) {
        // Copied index stat entries can reuse LF blobs from core.autocrlf=true
        // even though this capture uses false. Re-read tracked worktree bytes.
        const refreshed = await git(root, ['add', '--renormalize', '--', '.'], env, deadline, 4096);
        if (refreshed.timedOut || refreshed.code !== 0)
          return failCapture(scope, phase, refreshed.timedOut ? 'timeout' : 'renormalize-failed');
      }
      const snapshotPaths =
        phase === 'after'
          ? readTurn(pendingSessions ?? sessions, scope.sessionId, scope.turnId)
              ?.snapshotPaths
          : undefined;
      if (snapshotPaths !== undefined && snapshotPaths.length > 0) {
        const added = await addSnapshotPaths(root, snapshotPaths, env, deadline);
        if (added !== 'ok')
          return failCapture(
            scope,
            phase,
            added === 'timeout' ? 'timeout' : 'add-paths-failed',
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
      const previousTree = readTurn(sessions, scope.sessionId, scope.turnId)?.[phase];
      await persistPatch(scope, { [phase]: oid });
      dependencies.recordDiagnostic({ level: 'info', name: 'host.changes.snapshot.capture',
        attributes: { ...scope, phase, tree: oid, previousTree: previousTree ?? null,
          captureMode: resolved.privateRepository ? 'private-file-enumeration' : 'copied-index-renormalized',
          snapshotPathCount: snapshotPaths?.length ?? 0, elapsedMs: dependencies.now() - started } });
      return oid;
    } catch (error) {
      if (persistenceFailed) {
        throw error;
      }
      return failCapture(
        scope,
        phase,
        error instanceof Error ? error.message : 'capture-failed',
      );
    } finally {
      await dependencies.unlink(indexFile).catch(() => undefined);
    }
  };

  const capturePathsNow = async (
    scope: TurnSnapshotScope,
    paths: readonly string[],
  ): Promise<void> => {
    if (disposed || storeDisabled || disabledSessions.has(scope.sessionId)) return;
    const record = readTurn(sessions, scope.sessionId, scope.turnId);
    if (record?.before === undefined) return;
    const root = getWorkspaceRoot();
    if (root === undefined) return;
    const captured = new Set(record.snapshotPaths ?? []);
    let additions = [...new Set(paths)]
      .flatMap((path) => toWorkspaceRelativePath(root, path) ?? [])
      .filter((path) => !captured.has(path))
      .slice(0, Math.max(0, MAX_CHANGED_FILES_PER_TURN - captured.size));
    if (additions.length === 0) return;
    let indexFile: string | undefined;
    try {
      await flushPending();
      const persistedRecord = readTurn(sessions, scope.sessionId, scope.turnId);
      if (persistedRecord?.before === undefined) {
        return;
      }
      const deadline = dependencies.now() + SNAPSHOT_TIMEOUT_MS;
      const resolved = await resolveLayout(root, deadline);
      if (resolved === undefined) {
        return failCapture(scope, 'before', 'not-a-git-workspace');
      }
      const ignored = await git(root, ['check-ignore', '--no-index', '-z', '--stdin'],
        readEnv(resolved.repoObjectsDir), deadline, MAX_NUMSTAT_OUTPUT_BYTES, Buffer.from(`${additions.join('\0')}\0`));
      if (ignored.timedOut || (ignored.code !== 0 && ignored.code !== 1))
        return void failCapture(scope, 'before', 'ignore-check-failed');
      const ignoredPaths = new Set(ignored.stdout.toString('utf8').split('\0'));
      // The initial tree already proves presence/absence of non-ignored files.
      // A later tool must not replace that baseline with changes from Execute.
      additions = additions.filter((path) => ignoredPaths.has(path));
      if (!additions.length) return;
      indexFile = join(storageDir, `index-${++indexSeq}`);
      await dependencies.mkdir(objectsDir);
      const env = snapshotEnv(indexFile, resolved.repoObjectsDir);
      const loaded = await git(
        root,
        ['read-tree', persistedRecord.before],
        env,
        deadline,
        4096,
      );
      if (loaded.timedOut || loaded.code !== 0)
        return void failCapture(
          scope,
          'before',
          loaded.timedOut ? 'timeout' : 'read-tree-failed',
        );
      const added = await addSnapshotPaths(root, additions, env, deadline);
      if (added !== 'ok')
        return void failCapture(
          scope,
          'before',
          added === 'timeout' ? 'timeout' : 'add-paths-failed',
        );
      const written = await git(root, ['write-tree'], env, deadline, 4096);
      if (written.timedOut || written.code !== 0)
        return void failCapture(
          scope,
          'before',
          written.timedOut ? 'timeout' : 'write-tree-failed',
        );
      const oid = written.stdout.toString('utf8').trim().toLowerCase();
      if (!TREE_OID.test(oid))
        return void failCapture(scope, 'before', 'invalid-tree-oid');
      await persistPatch(scope, {
        before: oid,
        snapshotPaths: [...captured, ...additions],
      });
      dependencies.recordDiagnostic({ level: 'info', name: 'host.changes.snapshot.paths',
        attributes: { ...scope, previousTree: persistedRecord.before, tree: oid,
          requestedCount: paths.length, addedCount: additions.length, snapshotPathCount: captured.size + additions.length } });
    } catch (error) {
      if (persistenceFailed) {
        throw error;
      }
      return void failCapture(
        scope,
        'before',
        error instanceof Error ? error.message : 'capture-paths-failed',
      );
    } finally {
      if (indexFile !== undefined) {
        await dependencies.unlink(indexFile).catch(() => undefined);
      }
    }
  };

  const readTreeBytes = async (
    scope: TurnSnapshotScope,
    path: string,
    phase: 'before' | 'after',
  ): Promise<Buffer | null | undefined> => {
    if (!isSafeWorkspaceRelativePath(path) || disposed || storeDisabled) {
      return undefined;
    }
    const record = readTurn(sessions, scope.sessionId, scope.turnId);
    const oid = record?.[phase];
    if (oid === undefined) {
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
    await dependencies.mkdir(objectsDir);
    const result = await git(
      root,
      ['show', `${oid}:${path}`],
      env,
      deadline,
      MAX_OPEN_BASELINE_BYTES,
    );
    if (result.timedOut) {
      return undefined;
    }
    if (result.code === 0) {
      return result.stdout;
    }
    if (result.code !== 128) {
      return undefined;
    }
    const tree = await git(
      root,
      ['cat-file', '-e', `${oid}^{tree}`],
      env,
      deadline,
      4096,
    );
    if (tree.timedOut || tree.code !== 0) return undefined;
    if (!record?.snapshotPaths?.includes(path)) {
      // An ignored file omitted from a snapshot is not proof that it did not
      // exist. Otherwise watchers count its entire contents as a new file.
      const ignored = await git(root, ['check-ignore', '--no-index', '-z', '--stdin'],
        env, deadline, 4096, Buffer.from(`${path}\0`));
      if (ignored.timedOut || ignored.code !== 1) return undefined;
    }
    return null;
  };

  return {
    capture(scope, phase) {
      if (closing) {
        return Promise.resolve(undefined);
      }
      return enqueue(() => captureNow(scope, phase));
    },
    capturePaths(scope, paths) {
      if (closing) {
        return Promise.resolve();
      }
      return enqueue(() => capturePathsNow(scope, paths));
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
        throw new Error('Turn snapshot comparison is unavailable.');
      }
      const root = getWorkspaceRoot();
      if (root === undefined) {
        throw new Error('Turn snapshot workspace is unavailable.');
      }
      const deadline = dependencies.now() + SNAPSHOT_TIMEOUT_MS;
      const resolved = await resolveLayout(root, deadline);
      if (resolved === undefined) {
        throw new Error('Turn snapshot Git storage is unavailable.');
      }
      await dependencies.mkdir(objectsDir);
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
        throw new Error(result.timedOut ? 'Turn snapshot comparison timed out.' : 'Turn snapshot comparison failed.');
      }
      const stats = parseGitNumstat(result.stdout.toString('utf8'));
      dependencies.recordDiagnostic({ level: 'info', name: 'host.changes.snapshot.diff',
        attributes: { ...scope, beforeTree: record.before, afterTree: record.after,
          sameTree: record.before === record.after, fileCount: stats.size } });
      for (const [path, stat] of [...stats].slice(0, MAX_CHANGED_FILES_PER_TURN)) {
        dependencies.recordDiagnostic({ level: 'debug', name: 'host.changes.snapshot.file',
          attributes: { ...scope, path, additions: stat.additions, deletions: stat.deletions } });
      }
      return stats;
    },
    async readTreeFile(scope, path) {
      const bytes = await readTreeBytes(scope, path, 'before');
      if (bytes === undefined) {
        return undefined;
      }
      if (bytes === null) {
        return '';
      }
      return bytes.includes(0) ? undefined : bytes.toString('utf8');
    },
    readTreeBytes,
    read(sessionId, turnId) {
      return cloneRecord(readTurn(sessions, sessionId, turnId));
    },
    readTurns(sessionId) {
      return (sessions.get(sessionId) ?? []).map((record) => cloneRecord(record)!);
    },
    prune() {
      return enqueue(async () => {
        if (disposed || closing) {
          return;
        }
        const snapshotSessions = pendingSessions ?? sessions;
        const empty = snapshotSessions.size === 0;
        const bytes = await directoryBytes(objectsDir, dependencies);
        if (empty || bytes <= MAX_SNAPSHOT_OBJECT_BYTES) {
          return;
        }
        await dependencies.rm(objectsDir).catch(() => undefined);
        await flushPending();
        await persist(new Map());
      });
    },
    dispose() {
      if (disposeOutcome !== undefined) {
        return disposeOutcome;
      }
      closing = true;
      disposeOutcome = queue.then(async () => {
        disposed = true;
        disabledSessions.clear();
        layout = undefined;
        if (persistenceFailed) {
          throw persistenceFailure;
        }
        sessions.clear();
        pendingSessions = undefined;
      });
      return disposeOutcome;
    },
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
    readonly input?: Buffer;
  },
): Promise<GitRunResult> {
  return new Promise((resolve) => {
    const child = execFile(
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
    child.stdin?.on('error', () => { /* Exit status reports a Git process that closed stdin early. */ });
    child.stdin?.end(options.input);
  });
}
