import { spawn } from 'node:child_process';
import net from 'node:net';
import process from 'node:process';

/** How long we wait for a freshly spawned daemon to start listening. */
const DAEMON_LISTEN_TIMEOUT_MS = 30_000;
const PORT_POLL_INTERVAL_MS = 100;
/** Last stretch of daemon stderr kept for start-failure reports. */
const STDERR_TAIL_MAX_CHARS = 2048;
/** Cap on the pre-kill identity query; unverifiable means no kill. */
const IDENTITY_QUERY_TIMEOUT_MS = 5_000;
/** Bounds output from system identity/listener queries. */
const IDENTITY_QUERY_OUTPUT_MAX_CHARS = 1024 * 1024;

export interface DaemonEndpoint {
  readonly url: string;
  readonly pid: number;
  /** Exact executable requested when this process was spawned. */
  readonly executable?: string;
}

export interface DaemonLifecycleOptions {
  readonly droidPath?: string;
  readonly host?: string;
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
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
  onError?(listener: (error: Error) => void): void;
  /** Rolling tail of the child's stderr, when captured. */
  stderrTail?(): string;
}

/** Injectable process/network seams for unit tests. */
export interface DaemonLifecycleDeps {
  readonly spawnDaemon: (
    droidPath: string,
    args: readonly string[],
  ) => DaemonSpawnHandle;
  readonly spawnDetachedDaemon: (
    droidPath: string,
    args: readonly string[],
    options?: Pick<DaemonLifecycleOptions, 'cwd' | 'env'>,
  ) => DaemonSpawnHandle;
  readonly pickFreePort: () => Promise<number>;
  readonly waitForPort: (
    port: number,
    host: string,
    timeoutMs: number,
    signal?: AbortSignal,
  ) => Promise<void>;
  /** Resolves and verifies the process listening on a daemon port. */
  readonly resolveListenerPid: (
    port: number,
    host: string,
    executable: string,
  ) => Promise<number | null>;
  readonly killProcessTree: (pid: number) => Promise<void>;
  /** Resolves the command line of a live pid, or null when unknown. */
  readonly queryProcessCommandLine: (pid: number) => Promise<string | null>;
}

/**
 * Spawns a shared `droid daemon` that outlives this process (daemon
 * Phase 3): detached, unref'ed, and deliberately without
 * `--parent-pid`, so window reloads and extension host exits leave it
 * running. Callers own discovery-file bookkeeping and shutdown
 * (`stopDaemon` / the shutdown command); nothing here reaps it.
 */
export async function startDetachedDaemon(
  options: Pick<DaemonLifecycleOptions, 'droidPath' | 'host' | 'cwd' | 'env'> = {},
  deps: Partial<
    Pick<
      DaemonLifecycleDeps,
      | 'spawnDetachedDaemon'
      | 'pickFreePort'
      | 'waitForPort'
      | 'resolveListenerPid'
      | 'killProcessTree'
    >
  > = {},
): Promise<
  DaemonEndpoint & {
    readonly port: number;
    readonly listenerVerified: true;
  }
> {
  const droidPath = options.droidPath ?? 'droid';
  const host = options.host ?? '127.0.0.1';
  const spawnDetached =
    deps.spawnDetachedDaemon ?? defaultSpawnDetachedDaemon;
  const pickFreePort = deps.pickFreePort ?? defaultPickFreePort;
  const waitForPort = deps.waitForPort ?? defaultWaitForPort;
  const resolveListenerPid =
    deps.resolveListenerPid ?? resolveDaemonListenerPid;
  const killProcessTree = deps.killProcessTree ?? defaultKillProcessTree;

  const port = await pickFreePort();
  const args = [
    'daemon',
    '--port',
    String(port),
    '--host',
    host,
  ];
  const child = options.cwd === undefined && options.env === undefined
    ? spawnDetached(droidPath, args)
    : spawnDetached(droidPath, args, { cwd: options.cwd, env: options.env });
  if (child.pid === undefined) {
    throw new Error('droid daemon process failed to spawn');
  }

  let exited: number | null | undefined;
  try {
    await waitForDaemonPort(
      child,
      port,
      host,
      waitForPort,
      (code) => {
        exited = code ?? -1;
      },
    );
  } catch (error) {
    if (exited !== undefined) {
      throw new Error(
        `droid daemon exited before listening (code ${String(exited)})`,
      );
    }
    try {
      await killProcessTree(child.pid);
    } catch {
      // Already gone; nothing to reap.
    }
    throw error;
  }

  let listenerPid: number | null;
  try {
    listenerPid = await resolveListenerPid(port, host, droidPath);
  } catch {
    listenerPid = null;
  }
  if (listenerPid === null) {
    try {
      await killProcessTree(child.pid);
    } catch {
      // The spawned process is already gone.
    }
    throw new Error('droid daemon listener identity could not be verified');
  }

  return {
    url: `ws://${host}:${String(port)}`,
    pid: listenerPid,
    port,
    executable: droidPath,
    listenerVerified: true,
  };
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
  const killProcessTree = deps.killProcessTree ?? defaultKillProcessTree;

  const attempt = async (): Promise<DaemonEndpoint> => {
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
    try {
      await waitForDaemonPort(
        child,
        port,
        host,
        waitForPort,
        (code) => {
          exited = code ?? -1;
        },
      );
    } catch (error) {
      const tail = child.stderrTail?.().trim() ?? '';
      const stderrSuffix = tail === '' ? '' : `; stderr: ${tail}`;
      if (exited !== undefined) {
        throw new Error(
          `droid daemon exited before listening (code ${String(exited)})${stderrSuffix}`,
        );
      }
      // The child is still alive but never started listening; reap it
      // so the port retry cannot stack a second daemon behind it.
      try {
        await killProcessTree(child.pid);
      } catch {
        // Already gone; nothing to reap.
      }
      throw new Error(`${errorText(error)}${stderrSuffix}`);
    }

    return {
      url: `ws://${host}:${String(port)}`,
      pid: child.pid,
      executable: droidPath,
    };
  };

  // pickFreePort closes its probe socket before the daemon binds, so
  // another process can steal the port in between (TOCTOU). One retry
  // on a fresh port absorbs that race instead of surfacing it.
  try {
    return await attempt();
  } catch (firstError) {
    let retried: DaemonEndpoint;
    try {
      retried = await attempt();
    } catch (retryError) {
      throw new Error(
        `droid daemon failed to start after a port retry: ${errorText(
          retryError,
        )} (first attempt: ${errorText(firstError)})`,
      );
    }
    return retried;
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Terminates a private daemon spawned by {@link ensurePrivateDaemon}.
 * Windows needs the whole tree killed because the daemon is spawned
 * through a shell.
 *
 * The pid was recorded at spawn time; by the time we dispose, the
 * daemon may have died on its own and the OS may have recycled the pid
 * for an unrelated process — a blind `taskkill /T /F` would then take
 * down an innocent process tree. The kill therefore only proceeds when
 * the pid's current command line still looks like our daemon (the
 * recorded pid is the cmd.exe wrapper on Windows, whose command line
 * embeds `droid daemon ...`). An unverifiable identity skips the kill:
 * worst case an orphaned daemon lingers, which is recoverable, unlike
 * killing a stranger.
 */
export async function stopDaemon(
  endpoint: DaemonEndpoint,
  deps: Partial<
    Pick<DaemonLifecycleDeps, 'killProcessTree' | 'queryProcessCommandLine'>
  > = {},
): Promise<void> {
  const killProcessTree = deps.killProcessTree ?? defaultKillProcessTree;
  const queryProcessCommandLine =
    deps.queryProcessCommandLine ?? defaultQueryProcessCommandLine;
  try {
    const commandLine = await queryProcessCommandLine(endpoint.pid);
    if (
      commandLine === null ||
      !looksLikeDroidDaemon(commandLine, endpoint.executable ?? 'droid')
    ) {
      return;
    }
    await killProcessTree(endpoint.pid);
  } catch {
    // Already gone (parent-pid guard) or no permission; nothing to do.
  }
}

/** Matches both the daemon itself and its cmd.exe/sh wrapper. */
function looksLikeDroidDaemon(
  commandLine: string,
  executable: string,
): boolean {
  const tokens = tokenizeCommandLine(commandLine).map((token) =>
    token.toLowerCase(),
  );
  const expected = executableStem(pathBasename(executable));
  return tokens.some(
    (token, index) =>
      executableStem(pathBasename(token)) === expected &&
      tokens[index + 1] === 'daemon',
  );
}

function executableStem(value: string): string {
  return value.toLowerCase().replace(/\.(?:exe|cmd|bat)$/u, '');
}

function tokenizeCommandLine(commandLine: string): string[] {
  const tokens = commandLine.match(/"[^"]*"|'[^']*'|[^\s]+/g) ?? [];
  return tokens.flatMap((token) => {
    const stripped = token.replace(/^(['"])(.*)\1$/, '$2');
    // cmd.exe /c wraps the complete child command in one quoted
    // argument. Keep that argument intact for quoted executable paths,
    // and also expose its words for exact verb/executable matching.
    return stripped === token || !/\s/.test(stripped)
      ? [stripped]
      : [stripped, ...stripped.split(/\s+/)];
  });
}

function pathBasename(value: string): string {
  const normalized = value.replace(/\\/g, '/');
  return normalized.slice(normalized.lastIndexOf('/') + 1);
}

/**
 * Spawn options for the private (parent-pid guarded) daemon.
 * `shell: true` because `droid` can resolve to droid.cmd on Windows;
 * `windowsHide` maps to CREATE_NO_WINDOW there, so the cmd.exe wrapper
 * gets a hidden console that every descendant inherits — no console
 * window is ever shown.
 */
export function privateDaemonSpawnOptions(): {
  shell: true;
  stdio: ['ignore', 'ignore', 'pipe'];
  windowsHide: true;
} {
  return {
    shell: true,
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true,
  };
}

/**
 * Spawn options for the shared daemon that must outlive the extension
 * host.
 *
 * Windows cannot combine `detached` with a hidden console: `detached`
 * adds the DETACHED_PROCESS creation flag, which makes Win32 ignore
 * the CREATE_NO_WINDOW flag that `windowsHide` maps to. The cmd.exe
 * wrapper then runs console-less and the daemon underneath it
 * allocates its own *visible* console — the v0.2.0 startup console
 * pop-up. Dropping `detached` on Windows keeps the hidden console
 * attached to cmd.exe for the whole chain, and the daemon still
 * survives extension-host death: libuv's kill-on-job-close job holds
 * only the direct cmd.exe child, while JOB_OBJECT_LIMIT_SILENT_
 * BREAKAWAY_OK lets grandchildren daemonize. Both properties (no
 * window, survives parent exit) verified on a real Windows 11 machine
 * by artifacts/probe-daemon-window.mjs.
 *
 * POSIX keeps `detached` (setsid) — required to survive the parent
 * there, and console windows do not exist.
 */
export function detachedDaemonSpawnOptions(
  platform: NodeJS.Platform = process.platform,
): {
  shell: true;
  detached: boolean;
  stdio: 'ignore';
  windowsHide: true;
} {
  return {
    shell: true,
    detached: platform !== 'win32',
    stdio: 'ignore',
    windowsHide: true,
  };
}

function defaultSpawnDaemon(
  droidPath: string,
  args: readonly string[],
): DaemonSpawnHandle {
  const child = spawn(droidPath, [...args], privateDaemonSpawnOptions());
  // Keep only a stderr tail: enough to explain a failed start without
  // buffering a long-lived daemon's full output.
  let stderrTail = '';
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (chunk: string) => {
    stderrTail = (stderrTail + chunk).slice(-STDERR_TAIL_MAX_CHARS);
  });
  return { ...observeDaemonChild(child), stderrTail: () => stderrTail };
}

function defaultSpawnDetachedDaemon(
  droidPath: string,
  args: readonly string[],
  options?: Pick<DaemonLifecycleOptions, 'cwd' | 'env'>,
): DaemonSpawnHandle {
  const child = spawn(droidPath, [...args], {
    ...detachedDaemonSpawnOptions(),
    ...options,
  });
  const handle = observeDaemonChild(child);
  child.unref();
  return handle;
}

function observeDaemonChild(child: ReturnType<typeof spawn>): DaemonSpawnHandle {
  let failure: Error | undefined;
  let reportError: ((error: Error) => void) | undefined;
  // Install immediately, including the pid-less spawn-failure path where the
  // caller rejects before it begins waiting for the daemon's listening port.
  child.on('error', (error) => { failure = error; reportError?.(error); });
  return {
    pid: child.pid,
    onExit: (listener) => {
      child.once('exit', (code) => listener(code));
    },
    onError: (listener) => {
      reportError = listener;
      if (failure !== undefined) listener(failure);
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
  signal?: AbortSignal,
): Promise<void> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    let socket: net.Socket | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    const finish = (error?: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      socket?.destroy();
      signal?.removeEventListener('abort', onAbort);
      if (error === undefined) {
        resolve();
      } else {
        reject(error);
      }
    };
    const onAbort = (): void => {
      finish(new Error('daemon process exited before listening'));
    };
    const tryOnce = (): void => {
      if (settled) {
        return;
      }
      if (signal?.aborted === true) {
        onAbort();
        return;
      }
      socket = net.connect({ port, host });
      socket.once('connect', () => {
        finish();
      });
      socket.once('error', () => {
        if (settled) {
          return;
        }
        socket?.destroy();
        socket = undefined;
        if (Date.now() - started > timeoutMs) {
          finish(
            new Error(
              `daemon port ${String(port)} not listening after ${String(timeoutMs)}ms`,
            ),
          );
        } else {
          timer = setTimeout(tryOnce, PORT_POLL_INTERVAL_MS);
        }
      });
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    tryOnce();
  });
}

async function waitForDaemonPort(
  child: DaemonSpawnHandle,
  port: number,
  host: string,
  waitForPort: DaemonLifecycleDeps['waitForPort'],
  onExit: (code: number | null) => void,
): Promise<void> {
  const controller = new AbortController();
  let failure: Error | undefined;
  child.onExit((code) => {
    onExit(code);
    controller.abort();
  });
  child.onError?.((error) => {
    failure = error;
    controller.abort();
  });
  try {
    await waitForPort(port, host, DAEMON_LISTEN_TIMEOUT_MS, controller.signal);
  } catch (error) {
    throw failure ?? error;
  }
}

/**
 * Resolves the verified `droid daemon` process listening on a local
 * TCP port. Windows shared daemons are launched through cmd.exe, so
 * the spawn pid is only a transient wrapper and must not be used as
 * durable discovery identity.
 */
export async function resolveDaemonListenerPid(
  port: number,
  host = '127.0.0.1',
  executable = 'droid',
): Promise<number | null> {
  const pid = await queryListeningPid(port, host);
  if (pid === null) {
    return null;
  }
  const commandLine = await defaultQueryProcessCommandLine(pid);
  return commandLine !== null &&
    looksLikeDroidDaemon(commandLine, executable)
    ? pid
    : null;
}

export type DaemonListenerVerification = (
  | { readonly status: 'verified'; readonly pid: number }
  | { readonly status: 'not-listening' }
  | { readonly status: 'unverified' }
) & {
  /** Recorded PIDs now confirmed to belong to a different kind of process. */
  readonly replacedPids?: readonly number[];
};

/**
 * Verify a discovery batch using one listener-table read and one process query.
 * Results are keyed by port and carry the actual listener PID: callers must
 * compare it with their recorded PID. A missing listener is not proof that the
 * recorded worker died; an unavailable query is never reported as missing.
 * Recorded PIDs are checked in the same batch, including ports with no listener,
 * so a PID reused by another program does not keep a stale daemon record alive.
 * This snapshot is for discovery only, never authority to terminate a process.
 */
export async function verifyDaemonListeners(
  targets: readonly { readonly port: number; readonly pid: number }[],
  host = '127.0.0.1',
  executable = 'droid',
): Promise<ReadonlyMap<number, DaemonListenerVerification>> {
  const results = new Map<number, DaemonListenerVerification>();
  if (targets.length === 0) return results;
  const [command, args] = process.platform === 'win32'
    ? (['netstat.exe', ['-ano', '-p', 'tcp']] as const)
    : (['ss', ['-ltnp']] as const);
  const output = await runBoundedCommandOutput(command, args, true);
  const listeners = new Map<number, number>();
  for (const { port } of targets) {
    const pid = output === null ? 'unverified'
      : parseListeningIdentity(output, port, host, process.platform);
    if (typeof pid === 'number') listeners.set(port, pid);
    else results.set(port, { status: pid === null ? 'not-listening' : 'unverified' });
  }
  const commands = await queryProcessCommandLines([
    ...new Set([...listeners.values(), ...targets.map(({ pid }) => pid)]),
  ]);
  for (const [port, pid] of listeners) {
    const commandLine = commands?.get(pid);
    results.set(port, commandLine !== undefined && looksLikeDroidDaemon(commandLine, executable)
      ? { status: 'verified', pid } : { status: 'unverified' });
  }
  for (const { port, pid } of targets) {
    const commandLine = commands?.get(pid);
    if (commandLine === undefined || commandLine.trim() === '' ||
        looksLikeDroidDaemon(commandLine, executable)) continue;
    const verification = results.get(port)!;
    results.set(port, {
      ...verification,
      replacedPids: [...new Set([...(verification.replacedPids ?? []), pid])],
    });
  }
  return results;
}

async function queryProcessCommandLines(pids: readonly number[]): Promise<ReadonlyMap<number, string> | null> {
  // PIDs originate in the parsed system listener table or validated daemon
  // records. Neither paths nor untrusted command-line text enter the query.
  const [command, args] = process.platform === 'win32'
    ? (['powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); ' +
      'ConvertTo-Json -Compress -InputObject @(Get-CimInstance Win32_Process -ErrorAction Stop -Filter "' +
      pids.map(pid => `ProcessId=${String(pid)}`).join(' OR ') +
      '" | Select-Object ProcessId,CommandLine)']] as const)
    : (['ps', ['-p', pids.join(','), '-o', 'pid=,args=']] as const);
  const output = await runBoundedCommandOutput(command, args, true);
  if (output === null) return null;
  const commands = new Map<number, string>();
  if (process.platform !== 'win32') {
    for (const line of output.split(/\r?\n/u)) {
      const match = /^\s*(\d+)\s+(.+)$/u.exec(line);
      if (match && pids.includes(Number(match[1]))) commands.set(Number(match[1]), match[2]!);
    }
    return commands;
  }
  let rows: unknown;
  try { rows = JSON.parse(output); } catch { return null; }
  if (!Array.isArray(rows)) return null;
  for (const row of rows) {
    if (typeof row !== 'object' || row === null) return null;
    const value = row as { ProcessId?: unknown; CommandLine?: unknown };
    if (typeof value.ProcessId !== 'number' || !Number.isSafeInteger(value.ProcessId) ||
        !pids.includes(value.ProcessId)) return null;
    if (typeof value.CommandLine === 'string') commands.set(value.ProcessId, value.CommandLine);
  }
  return commands;
}

async function queryListeningPid(
  port: number,
  host: string,
): Promise<number | null> {
  const [command, args] =
    process.platform === 'win32'
      ? (['netstat.exe', ['-ano', '-p', 'tcp']] as const)
      : (['ss', ['-ltnp']] as const);
  const output = await runBoundedCommandOutput(command, args);
  return output === null
    ? null
    : parseListeningPid(output, port, host, process.platform);
}

function parseListeningPid(
  output: string,
  port: number,
  host: string,
  platform: NodeJS.Platform,
): number | null {
  const identity = parseListeningIdentity(output, port, host, platform);
  return typeof identity === 'number' ? identity : null;
}

function parseListeningIdentity(
  output: string,
  port: number,
  host: string,
  platform: NodeJS.Platform,
): number | null | 'unverified' {
  for (const line of output.split(/\r?\n/u)) {
    const columns = line.trim().split(/\s+/u);
    if (platform === 'win32') {
      if (
        columns.length < 4 ||
        columns[0]?.toUpperCase() !== 'TCP' ||
        columns[3]?.toUpperCase() !== 'LISTENING' ||
        !matchesEndpoint(columns[1] ?? '', host, port)
      ) {
        continue;
      }
      const pid = Number(columns[4]);
      if (Number.isSafeInteger(pid) && pid > 0) {
        return pid;
      }
      return 'unverified';
    }
    if (
      columns.length < 5 ||
      columns[0]?.toUpperCase() !== 'LISTEN' ||
      !matchesEndpoint(columns[3] ?? '', host, port)
    ) {
      continue;
    }
    const match = /pid=(\d+)/u.exec(columns.slice(5).join(' '));
    const pid = Number(match?.[1]);
    if (Number.isSafeInteger(pid) && pid > 0) {
      return pid;
    }
    return 'unverified';
  }
  return null;
}

function matchesEndpoint(
  endpoint: string,
  host: string,
  port: number,
): boolean {
  const separator = endpoint.lastIndexOf(':');
  if (separator < 0 || Number(endpoint.slice(separator + 1)) !== port) {
    return false;
  }
  const endpointHost = endpoint
    .slice(0, separator)
    .replace(/^\[|\]$/gu, '');
  return endpointHost === host;
}

/**
 * Reads a pid's command line without a shell: PowerShell CIM on
 * Windows (tasklist only reports the image name — always cmd.exe for
 * our shell-wrapped daemon — and wmic is removed from newer Windows
 * 11), `ps` elsewhere. Resolves null when the process is gone, the
 * query fails, or it exceeds {@link IDENTITY_QUERY_TIMEOUT_MS}.
 */
function defaultQueryProcessCommandLine(pid: number): Promise<string | null> {
  const [command, args] =
    process.platform === 'win32'
      ? ([
          'powershell.exe',
          [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            `(Get-CimInstance Win32_Process -Filter "ProcessId=${String(pid)}").CommandLine`,
          ],
        ] as const)
      : (['ps', ['-p', String(pid), '-o', 'args=']] as const);
  return runBoundedCommandOutput(command, args);
}

function runBoundedCommandOutput(
  command: string,
  args: readonly string[],
  completeSnapshot = false,
): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (value: string | null): void => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(value);
      }
    };

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(command, [...args], {
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true,
      });
    } catch {
      finish(null);
      return;
    }
    timer = setTimeout(() => {
      child.kill();
      finish(null);
    }, IDENTITY_QUERY_TIMEOUT_MS);

    let output = '';
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      if (settled) {
        return;
      }
      output += chunk;
      if (output.length > IDENTITY_QUERY_OUTPUT_MAX_CHARS) {
        child.kill();
        finish(null);
      }
    });
    child.once('error', () => {
      finish(null);
    });
    // Batch JSON may span stdout chunks after the child exit event. Snapshot
    // callers require fully closed stdio and a successful system query.
    child.once(completeSnapshot ? 'close' : 'exit', (code: number | null) => {
      const trimmed = output.trim();
      finish((completeSnapshot && code !== 0) || trimmed === '' ? null : trimmed);
    });
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
