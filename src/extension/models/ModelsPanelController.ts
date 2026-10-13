import * as vscode from 'vscode';
import { getWebviewHtml } from '../webview/webviewHtml';
import { readWebviewBootTheme } from '../webview/webviewTheme';
import { hostText, readWebviewLocale } from '../webview/webviewLocale';
import type { ModelManager } from './ModelManager';
import { ModelsBinding } from './ModelsBinding';
import { ManagementBinding, type ManagementServices } from '../management/ManagementBinding';
import type { ManagementPage } from '../../shared/protocol/managementPageProtocol';

interface PanelEntry {
  readonly panel: vscode.WebviewPanel;
  readonly subscriptions: vscode.Disposable[];
  management?: ManagementBinding;
}

export class ModelsPanelController implements vscode.Disposable {
  private entry: PanelEntry | null = null;
  private disposed = false;
  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly manager: ModelManager,
    private readonly management?: ManagementServices,
  ) {}

  open(page: ManagementPage = 'models'): void {
    if (this.disposed) return;
    if (this.entry !== null) {
      this.entry.management?.navigate(page);
      this.entry.panel.reveal();
      return;
    }
    const dist = vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview');
    const panel = vscode.window.createWebviewPanel(
      'droidvisx.models',
      hostText(this.management ? 'Droid · Management' : 'Models'),
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [dist] },
    );
    const models = new ModelsBinding(panel.webview, this.manager);
    const entry: PanelEntry = { panel, subscriptions: [models] };
    this.entry = entry;
    if (this.management) {
      entry.management = new ManagementBinding(panel.webview, this.management, page);
      entry.subscriptions.push(entry.management);
    }
    entry.subscriptions.push(
      panel.onDidDispose(() => {
        for (const subscription of entry.subscriptions) subscription.dispose();
        if (this.entry === entry) this.entry = null;
      }),
      panel.onDidChangeViewState(() => { if (panel.visible) models.theme(); }),
    );
    panel.webview.html = getWebviewHtml(
      panel.webview,
      {
        script: vscode.Uri.joinPath(dist, this.management ? 'management.js' : 'models.js'),
        style: vscode.Uri.joinPath(dist, 'webview.css'),
      },
      undefined,
      readWebviewBootTheme(),
      undefined,
      readWebviewLocale(),
    );
  }

  dispose(): void {
    this.disposed = true;
    this.entry?.panel.dispose();
  }
}
