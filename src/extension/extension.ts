import * as vscode from 'vscode';

import { FactoryDroidRuntime } from '../runtime/FactoryDroidRuntime';
import { FactorySessionCatalog } from '../runtime/FactorySessionCatalog';
import { FactorySessionHistoryLoader } from '../runtime/history/FactorySessionHistoryLoader';
import { ChatController } from './ChatController';
import { DroidViewProvider } from './DroidViewProvider';
import { LocalDiagnostics } from './LocalDiagnostics';
import {
  SessionRecoveryStore,
  type SessionRecoveryPersistence,
} from './SessionRecoveryStore';
import { createGitChangeStatsReader } from './changeStats';
import { createVscodeAttachmentSources } from './vscodeAttachmentSources';
import { createVscodeExternalUrlOpener } from './vscodeExternalUrlOpener';
import { createVscodeFileDiffOpener } from './vscodeFileDiff';

const focusViewCommand = 'droidvisx.focusView';
const openLogsCommand = 'droidvisx.openLogs';
let activeController: ChatController | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const diagnostics = new LocalDiagnostics({
    directory: context.logUri.fsPath,
    output: vscode.window.createOutputChannel('DroidVisX Logs'),
  });
  diagnostics.record({
    level: 'info',
    name: 'extension.activated',
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
  );
}

export async function deactivate(): Promise<void> {
  const controller = activeController;
  activeController = undefined;
  await controller?.dispose();
}
