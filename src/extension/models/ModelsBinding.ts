import * as vscode from 'vscode';
import { MODEL_MANAGER_VERSION, parseModelsRequest, type ModelsHostMessage, type ModelsRequest } from '../../shared/protocol/modelManagerProtocol';
import { handleWebviewClipboard } from '../webview/webviewClipboard';
import { readWebviewBootTheme } from '../webview/webviewTheme';
import { bindWebviewLocale } from '../webview/webviewLocale';
import { createModelSourcePreference } from '../webview/modelSourcePreference';
import { ModelManager, ModelManagerError, modelManagerFailure } from './ModelManager';
import type { RuntimeDiagnosticSink } from '../../runtime/runtimeDiagnostics';
import { classifyOperationError, recordOperation, type OperationResultDiagnostic } from '../diagnostics/operationDiagnostics';
import { WebviewStartupDiagnostics } from '../webview/webviewDiagnostics';

/** One transport owns its operations; editor and browser use the same handlers. */
export class ModelsBinding implements vscode.Disposable {
  private disposed = false;
  private operation: AbortController | null = null;
  private readonly subscriptions: vscode.Disposable[];
  private readonly frontend: WebviewStartupDiagnostics | undefined;
  constructor(private readonly webview: Pick<vscode.Webview, 'postMessage' | 'onDidReceiveMessage'>,
    private readonly manager: ModelManager, private readonly diagnostics: RuntimeDiagnosticSink | undefined = manager.diagnostics,
    ownsFrontendDiagnostics = false) {
    this.frontend = ownsFrontendDiagnostics ? new WebviewStartupDiagnostics('models', diagnostics) : undefined;
    const modelSourcePreference = createModelSourcePreference(webview);
    this.subscriptions = [
      modelSourcePreference, bindWebviewLocale(webview),
      webview.onDidReceiveMessage((value: unknown) => {
        if (this.frontend?.handle(value)) return;
        if (modelSourcePreference.handleMessage(value)) return;
        if (handleWebviewClipboard(value, webview)) return;
        const request = parseModelsRequest(value);
        if (request === undefined) return;
        this.frontend?.ready();
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
    const started = performance.now();
    if (this.operation !== null) {
      recordOperation(this.diagnostics, 'models', request.action.kind, started, { outcome: 'blocked', failureKind: 'busy' });
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
    let diagnostic: OperationResultDiagnostic = { outcome: 'success' };
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
          throw new ModelManagerError('Cancelled. No operation was started.', { outcome: 'cancelled', failureKind: 'cancelled' });
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
      diagnostic = classifyOperationError(error);
      if (abort.signal.aborted && diagnostic.outcome !== 'partial') diagnostic = { outcome: 'cancelled', failureKind: 'cancelled' };
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
    } catch (error) {
      if (diagnostic.outcome === 'success') diagnostic = {
        ...classifyOperationError(error), outcome: request.action.kind === 'refresh' ? 'failed' : 'partial',
      };
      result = {
        ...result,
        message: `${result.message} The current catalog could not be read; refresh before retrying.`,
      };
    } finally {
      if (this.operation === abort) this.operation = null;
    }
    recordOperation(this.diagnostics, 'models', request.action.kind, started, diagnostic);
    this.post(result);
  }

  private post(message: ModelsHostMessage): void {
    if (!this.disposed) void this.webview.postMessage(message).then(() => undefined, () => undefined);
  }
  dispose(): void {
    this.disposed = true;
    this.operation?.abort();
    this.frontend?.dispose();
    for (const subscription of this.subscriptions) subscription.dispose();
  }
}
