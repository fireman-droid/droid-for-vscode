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

/** Injectable filesystem/process seams for unit tests. */
export interface DaemonDiscoveryDeps {
  readonly readFile: (file: string) => string | null;
  /** Create with `wx`; returns false when the file already exists. */
  readonly writeFileExclusive: (file: string, contents: string) => boolean;
  readonly deleteFile: (file: string) => void;
  readonly startDaemon: () => Promise<{
    url: string;
    pid: number;
    port: number;
  }>;
  readonly checkHealth: (url: string) => Promise<boolean>;
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

  const existing = readDaemonDiscovery(file, d.readFile);
  if (existing !== null) {
    const url = endpointUrl(d.host, existing.port);
    // A crashed daemon leaves its record behind. Check the pid first:
    // it is a cheap syscall, while the health check burns a connect
    // timeout against a dead port (and a reused port could even answer
    // for an unrelated process).
    if (d.isPidAlive(existing.pid) && (await d.checkHealth(url))) {
      return {
        url,
        pid: existing.pid,
        port: existing.port,
        spawned: false,
        versionMismatch: isVersionMismatch(existing.version, d.cliVersion()),
      };
    }
    // Stale record: the daemon died or stopped answering. Clear it so
    // the `wx` write below can win.
    d.deleteFile(file);
  }

  const spawned = await d.startDaemon();
  const record: DaemonDiscoveryRecord = {
    port: spawned.port,
    pid: spawned.pid,
    version: d.cliVersion(),
    startedAt: d.now(),
  };
  if (d.writeFileExclusive(file, JSON.stringify(record))) {
    return { ...spawned, spawned: true, versionMismatch: false };
  }

  // Lost the spawn race: another window registered its daemon between
  // our read and write. Prefer the winner and reap our duplicate.
  const winner = readDaemonDiscovery(file, d.readFile);
  if (winner !== null) {
    const url = endpointUrl(d.host, winner.port);
    if (d.isPidAlive(winner.pid) && (await d.checkHealth(url))) {
      await d.killProcessTree(spawned.pid);
      return {
        url,
        pid: winner.pid,
        port: winner.port,
        spawned: false,
        versionMismatch: isVersionMismatch(winner.version, d.cliVersion()),
      };
    }
  }
  // The competing record is unhealthy or unreadable: replace it with
  // ours, but keep the publication exclusive.
  d.deleteFile(file);
  if (d.writeFileExclusive(file, JSON.stringify(record))) {
    return { ...spawned, spawned: true, versionMismatch: false };
  }
  // A third contender slipped in. Trust it only after the same
  // pid+health checks; otherwise fail instead of returning an
  // undiscoverable duplicate daemon.
  const finalWinner = readDaemonDiscovery(file, d.readFile);
  if (finalWinner !== null) {
    const url = endpointUrl(d.host, finalWinner.port);
    if (d.isPidAlive(finalWinner.pid) && (await d.checkHealth(url))) {
      await d.killProcessTree(spawned.pid);
      return {
        url,
        pid: finalWinner.pid,
        port: finalWinner.port,
        spawned: false,
        versionMismatch: isVersionMismatch(
          finalWinner.version,
          d.cliVersion(),
        ),
      };
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
    Pick<DaemonDiscoveryDeps, 'readFile' | 'deleteFile' | 'killProcessTree'>
  > = {},
): Promise<boolean> {
  const readFile = deps.readFile ?? defaultReadFile;
  const deleteFile = deps.deleteFile ?? defaultDeleteFile;
  const killProcessTree = deps.killProcessTree ?? noopKill;

  const record = readDaemonDiscovery(file, readFile);
  if (record === null) {
    deleteFile(file);
    return false;
  }
  await killProcessTree(record.pid);
  deleteFile(file);
  return true;
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
    startDaemon:
      deps.startDaemon ??
      (() => Promise.reject(new Error('startDaemon dependency required'))),
    checkHealth: deps.checkHealth ?? (() => Promise.resolve(false)),
    killProcessTree: deps.killProcessTree ?? noopKill,
    isPidAlive: deps.isPidAlive ?? defaultIsPidAlive,
    cliVersion: deps.cliVersion ?? (() => 'unknown'),
    now: deps.now ?? Date.now,
    host: deps.host ?? '127.0.0.1',
  };
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
