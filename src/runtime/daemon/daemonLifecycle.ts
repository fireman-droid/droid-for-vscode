import { spawn } from 'node:child_process';
import net from 'node:net';
import process from 'node:process';

/** How long we wait for a freshly spawned daemon to start listening. */
const DAEMON_LISTEN_TIMEOUT_MS = 30_000;
const PORT_POLL_INTERVAL_MS = 500;

export interface DaemonEndpoint {
  readonly url: string;
  readonly pid: number;
}

export interface DaemonLifecycleOptions {
  readonly droidPath?: string;
  readonly host?: string;
  /**
   * Phase 1 always guards the private daemon with the extension host
   * pid so the daemon exits when the extension host dies. Detached
   * shared daemons are a later phase.
   */
  readonly parentPid?: number;
}

export interface DaemonSpawnHandle {
  readonly pid: number | undefined;
  onExit(listener: (code: number | null) => void): void;
}

/** Injectable process/network seams for unit tests. */
export interface DaemonLifecycleDeps {
  readonly spawnDaemon: (
    droidPath: string,
    args: readonly string[],
  ) => DaemonSpawnHandle;
  readonly pickFreePort: () => Promise<number>;
  readonly waitForPort: (
    port: number,
    host: string,
    timeoutMs: number,
  ) => Promise<void>;
  readonly killProcessTree: (pid: number) => Promise<void>;
}

/**
 * Spawns a private `droid daemon` on a free localhost port for this
 * extension host. The daemon is bound to `--parent-pid` (defaults to
 * the current process) so it never outlives the extension host in
 * Phase 1. No discovery file is written and nothing is shared across
 * windows.
 */
export async function ensurePrivateDaemon(
  options: DaemonLifecycleOptions = {},
  deps: Partial<DaemonLifecycleDeps> = {},
): Promise<DaemonEndpoint> {
  const droidPath = options.droidPath ?? 'droid';
  const host = options.host ?? '127.0.0.1';
  const parentPid = options.parentPid ?? process.pid;
  const spawnDaemon = deps.spawnDaemon ?? defaultSpawnDaemon;
  const pickFreePort = deps.pickFreePort ?? defaultPickFreePort;
  const waitForPort = deps.waitForPort ?? defaultWaitForPort;

  const port = await pickFreePort();
  const child = spawnDaemon(droidPath, [
    'daemon',
    '--port',
    String(port),
    '--host',
    host,
    '--parent-pid',
    String(parentPid),
  ]);
  if (child.pid === undefined) {
    throw new Error('droid daemon process failed to spawn');
  }

  let exited: number | null | undefined;
  child.onExit((code) => {
    exited = code ?? -1;
  });

  try {
    await waitForPort(port, host, DAEMON_LISTEN_TIMEOUT_MS);
  } catch (error) {
    if (exited !== undefined) {
      throw new Error(
        `droid daemon exited before listening (code ${String(exited)})`,
      );
    }
    throw error;
  }

  return { url: `ws://${host}:${String(port)}`, pid: child.pid };
}

/**
 * Terminates a private daemon spawned by {@link ensurePrivateDaemon}.
 * Windows needs the whole tree killed because the daemon is spawned
 * through a shell.
 */
export async function stopDaemon(
  endpoint: DaemonEndpoint,
  deps: Partial<Pick<DaemonLifecycleDeps, 'killProcessTree'>> = {},
): Promise<void> {
  const killProcessTree = deps.killProcessTree ?? defaultKillProcessTree;
  try {
    await killProcessTree(endpoint.pid);
  } catch {
    // Already gone (parent-pid guard) or no permission; nothing to do.
  }
}

function defaultSpawnDaemon(
  droidPath: string,
  args: readonly string[],
): DaemonSpawnHandle {
  // shell: true because `droid` resolves to droid.cmd on Windows.
  const child = spawn(droidPath, [...args], {
    shell: true,
    stdio: ['ignore', 'ignore', 'ignore'],
    windowsHide: true,
  });
  return {
    pid: child.pid,
    onExit: (listener) => {
      child.once('exit', (code) => listener(code));
    },
  };
}

function defaultPickFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        server.close(() => reject(new Error('no free port available')));
        return;
      }
      const port = address.port;
      server.close(() => resolve(port));
    });
  });
}

function defaultWaitForPort(
  port: number,
  host: string,
  timeoutMs: number,
): Promise<void> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tryOnce = (): void => {
      const socket = net.connect({ port, host });
      socket.once('connect', () => {
        socket.destroy();
        resolve();
      });
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() - started > timeoutMs) {
          reject(
            new Error(
              `daemon port ${String(port)} not listening after ${String(timeoutMs)}ms`,
            ),
          );
        } else {
          setTimeout(tryOnce, PORT_POLL_INTERVAL_MS);
        }
      });
    };
    tryOnce();
  });
}

function defaultKillProcessTree(pid: number): Promise<void> {
  if (process.platform === 'win32') {
    return new Promise((resolve) => {
      const killer = spawn(
        'taskkill',
        ['/PID', String(pid), '/T', '/F'],
        { shell: true, stdio: 'ignore', windowsHide: true },
      );
      killer.once('exit', () => resolve());
      killer.once('error', () => resolve());
    });
  }
  process.kill(pid, 'SIGTERM');
  return Promise.resolve();
}
