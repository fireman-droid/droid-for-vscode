import type { DaemonApi } from '../../runtime/daemon/api';

import {
  ensurePrivateDaemon,
  resolveDaemonListenerPid,
  startDetachedDaemon,
  stopDaemon,
  type DaemonEndpoint,
} from '../../runtime/daemon/daemonLifecycle';
import {
  DaemonAvailabilityError,
  openDaemonConnection,
  type DaemonConnection,
} from '../../runtime/daemon/daemonConnection';
import {
  defaultDiscoveryFile,
  ensureSharedDaemon,
  shutdownSharedDaemon,
} from '../../runtime/daemon/daemonDiscovery';
import { DaemonPluginCatalog } from '../../runtime/daemon/DaemonPluginCatalog';
import { DaemonSessionCatalog } from '../../runtime/daemon/DaemonSessionCatalog';

const DAEMON_WARM_RETRY_DELAY_MS = 1_000;

export type DiagnosticsSink = {
  record(event: {
    level: 'info' | 'warn' | 'error';
    name: string;
    attributes?: Record<string, string | number | boolean>;
    detail?: string;
  }): void;
};

interface DaemonSidecar {
  readonly endpoint: DaemonEndpoint;
  readonly connection: DaemonConnection;
  readonly catalog: DaemonSessionCatalog;
}

interface DaemonLifecycleStrategy {
  start(): Promise<{
    readonly endpoint: DaemonEndpoint;
    readonly connection?: DaemonConnection;
  }>;
  reapOnFailure(endpoint: DaemonEndpoint, error: unknown): Promise<void>;
  reapOnDispose(endpoint: DaemonEndpoint): Promise<void>;
}

export interface DaemonSidecarController {
  provider(): Promise<DaemonSessionCatalog>;
  droid(): Promise<DaemonApi>;
  plugins(): Promise<DaemonPluginCatalog>;
  dispose(): Promise<void>;
}

const resolveSharedDaemonListener = (
  port: number,
  host: string,
): Promise<number | null> => resolveDaemonListenerPid(port, host);

const killVerifiedSharedDaemon = (pid: number): Promise<void> =>
  stopDaemon({ url: '', pid, executable: 'droid' });

export async function shutdownSharedDroidVisxDaemon(): Promise<boolean> {
  return shutdownSharedDaemon(defaultDiscoveryFile(), {
    resolveListenerPid: resolveSharedDaemonListener,
    killProcessTree: killVerifiedSharedDaemon,
  });
}

function createPrivateDaemonStrategy(): DaemonLifecycleStrategy {
  return {
    start: async () => ({ endpoint: await ensurePrivateDaemon() }),
    reapOnFailure: (endpoint) => stopDaemon(endpoint),
    reapOnDispose: (endpoint) => stopDaemon(endpoint),
  };
}

function createSharedDaemonStrategy(
  diagnostics: DiagnosticsSink,
): DaemonLifecycleStrategy {
  const discoveryFile = defaultDiscoveryFile();
  return {
    start: async () => {
      let healthyConnection: DaemonConnection | undefined;
      try {
        const shared = await ensureSharedDaemon(discoveryFile, {
          startDaemon: () => startDetachedDaemon(),
          checkHealth: async (url) => {
            const health = await healthCheckDaemon(url);
            healthyConnection?.dispose();
            healthyConnection = health.connection;
            return health.status;
          },
          resolveListenerPid: resolveSharedDaemonListener,
          killProcessTree: killVerifiedSharedDaemon,
        });
        if (shared.spawned && healthyConnection !== undefined) {
          healthyConnection.dispose();
          healthyConnection = undefined;
        }
        diagnostics.record({
          level: 'info',
          name: 'daemon.shared.acquired',
          attributes: {
            url: shared.url,
            pid: shared.pid,
            spawned: shared.spawned,
            versionMismatch: shared.versionMismatch,
          },
        });
        return {
          endpoint: { url: shared.url, pid: shared.pid },
          ...(healthyConnection === undefined ? {} : { connection: healthyConnection }),
        };
      } catch (error) {
        healthyConnection?.dispose();
        throw error;
      }
    },
    reapOnFailure: async (_endpoint, error) => {
      if (error instanceof DaemonAvailabilityError && error.reason !== 'connect-failed') {
        return;
      }
      await shutdownSharedDaemon(discoveryFile, {
        resolveListenerPid: resolveSharedDaemonListener,
        killProcessTree: killVerifiedSharedDaemon,
      });
    },
    reapOnDispose: () => Promise.resolve(),
  };
}

async function healthCheckDaemon(url: string): Promise<{
  readonly status: 'healthy' | 'authentication-failed' | 'unreachable';
  readonly connection?: DaemonConnection;
}> {
  try {
    const connection = await openDaemonConnection({ url });
    try {
      await connection.droid.sessions.list({ limit: 1 });
      if (connection.status() === 'connected') {
        return { status: 'healthy', connection };
      }
      connection.dispose();
      return { status: 'authentication-failed' };
    } catch {
      connection.dispose();
      return { status: 'unreachable' };
    }
  } catch (error) {
    return {
      status:
        error instanceof DaemonAvailabilityError && error.reason !== 'connect-failed'
          ? 'authentication-failed'
          : 'unreachable',
    };
  }
}

/**
 * Memoized daemon sidecar. Daemon mode uses one shared detached daemon;
 * process mode keeps the existing parent-pid-guarded private daemon.
 */
export function createDaemonSidecar(
  diagnostics: DiagnosticsSink,
  runtimeMode: 'process' | 'daemon',
): DaemonSidecarController {
  const strategy =
    runtimeMode === 'daemon'
      ? createSharedDaemonStrategy(diagnostics)
      : createPrivateDaemonStrategy();
  let sidecar: Promise<DaemonSidecar> | null = null;

  const start = async (): Promise<DaemonSidecar> => {
    let endpoint: DaemonEndpoint;
    let existingConnection: DaemonConnection | undefined;
    try {
      const started = await strategy.start();
      endpoint = started.endpoint;
      existingConnection = started.connection;
    } catch (error) {
      diagnostics.record({
        level: 'error',
        name: 'daemon.sidecar.start-failed',
        attributes: { phase: 'spawn' },
        detail: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
    try {
      const connection = existingConnection ?? (await openDaemonConnection(endpoint));
      diagnostics.record({
        level: 'info',
        name: 'daemon.sidecar.connected',
        attributes: { url: endpoint.url, pid: endpoint.pid },
      });
      return {
        endpoint,
        connection,
        catalog: new DaemonSessionCatalog(connection.droid),
      };
    } catch (error) {
      existingConnection?.dispose();
      diagnostics.record({
        level: 'error',
        name: 'daemon.sidecar.start-failed',
        attributes: {
          phase: 'connect',
          url: endpoint.url,
          pid: endpoint.pid,
        },
        detail: error instanceof Error ? error.message : String(error),
      });
      await strategy.reapOnFailure(endpoint, error);
      throw error;
    }
  };

  const acquire = async (): Promise<DaemonSidecar> => {
    if (sidecar === null) {
      sidecar = start().catch((error: unknown) => {
        sidecar = null;
        throw error;
      });
    }
    const current = await sidecar;
    if (current.connection.status() === 'connected') {
      return current;
    }
    diagnostics.record({
      level: 'warn',
      name: 'daemon.sidecar.reconnecting',
    });
    current.connection.dispose();
    sidecar = openDaemonConnection(current.endpoint).then(
      (connection) => ({
        endpoint: current.endpoint,
        connection,
        catalog: new DaemonSessionCatalog(connection.droid),
      }),
      async (error: unknown) => {
        sidecar = null;
        await strategy.reapOnFailure(current.endpoint, error);
        throw error;
      },
    );
    return sidecar;
  };

  return {
    provider: async () => (await acquire()).catalog,
    droid: async () => (await acquire()).connection.droid,
    plugins: async () => new DaemonPluginCatalog((await acquire()).connection.droid),
    dispose: async () => {
      const pending = sidecar;
      sidecar = null;
      if (pending === null) {
        return;
      }
      try {
        const current = await pending;
        current.connection.dispose();
        await strategy.reapOnDispose(current.endpoint);
      } catch {
        // Startup already failed; nothing left to clean up.
      }
    },
  };
}

/**
 * Starts daemon acquisition during extension activation. A single delayed
 * retry covers transient CLI starts without turning background work into a
 * perpetual restart loop.
 */
export function warmDaemonSidecar(
  sidecar: Pick<DaemonSidecarController, 'droid'>,
  diagnostics: DiagnosticsSink,
): () => void {
  let cancelled = false;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  const warm = (attempt: 1 | 2): void => {
    void sidecar.droid().then(
      () => {
        if (!cancelled) {
          diagnostics.record({
            level: 'info',
            name: 'daemon.sidecar.warmed',
            attributes: { attempt },
          });
        }
      },
      () => {
        if (cancelled) {
          return;
        }
        diagnostics.record({
          level: 'warn',
          name: 'daemon.sidecar.warm-failed',
          attributes: { attempt },
        });
        if (attempt === 1) {
          retryTimer = setTimeout(() => {
            retryTimer = undefined;
            warm(2);
          }, DAEMON_WARM_RETRY_DELAY_MS);
        }
      },
    );
  };
  warm(1);
  return () => {
    cancelled = true;
    if (retryTimer !== undefined) {
      clearTimeout(retryTimer);
    }
  };
}
