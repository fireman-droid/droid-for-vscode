import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

/**
 * Self-built service discovery for the shared detached daemon (daemon
 * Phase 3). The droid CLI has no discovery convention, so DroidVisX
 * keeps one well-known file under the user profile:
 *
 *   ~/.droidvisx/daemon.json  ->  { port, pid, version, startedAt }
 *
 * Concurrent windows race to spawn; the discovery file is claimed
 * exclusively (temp file + hard link, `wx` fallback) so exactly one
 * writer wins and losers connect to the winner (killing their own
 * freshly spawned daemon). The file never contains credentials.
 */

export interface DaemonDiscoveryRecord {
  readonly port: number;
  readonly pid: number;
  readonly version: string;
  readonly startedAt: number;
}

export interface SharedDaemonEndpoint {
  readonly url: string;
  readonly pid: number;
  readonly port: number;
  /** True when this call spawned the daemon (vs. reusing a healthy one). */
  readonly spawned: boolean;
  /**
   * True when a reused daemon was started by a different CLI version
   * than the current one (both known). The caller should surface a
   * "restart the daemon" hint; connecting is still allowed.
   */
  readonly versionMismatch: boolean;
}

export type DaemonHealth =
  | 'healthy'
  | 'authentication-failed'
  | 'unreachable';

/** Injectable filesystem/process seams for unit tests. */
export interface DaemonDiscoveryDeps {
  readonly readFile: (file: string) => string | null;
  /** Create with `wx`; returns false when the file already exists. */
  readonly writeFileExclusive: (file: string, contents: string) => boolean;
  readonly deleteFile: (file: string) => void;
  /** Atomically removes the path only when it still has these contents. */
  readonly deleteFileIfMatches: (file: string, contents: string) => boolean;
  readonly startDaemon: () => Promise<{
    url: string;
    pid: number;
    port: number;
    /** The starter already verified that this pid owns the listener. */
    listenerVerified?: boolean;
  }>;
  readonly checkHealth: (url: string) => Promise<DaemonHealth>;
  readonly resolveListenerPid: (
    port: number,
    host: string,
  ) => Promise<number | null>;
  readonly killProcessTree: (pid: number) => Promise<void>;
  readonly isPidAlive: (pid: number) => boolean;
  readonly cliVersion: () => string;
  readonly now: () => number;
  readonly host: string;
}

export function defaultDiscoveryFile(): string {
  return path.join(os.homedir(), '.droidvisx', 'daemon.json');
}

/**
 * Parses and validates the discovery file. The file is an external
 * trust boundary (any process can write it), so the shape is checked
 * strictly and anything malformed reads as "no daemon".
 */
export function readDaemonDiscovery(
  file: string,
  readFile: DaemonDiscoveryDeps['readFile'] = defaultReadFile,
): DaemonDiscoveryRecord | null {
  const raw = readFile(file);
  if (raw === null) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  const port = record['port'];
  const pid = record['pid'];
  const version = record['version'];
  const startedAt = record['startedAt'];
  if (
    typeof port !== 'number' ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    typeof pid !== 'number' ||
    !Number.isInteger(pid) ||
    pid < 1 ||
    typeof version !== 'string' ||
    version.length > 100 ||
    typeof startedAt !== 'number'
  ) {
    return null;
  }
  return { port, pid, version, startedAt };
}

/**
 * Returns a healthy shared daemon endpoint, reusing the discovered one
 * when it passes the health check and otherwise spawning a detached
 * replacement. Handles the concurrent-spawn race via `wx` creation:
 * the loser kills its own daemon and connects to the winner.
 */
export async function ensureSharedDaemon(
  file: string,
  deps: Partial<DaemonDiscoveryDeps> = {},
): Promise<SharedDaemonEndpoint> {
  const d = withDefaults(deps);

  const existingRaw = d.readFile(file);
  const existing =
    existingRaw === null ? null : parseDaemonDiscovery(existingRaw);
  if (existing !== null) {
    const endpoint = await healthyEndpoint(existing, d);
    if (endpoint !== null) {
      return endpoint;
    }
    await reapUnreachableRecord(file, existingRaw, existing, d);
  } else if (
    existingRaw !== null &&
    !d.deleteFileIfMatches(file, existingRaw)
  ) {
    return readChangedHealthyEndpoint(file, d);
  }
  if (existingRaw !== null && d.readFile(file) !== null) {
    return readChangedHealthyEndpoint(file, d);
  }

  const spawned = await d.startDaemon();
  const listenerPid = spawned.listenerVerified === true
    ? spawned.pid
    : await resolveVerifiedListenerPid(
        spawned.port,
        d.host,
        d,
      );
  if (listenerPid === null) {
    await d.killProcessTree(spawned.pid).catch(() => undefined);
    throw new Error('Droid daemon listener identity could not be verified.');
  }
  const verifiedSpawned = {
    url: endpointUrl(d.host, spawned.port),
    pid: listenerPid,
    port: spawned.port,
  };
  const record: DaemonDiscoveryRecord = {
    port: verifiedSpawned.port,
    pid: verifiedSpawned.pid,
    version: d.cliVersion(),
    startedAt: d.now(),
  };
  if (d.writeFileExclusive(file, JSON.stringify(record))) {
    return { ...verifiedSpawned, spawned: true, versionMismatch: false };
  }

  // Lost the spawn race: another window registered its daemon between
  // our read and write. Prefer the winner and reap our duplicate.
  const winnerRaw = d.readFile(file);
  const winner =
    winnerRaw === null ? null : parseDaemonDiscovery(winnerRaw);
  if (winner !== null) {
    const endpoint = await healthyEndpoint(winner, d);
    if (endpoint !== null) {
      await d.killProcessTree(spawned.pid);
      return endpoint;
    }
  }
  // The competing record is unhealthy or unreadable: replace it with
  // ours, but remove only the exact record we inspected.
  if (
    winnerRaw !== null &&
    !d.deleteFileIfMatches(file, winnerRaw)
  ) {
    const endpoint = await readChangedHealthyEndpoint(file, d).catch(
      async (error: unknown) => {
        await d.killProcessTree(spawned.pid);
        throw error;
      },
    );
    await d.killProcessTree(spawned.pid);
    return endpoint;
  }
  if (d.writeFileExclusive(file, JSON.stringify(record))) {
    return { ...verifiedSpawned, spawned: true, versionMismatch: false };
  }
  // A third contender slipped in. Trust it only after the same
  // pid+health checks; otherwise fail instead of returning an
  // undiscoverable duplicate daemon.
  const finalWinner = readDaemonDiscovery(file, d.readFile);
  if (finalWinner !== null) {
    const endpoint = await healthyEndpoint(finalWinner, d);
    if (endpoint !== null) {
      await d.killProcessTree(spawned.pid);
      return endpoint;
    }
  }
  await d.killProcessTree(spawned.pid);
  throw new Error('Droid daemon discovery race did not yield a healthy winner.');
}

/**
 * Terminates the discovered shared daemon and removes the discovery
 * file. Returns false when no discovery record exists.
 */
export async function shutdownSharedDaemon(
  file: string,
  deps: Partial<
    Pick<
      DaemonDiscoveryDeps,
      | 'readFile'
      | 'deleteFile'
      | 'killProcessTree'
      | 'resolveListenerPid'
      | 'host'
    >
  > = {},
): Promise<boolean> {
  const readFile = deps.readFile ?? defaultReadFile;
  const deleteFile = deps.deleteFile ?? defaultDeleteFile;
  const killProcessTree = deps.killProcessTree ?? noopKill;
  const resolveListenerPid =
    deps.resolveListenerPid ?? (() => Promise.resolve(null));
  const host = deps.host ?? '127.0.0.1';

  const record = readDaemonDiscovery(file, readFile);
  if (record === null) {
    deleteFile(file);
    return false;
  }
  const listenerPid = await resolveListenerPid(record.port, host).catch(
    () => null,
  );
  if (listenerPid === null) {
    // Never fall back to the recorded pid: it may be a dead wrapper,
    // recycled, or attacker-controlled and is not bound to this port.
    return false;
  }
  await killProcessTree(listenerPid);
  deleteFile(file);
  return true;
}

async function readChangedHealthyEndpoint(
  file: string,
  deps: DaemonDiscoveryDeps,
): Promise<SharedDaemonEndpoint> {
  const changed = readDaemonDiscovery(file, deps.readFile);
  if (changed !== null) {
    const endpoint = await healthyEndpoint(changed, deps);
    if (endpoint !== null) {
      return endpoint;
    }
  }
  throw new Error('Droid daemon discovery changed during stale cleanup.');
}

async function healthyEndpoint(
  record: DaemonDiscoveryRecord,
  deps: DaemonDiscoveryDeps,
): Promise<SharedDaemonEndpoint | null> {
  const url = endpointUrl(deps.host, record.port);
  const listenerPid = await resolveVerifiedListenerPid(
    record.port,
    deps.host,
    deps,
  );
  if (
    listenerPid === null ||
    (deps.isPidAlive(record.pid) && listenerPid !== record.pid)
  ) {
    return null;
  }
  const health = await deps.checkHealth(url);
  if (health === 'unreachable') {
    return null;
  }
  return {
    url,
    pid: listenerPid,
    port: record.port,
    spawned: false,
    versionMismatch: isVersionMismatch(record.version, deps.cliVersion()),
  };
}

async function reapUnreachableRecord(
  file: string,
  raw: string | null,
  record: DaemonDiscoveryRecord,
  deps: DaemonDiscoveryDeps,
): Promise<void> {
  if (raw === null) {
    return;
  }
  const listenerPid = await resolveVerifiedListenerPid(
    record.port,
    deps.host,
    deps,
  );
  if (
    listenerPid !== null &&
    (!deps.isPidAlive(record.pid) || listenerPid === record.pid)
  ) {
    await deps.killProcessTree(listenerPid);
  }
  deps.deleteFileIfMatches(file, raw);
}

async function resolveVerifiedListenerPid(
  port: number,
  host: string,
  deps: Pick<DaemonDiscoveryDeps, 'resolveListenerPid'>,
): Promise<number | null> {
  try {
    return await deps.resolveListenerPid(port, host);
  } catch {
    return null;
  }
}

function isVersionMismatch(recorded: string, current: string): boolean {
  return (
    recorded !== 'unknown' && current !== 'unknown' && recorded !== current
  );
}

function endpointUrl(host: string, port: number): string {
  return `ws://${host}:${String(port)}`;
}

function withDefaults(
  deps: Partial<DaemonDiscoveryDeps>,
): DaemonDiscoveryDeps {
  return {
    readFile: deps.readFile ?? defaultReadFile,
    writeFileExclusive: deps.writeFileExclusive ?? defaultWriteFileExclusive,
    deleteFile: deps.deleteFile ?? defaultDeleteFile,
    deleteFileIfMatches:
      deps.deleteFileIfMatches ??
      (deps.deleteFile === undefined
        ? defaultDeleteFileIfMatches
        : (file, _contents) => {
            deps.deleteFile?.(file);
            return true;
          }),
    startDaemon:
      deps.startDaemon ??
      (() => Promise.reject(new Error('startDaemon dependency required'))),
    checkHealth:
      deps.checkHealth ?? (() => Promise.resolve('unreachable')),
    resolveListenerPid:
      deps.resolveListenerPid ?? (() => Promise.resolve(null)),
    killProcessTree: deps.killProcessTree ?? noopKill,
    isPidAlive: deps.isPidAlive ?? defaultIsPidAlive,
    cliVersion: deps.cliVersion ?? (() => 'unknown'),
    now: deps.now ?? Date.now,
    host: deps.host ?? '127.0.0.1',
  };
}

function parseDaemonDiscovery(raw: string): DaemonDiscoveryRecord | null {
  return readDaemonDiscovery('', () => raw);
}

function defaultReadFile(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Publishes the record atomically: the content is fully written to a
 * temp file first and only then claimed at the discovery path with
 * `link` (which, like `wx`, fails when the path already exists), so a
 * concurrent reader never sees a half-written record. Filesystems
 * without hard links fall back to the original `wx` write.
 */
function defaultWriteFileExclusive(file: string, contents: string): boolean {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${String(process.pid)}.tmp`;
  try {
    fs.writeFileSync(tmp, contents);
    fs.linkSync(tmp, file);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EEXIST') {
      return false;
    }
    try {
      fs.writeFileSync(file, contents, { flag: 'wx' });
      return true;
    } catch (fallbackError) {
      if ((fallbackError as NodeJS.ErrnoException).code === 'EEXIST') {
        return false;
      }
      throw fallbackError;
    }
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      // Temp file never materialized or was already removed.
    }
  }
}

function defaultDeleteFile(file: string): void {
  try {
    fs.unlinkSync(file);
  } catch {
    // Already gone (ENOENT) or being swept by a concurrent window.
  }
}

function defaultDeleteFileIfMatches(
  file: string,
  contents: string,
): boolean {
  const moved = `${file}.${String(process.pid)}.${String(Date.now())}.stale`;
  try {
    fs.renameSync(file, moved);
  } catch {
    return false;
  }
  try {
    const movedContents = fs.readFileSync(moved, 'utf8');
    if (movedContents === contents) {
      return true;
    }
    // The path changed before our atomic rename. Restore that record
    // only if no newer contender has already published another one.
    defaultWriteFileExclusive(file, movedContents);
    return false;
  } catch {
    return false;
  } finally {
    defaultDeleteFile(moved);
  }
}

function defaultIsPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the pid exists but belongs to another user.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function noopKill(): Promise<void> {
  return Promise.resolve();
}
