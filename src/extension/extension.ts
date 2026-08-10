import * as vscode from 'vscode';

import { FactoryDroidRuntime } from '../runtime/FactoryDroidRuntime';
import { FactorySessionCatalog } from '../runtime/FactorySessionCatalog';
import { FactorySessionHistoryLoader } from '../runtime/history/FactorySessionHistoryLoader';
import { ChatController } from './ChatController';
import { DroidViewProvider } from './DroidViewProvider';
import {
  SessionRecoveryStore,
  type SessionRecoveryPersistence,
} from './SessionRecoveryStore';

const focusViewCommand = 'droidvisx.focusView';
let activeController: ChatController | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const persistence: SessionRecoveryPersistence = {
    get: <T>(key: string) => context.workspaceState.get<T>(key),
    update: (key: string, value: unknown) =>
      context.workspaceState.update(key, value),
  };
  const controller = new ChatController(
    (interactionHandler) =>
      new FactoryDroidRuntime({ interactionHandler }),
    () => ({
      cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null,
      trusted: vscode.workspace.isTrusted,
    }),
    new FactorySessionCatalog(),
    new SessionRecoveryStore(persistence),
    new FactorySessionHistoryLoader(),
  );
  const provider = new DroidViewProvider(
    context.extensionUri,
    controller,
  );
  activeController = controller;

  context.subscriptions.push(
    controller,
    provider,
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
  );
}

export async function deactivate(): Promise<void> {
  const controller = activeController;
  activeController = undefined;
  await controller?.dispose();
}
