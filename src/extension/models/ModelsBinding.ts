import * as vscode from 'vscode';
import { MODEL_MANAGER_VERSION, parseModelsRequest, type ModelsHostMessage, type ModelsRequest } from '../../shared/protocol/modelManagerProtocol';
import { handleWebviewClipboard } from '../webview/webviewClipboard';
import { readWebviewBootTheme } from '../webview/webviewTheme';
import { bindWebviewLocale } from '../webview/webviewLocale';
import { createModelSourcePreference } from '../webview/modelSourcePreference';
import { ModelManager, ModelManagerError, modelManagerFailure } from './ModelManager';

/** One transport owns its operations; editor and browser use the same handlers. */
export class ModelsBinding implements vscode.Disposable {
  private disposed = false;
  private operation: AbortController | null = null;
  private readonly subscriptions: vscode.Disposable[];
  constructor(private readonly webview: Pick<vscode.Webview, 'postMessage' | 'onDidReceiveMessage'>,
    private readonly manager: ModelManager) {
    const modelSourcePreference = createModelSourcePreference(webview);
    this.subscriptions = [
      modelSourcePreference, bindWebviewLocale(webview),
      webview.onDidReceiveMessage((value: unknown) => {
        if (modelSourcePreference.handleMessage(value)) return;
        if (handleWebviewClipboard(value, webview)) return;
        const request = parseModelsRequest(value);
        if (request === undefined) return;
        this.theme();
        if (request.action.kind === 'cancel') { this.operation?.abort(); return; }
        void this.run(request);
      }),
      vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration('droidvisx.theme')) this.theme();
      }),
      vscode.window.onDidChangeActiveColorTheme(() => this.theme()),
    ];
  }
  theme(): void {
    this.post({ type: 'models.theme', version: MODEL_MANAGER_VERSION, resolved: readWebviewBootTheme().resolved });
  }
  private async run(request: ModelsRequest): Promise<void> {
    if (this.operation !== null) {
      this.post({
        type: 'models.result',
        version: MODEL_MANAGER_VERSION,
        requestId: request.requestId,
        ok: false,
        message: 'Another model operation is still running.',
      });
      return;
    }
    const abort = new AbortController();
    this.operation = abort;
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
      this.post({
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
      if (this.operation === abort) this.operation = null;
    }
    this.post(result);
  }

  private post(message: ModelsHostMessage): void {
    if (!this.disposed) void this.webview.postMessage(message).then(() => undefined, () => undefined);
  }
  dispose(): void {
    this.disposed = true;
    this.operation?.abort();
    for (const subscription of this.subscriptions) subscription.dispose();
  }
}
