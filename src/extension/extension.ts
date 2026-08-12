import * as vscode from 'vscode';

import { FactoryDroidRuntime } from '../runtime/FactoryDroidRuntime';
import { FactorySessionCatalog } from '../runtime/FactorySessionCatalog';
import { FactorySessionHistoryLoader } from '../runtime/history/FactorySessionHistoryLoader';
import {
  ensurePrivateDaemon,
  startDetachedDaemon,
  stopDaemon,
  type DaemonEndpoint,
} from '../runtime/daemon/daemonLifecycle';
import {
  openDaemonConnection,
  type DaemonConnection,
} from '../runtime/daemon/daemonConnection';
import { DaemonPluginCatalog } from '../runtime/daemon/DaemonPluginCatalog';
import { DaemonSessionCatalog } from '../runtime/daemon/DaemonSessionCatalog';
import {
  createDaemonSessionFactory,
  type SessionLeaseHooks,
} from '../runtime/daemon/createDaemonDroidSession';
import {
  defaultDiscoveryFile,
  ensureSharedDaemon,
  shutdownSharedDaemon,
} from '../runtime/daemon/daemonDiscovery';
import {
  acquireSessionLease,
  defaultLeaseFile,
  releaseSessionLease,
} from '../runtime/daemon/sessionLease';
import { ChatController } from './ChatController';
import { DroidViewProvider } from './DroidViewProvider';
import { exportDiagnosticsBundle } from './exportDiagnostics';
import { LocalDiagnostics } from './LocalDiagnostics';
import {
  SESSION_RECOVERY_STORAGE_KEY,
  SessionRecoveryStore,
  type SessionRecoveryPersistence,
} from './SessionRecoveryStore';
import {
  exportActiveSessionAsMarkdown,
  readPersistedSelectedSessionId,
} from './sessionExporter';
import { RecentCommandsStore } from './RecentCommandsStore';
import { createGitChangeStatsReader } from './changeStats';
import { createVscodeAttachmentSources } from './vscodeAttachmentSources';
import { createVscodeExternalUrlOpener } from './vscodeExternalUrlOpener';
import { createVscodeFileDiffOpener } from './vscodeFileDiff';
import { createVscodePathOpener } from './vscodePathOpener';
import { PreviewPanelController } from './PreviewPanelController';
import { createVscodeGitWorkflow } from './vscodeGitWorkflow';
import { createWorktreeSessionsFeature } from './worktreeSessions';
import { createTerminalMirror } from './terminalMirror';

const focusViewCommand = 'droidvisx.focusView';
const openLogsCommand = 'droidvisx.openLogs';
const exportDiagnosticsCommand = 'droidvisx.exportDiagnostics';
const shutdownDaemonCommand = 'droidvisx.shutdownDaemon';
const exportSessionCommand = 'droidvisx.exportSessionMarkdown';
let activeController: ChatController | undefined;
let disposeDaemonSidecar: (() => Promise<void>) | undefined;

interface DaemonSidecar {
  readonly endpoint: DaemonEndpoint;
  readonly connection: DaemonConnection;
  readonly catalog: DaemonSessionCatalog;
}

type DiagnosticsSink = {
  record(event: {
    level: 'info' | 'warn' | 'error';
    name: string;
    attributes?: Record<string, string | number | boolean>;
    /** Free text; the sink credential-scrubs it before persisting. */
    detail?: string;
  }): void;
};

/**
 * How the daemon sidecar spawns and reaps its daemon.
 *
 * - `private`: a per-window `droid daemon` bound to this extension
 *   host's pid (daemon Phase 1). It dies with the window, so disposal
 *   reaps it and reconnect failures respawn it.
 * - `shared`: the detached, discovery-file-registered daemon that
 *   survives window reloads (daemon Phase 3). Disposal leaves it
 *   running; only `droidvisx.shutdownDaemon` reaps it.
 */
interface DaemonLifecycleStrategy {
  start(): Promise<DaemonEndpoint>;
  /** Reap a specific endpoint after a fatal connection failure. */
  reapOnFailure(endpoint: DaemonEndpoint): Promise<void>;
  /** Reap on extension deactivation (no-op for the shared daemon). */
  reapOnDispose(endpoint: DaemonEndpoint): Promise<void>;
}

function createPrivateDaemonStrategy(): DaemonLifecycleStrategy {
  return {
    start: () => ensurePrivateDaemon(),
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
      const shared = await ensureSharedDaemon(discoveryFile, {
        startDaemon: () => startDetachedDaemon(),
        checkHealth: (url) => healthCheckDaemon(url),
      });
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
      return { url: shared.url, pid: shared.pid };
    },
    // A shared daemon must survive reconnect failures and disposal; a
    // stale discovery record is cleared by the next `ensureSharedDaemon`
    // health check, and `droidvisx.shutdownDaemon` handles teardown.
    reapOnFailure: () => Promise.resolve(),
    reapOnDispose: () => Promise.resolve(),
  };
}

/** Confirms a daemon answers an authenticated read-only RPC. */
async function healthCheckDaemon(url: string): Promise<boolean> {
  try {
    const connection = await openDaemonConnection({ url });
    try {
      await connection.droid.sessions.list({ limit: 1 });
      return connection.status() === 'connected';
    } finally {
      connection.dispose();
    }
  } catch {
    return false;
  }
}

/**
 * Lazy, memoized daemon sidecar for the read-only archive/search path
 * (Phase 1) and, in daemon runtime mode, the shared execution daemon
 * (Phase 3). Nothing is spawned until the first daemon feature is
 * used.
 */
function createDaemonSidecar(
  diagnostics: DiagnosticsSink,
  strategy: DaemonLifecycleStrategy,
): {
  provider: () => Promise<DaemonSessionCatalog>;
  droid: () => Promise<DaemonConnection['droid']>;
  plugins: () => Promise<DaemonPluginCatalog>;
  dispose: () => Promise<void>;
} {
  let sidecar: Promise<DaemonSidecar> | null = null;

  const start = async (): Promise<DaemonSidecar> => {
    // Both failure phases are logged: a silent start failure used to
    // surface only as "unavailable" copy with zero log evidence.
    let endpoint: DaemonEndpoint;
    try {
      endpoint = await strategy.start();
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
      const connection = await openDaemonConnection(endpoint);
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
      await strategy.reapOnFailure(endpoint);
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
    // Token expiry or transport loss: reconnect to the same daemon
    // with a freshly read credential. If that also fails, drop the
    // sidecar so the next call re-acquires the daemon.
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
        await strategy.reapOnFailure(current.endpoint);
        throw error;
      },
    );
    return sidecar;
  };

  return {
    provider: async () => (await acquire()).catalog,
    droid: async () => (await acquire()).connection.droid,
    plugins: async () =>
      new DaemonPluginCatalog((await acquire()).connection.droid),
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
 * File-backed cross-window session leases (daemon Phase 3). Guards the
 * shared daemon's uncoordinated replacement operations so two windows
 * never attach the same session.
 */
function createSessionLeaseHooks(): SessionLeaseHooks {
  const leaseFile = defaultLeaseFile();
  return {
    acquire: (sessionId) => acquireSessionLease(leaseFile, sessionId),
    release: (sessionId) => {
      releaseSessionLease(leaseFile, sessionId);
    },
  };
}

export function activate(context: vscode.ExtensionContext): void {
  // globalStorage survives Cursor's per-boot log directory cleanup and
  // aggregates all windows into one per-day file set.
  const logDirectory = vscode.Uri.joinPath(
    context.globalStorageUri,
    'logs',
  ).fsPath;
  const diagnostics = new LocalDiagnostics({
    directory: logDirectory,
    output: vscode.window.createOutputChannel('DroidVisX Logs'),
    workspace: () =>
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null,
  });
  diagnostics.record({
    level: 'info',
    name: 'extension.activated',
    attributes: {
      extensionVersion:
        (context.extension.packageJSON as { version?: string })
          .version ?? 'unknown',
      appName: vscode.env.appName,
      vscodeVersion: vscode.version,
    },
  });
  const persistence: SessionRecoveryPersistence = {
    get: <T>(key: string) => context.workspaceState.get<T>(key),
    update: (key: string, value: unknown) =>
      context.workspaceState.update(key, value),
  };
  const attachmentSources = createVscodeAttachmentSources();
  // Read once at activation: switching modes requires a window reload,
  // which also guarantees a clean fallback to process mode.
  const runtimeMode = vscode.workspace
    .getConfiguration('droidvisx')
    .get<'process' | 'daemon'>('runtime.mode', 'process');
  diagnostics.record({
    level: 'info',
    name: 'runtime.mode',
    attributes: { mode: runtimeMode },
  });
  // Daemon mode needs the shared detached daemon so sessions survive a
  // window reload (Phase 3); the read-only archive/search sidecar in
  // process mode keeps the parent-pid private daemon (Phase 1).
  const daemonSidecar = createDaemonSidecar(
    diagnostics,
    runtimeMode === 'daemon'
      ? createSharedDaemonStrategy(diagnostics)
      : createPrivateDaemonStrategy(),
  );
  disposeDaemonSidecar = daemonSidecar.dispose;
  // Shared with the export command, which reads the same recovery
  // store, catalog, and history loader the controller uses.
  const recoveryStore = new SessionRecoveryStore(persistence);
  const sessionCatalog = new FactorySessionCatalog();
  const historyLoader = new FactorySessionHistoryLoader({ diagnostics });
  const previewController = new PreviewPanelController(diagnostics);
  // Read-only terminal mirror of execute-command output; takeover is
  // fail-closed by design (native-terminal design slice A).
  const terminalMirror = createTerminalMirror({
    createTerminal: (name, pty) =>
      vscode.window.createTerminal({ name, pty }),
  });
  const controller = new ChatController(
    (interactionHandler) =>
      new FactoryDroidRuntime({
        interactionHandler,
        diagnostics,
        observability: diagnostics.observability,
        ...(runtimeMode === 'daemon'
          ? {
              createSdkSession: createDaemonSessionFactory(
                daemonSidecar.droid,
                createSessionLeaseHooks(),
              ),
            }
          : {}),
      }),
    () => ({
      cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null,
      trusted: vscode.workspace.isTrusted,
    }),
    sessionCatalog,
    recoveryStore,
    historyLoader,
    attachmentSources,
    createVscodeFileDiffOpener(),
    createGitChangeStatsReader(
      () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
    ),
    createVscodeExternalUrlOpener(),
    new RecentCommandsStore(persistence),
    diagnostics,
    daemonSidecar.provider,
    createVscodePathOpener(),
    previewController,
    createVscodeGitWorkflow(),
    // Worktree sessions ride the daemon's native create channel; in
    // process mode the feature stays disabled and the drawer entry
    // never renders.
    createWorktreeSessionsFeature({
      enabled: runtimeMode === 'daemon',
      persistence,
    }),
    terminalMirror,
    daemonSidecar.plugins,
  );
  const provider = new DroidViewProvider(
    context.extensionUri,
    controller,
    diagnostics,
  );
  activeController = controller;

  context.subscriptions.push(
    controller,
    provider,
    previewController,
    terminalMirror,
    diagnostics,
    attachmentSources,
    vscode.window.registerWebviewViewProvider(
      DroidViewProvider.viewType,
      provider,
      // Keep the chat iframe alive across tab switches: without
      // retention every switch-back pays a full webview reboot
      // (boot ~1.1s + re-render ~1.2s measured), which is why the
      // sidebar felt heavy next to instant chat surfaces. The chat
      // state (transcript, composer, scroll) cannot be quickly
      // saved and restored, which is the documented case for
      // retainContextWhenHidden's memory cost.
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      controller.handleWorkspaceContextChanged();
    }),
    vscode.workspace.onDidGrantWorkspaceTrust(() => {
      controller.handleWorkspaceContextChanged();
    }),
    vscode.commands.registerCommand(focusViewCommand, async () => {
      await vscode.commands.executeCommand(
        `${DroidViewProvider.viewType}.focus`,
      );
    }),
    vscode.commands.registerCommand(openLogsCommand, () => {
      diagnostics.record({
        level: 'info',
        name: 'diagnostics.opened',
      });
      diagnostics.show();
    }),
    vscode.commands.registerCommand(shutdownDaemonCommand, async () => {
      // The shared daemon has no shutdown RPC and survives reloads on
      // purpose, so this terminates the discovered pid directly and
      // clears the discovery file. Live windows re-spawn on next use.
      const stopped = await shutdownSharedDaemon(defaultDiscoveryFile());
      diagnostics.record({
        level: 'info',
        name: 'daemon.shutdown.requested',
        attributes: { stopped },
      });
      void vscode.window.showInformationMessage(
        stopped
          ? 'DroidVisX daemon stopped. Reload the window to start a fresh one.'
          : 'No running DroidVisX daemon was found.',
      );
    }),
    vscode.commands.registerCommand(exportSessionCommand, () =>
      exportActiveSessionAsMarkdown({
        getActiveSessionId: () =>
          recoveryStore.getSelectedSessionId() ??
          readPersistedSelectedSessionId(
            persistence.get(SESSION_RECOVERY_STORAGE_KEY),
          ),
        getWorkspaceCwd: () =>
          vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null,
        loadHistory: (request) => historyLoader.loadHistory(request),
        listSessions: (cwd) => sessionCatalog.listSessions(cwd),
        diagnostics,
      }),
    ),
    vscode.commands.registerCommand(
      exportDiagnosticsCommand,
      async () => {
        diagnostics.record({
          level: 'info',
          name: 'diagnostics.exported',
        });
        await diagnostics.flush();
        try {
          await exportDiagnosticsBundle(context, logDirectory);
        } catch (error) {
          diagnostics.record({
            level: 'error',
            name: 'diagnostics.export-failed',
            detail:
              error instanceof Error
                ? (error.stack ?? error.message)
                : String(error),
          });
          void vscode.window.showErrorMessage(
            'DroidVisX diagnostics export failed. See DroidVisX Logs.',
          );
        }
      },
    ),
  );
}

export async function deactivate(): Promise<void> {
  const controller = activeController;
  const disposeSidecar = disposeDaemonSidecar;
  activeController = undefined;
  disposeDaemonSidecar = undefined;
  await controller?.dispose();
  await disposeSidecar?.();
}
