import * as vscode from 'vscode';
import {
  MODEL_MANAGER_VERSION,
  parseModelsRequest,
  type ModelsHostMessage,
  type ModelsRequest,
} from '../../shared/protocol/modelManagerProtocol';
import { getWebviewHtml } from '../webview/webviewHtml';
import { handleWebviewClipboard } from '../webview/webviewClipboard';
import { readWebviewBootTheme } from '../webview/webviewTheme';
import { ModelManager, ModelManagerError, modelManagerFailure } from './ModelManager';

interface PanelEntry {
  readonly panel: vscode.WebviewPanel;
  readonly subscriptions: vscode.Disposable[];
  operation: AbortController | null;
}

export class ModelsPanelController implements vscode.Disposable {
  private entry: PanelEntry | null = null;
  private disposed = false;
  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly manager: ModelManager,
  ) {}

  open(): void {
    if (this.disposed) return;
    if (this.entry !== null) {
      this.entry.panel.reveal();
      return;
    }
    const dist = vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview');
    const panel = vscode.window.createWebviewPanel(
      'droidvisx.models',
      'Models',
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [dist] },
    );
    const entry: PanelEntry = { panel, subscriptions: [], operation: null };
    this.entry = entry;
    const theme = (): void =>
      this.post(entry, {
        type: 'models.theme',
        version: MODEL_MANAGER_VERSION,
        resolved: readWebviewBootTheme().resolved,
      });
    entry.subscriptions.push(
      panel.webview.onDidReceiveMessage((value: unknown) => {
        if (handleWebviewClipboard(value, panel.webview)) return;
        const request = parseModelsRequest(value);
        if (request === undefined) return;
        theme();
        if (request.action.kind === 'cancel') {
          entry.operation?.abort();
          return;
        }
        void this.run(entry, request);
      }),
      panel.onDidDispose(() => {
        entry.operation?.abort();
        for (const subscription of entry.subscriptions) subscription.dispose();
        if (this.entry === entry) this.entry = null;
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('droidvisx.theme')) theme();
      }),
      vscode.window.onDidChangeActiveColorTheme(theme),
      panel.onDidChangeViewState(() => {
        if (panel.visible) theme();
      }),
    );
    panel.webview.html = getWebviewHtml(
      panel.webview,
      {
        script: vscode.Uri.joinPath(dist, 'models.js'),
        style: vscode.Uri.joinPath(dist, 'webview.css'),
      },
      undefined,
      readWebviewBootTheme(),
    );
  }

  private async run(entry: PanelEntry, request: ModelsRequest): Promise<void> {
    if (entry.operation !== null) {
      this.post(entry, {
        type: 'models.result',
        version: MODEL_MANAGER_VERSION,
        requestId: request.requestId,
        ok: false,
        message: 'Another model operation is still running.',
      });
      return;
    }
    const abort = new AbortController();
    entry.operation = abort;
    let result: Extract<ModelsHostMessage, { type: 'models.result' }>;
    try {
      // Destructive changes and billable verification require a native,
      // explicit confirmation naming the exact saved Model ID.
      const action = request.action;
      if (
        action.kind === 'verifyModel' ||
        action.kind === 'deleteModel' ||
        action.kind === 'deleteConnection'
      ) {
        const label = action.kind === 'verifyModel' ? 'Verify' : 'Delete';
        const detail =
          action.kind === 'verifyModel'
            ? `Send one real Droid request to "${action.expectedModel}"? This may incur provider charges. The test uses an empty directory and no chat history. Droid user-level configuration still applies.`
            : action.kind === 'deleteModel'
              ? `Remove "${action.expectedModel}" from Droid settings?`
              : 'Remove this empty connection? Models will not be deleted.';
        const confirmed = await vscode.window.showWarningMessage(
          detail,
          { modal: true },
          label,
        );
        if (confirmed !== label) {
          throw new ModelManagerError('Cancelled. No operation was started.');
        }
      }
      const outcome = await this.manager.execute(request.action, abort.signal);
      result = {
        type: 'models.result',
        version: MODEL_MANAGER_VERSION,
        requestId: request.requestId,
        ok: true,
        ...outcome,
      };
    } catch (error) {
      result = {
        type: 'models.result',
        version: MODEL_MANAGER_VERSION,
        requestId: request.requestId,
        ok: false,
        message: abort.signal.aborted
          ? 'Cancelled. Refresh to check any changes already saved.'
          : modelManagerFailure(error),
      };
    }
    try {
      const snapshot = await this.manager.snapshot();
      this.post(entry, {
        type: 'models.snapshot',
        version: MODEL_MANAGER_VERSION,
        snapshot,
      });
    } catch {
      result = {
        ...result,
        message: `${result.message} The current catalog could not be read; refresh before retrying.`,
      };
    } finally {
      if (entry.operation === abort) entry.operation = null;
    }
    this.post(entry, result);
  }

  private post(entry: PanelEntry, message: ModelsHostMessage): void {
    if (this.entry !== entry || this.disposed) return;
    void entry.panel.webview.postMessage(message).then(
      () => undefined,
      () => undefined,
    );
  }

  dispose(): void {
    this.disposed = true;
    this.entry?.panel.dispose();
  }
}
