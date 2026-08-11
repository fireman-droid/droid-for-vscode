import * as vscode from 'vscode';

import { FactoryDroidRuntime } from '../runtime/FactoryDroidRuntime';
import { FactorySessionCatalog } from '../runtime/FactorySessionCatalog';
import { FactorySessionHistoryLoader } from '../runtime/history/FactorySessionHistoryLoader';
import {
  ensurePrivateDaemon,
  stopDaemon,
  type DaemonEndpoint,
} from '../runtime/daemon/daemonLifecycle';
import {
  openDaemonConnection,
  type DaemonConnection,
} from '../runtime/daemon/daemonConnection';
import { DaemonSessionCatalog } from '../runtime/daemon/DaemonSessionCatalog';
import { ChatController } from './ChatController';
import { DroidViewProvider } from './DroidViewProvider';
import { exportDiagnosticsBundle } from './exportDiagnostics';
import { LocalDiagnostics } from './LocalDiagnostics';
import {
  SessionRecoveryStore,
  type SessionRecoveryPersistence,
} from './SessionRecoveryStore';
import { RecentCommandsStore } from './RecentCommandsStore';
import { createGitChangeStatsReader } from './changeStats';
import { createVscodeAttachmentSources } from './vscodeAttachmentSources';
import { createVscodeExternalUrlOpener } from './vscodeExternalUrlOpener';
import { createVscodeFileDiffOpener } from './vscodeFileDiff';

const focusViewCommand = 'droidvisx.focusView';
const openLogsCommand = 'droidvisx.openLogs';
const exportDiagnosticsCommand = 'droidvisx.exportDiagnostics';
let activeController: ChatController | undefined;
let disposeDaemonSidecar: (() => Promise<void>) | undefined;

interface DaemonSidecar {
  readonly endpoint: DaemonEndpoint;
  readonly connection: DaemonConnection;
  readonly catalog: DaemonSessionCatalog;
}

/**
 * Lazy, memoized daemon sidecar for the read-only archive/search
 * path (daemon Phase 1). Nothing is spawned until the first daemon
 * feature is used. The private daemon is parent-pid guarded, so it
 * dies with the extension host even if disposal never runs.
 */
function createDaemonSidecar(diagnostics: {
  record(event: {
    level: 'info' | 'warn';
    name: string;
    attributes?: Record<string, string | number | boolean>;
  }): void;
}): {
  provider: () => Promise<DaemonSessionCatalog>;
  dispose: () => Promise<void>;
} {
  let sidecar: Promise<DaemonSidecar> | null = null;

  const start = async (): Promise<DaemonSidecar> => {
    const endpoint = await ensurePrivateDaemon();
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
      await stopDaemon(endpoint);
      throw error;
    }
  };

  return {
    provider: async () => {
      if (sidecar === null) {
        sidecar = start().catch((error: unknown) => {
          sidecar = null;
          throw error;
        });
      }
      const current = await sidecar;
      if (current.connection.status() === 'connected') {
        return current.catalog;
      }
      // Token expiry or transport loss: reconnect to the same daemon
      // with a freshly read credential. If that also fails, drop the
      // sidecar so the next call respawns the daemon.
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
          await stopDaemon(current.endpoint);
          throw error;
        },
      );
      return (await sidecar).catalog;
    },
    dispose: async () => {
      const pending = sidecar;
      sidecar = null;
      if (pending === null) {
        return;
      }
      try {
        const current = await pending;
        current.connection.dispose();
        await stopDaemon(current.endpoint);
      } catch {
        // Startup already failed; nothing left to clean up.
      }
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
  const daemonSidecar = createDaemonSidecar(diagnostics);
  disposeDaemonSidecar = daemonSidecar.dispose;
  const controller = new ChatController(
    (interactionHandler) =>
      new FactoryDroidRuntime({
        interactionHandler,
        diagnostics,
        observability: diagnostics.observability,
      }),
    () => ({
      cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null,
      trusted: vscode.workspace.isTrusted,
    }),
    new FactorySessionCatalog(),
    new SessionRecoveryStore(persistence),
    new FactorySessionHistoryLoader(),
    attachmentSources,
    createVscodeFileDiffOpener(),
    createGitChangeStatsReader(
      () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
    ),
    createVscodeExternalUrlOpener(),
    new RecentCommandsStore(persistence),
    diagnostics,
    daemonSidecar.provider,
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
    diagnostics,
    attachmentSources,
    vscode.window.registerWebviewViewProvider(
      DroidViewProvider.viewType,
      provider,
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
