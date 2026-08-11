import * as vscode from 'vscode';

import { FactoryDroidRuntime } from '../runtime/FactoryDroidRuntime';
import { FactorySessionCatalog } from '../runtime/FactorySessionCatalog';
import { FactorySessionHistoryLoader } from '../runtime/history/FactorySessionHistoryLoader';
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
  activeController = undefined;
  await controller?.dispose();
}
