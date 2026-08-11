import * as vscode from 'vscode';

import type { RuntimeDiagnosticSink } from '../runtime/runtimeDiagnostics';
import { parseWebviewMessage } from '../shared/validateMessage';
import type { ChatController } from './ChatController';
import { getWebviewHtml } from './webviewHtml';

const BEACON_ERROR_KINDS: ReadonlySet<string> = new Set([
  'boot-timeout',
  'error',
  'unhandledrejection',
]);

function safeStringify(value: unknown): string {
  try {
    return (JSON.stringify(value) ?? String(value)).slice(0, 2048);
  } catch {
    return String(value).slice(0, 2048);
  }
}

export class DroidViewProvider
  implements vscode.WebviewViewProvider, vscode.Disposable
{
  static readonly viewType = 'droidvisx.chat';

  private messageListener: vscode.Disposable | undefined;
  private viewDisposalListener: vscode.Disposable | undefined;
  private controllerSubscription: vscode.Disposable | undefined;
  private webviewView: vscode.WebviewView | undefined;
  private disposed = false;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly controller: ChatController,
    private readonly diagnostics?: RuntimeDiagnosticSink,
  ) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    if (this.disposed) {
      return;
    }

    this.disposeViewSubscriptions();
    this.webviewView = webviewView;
    const webviewDistUri = vscode.Uri.joinPath(
      this.extensionUri,
      'dist',
      'webview',
    );

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        webviewDistUri,
        vscode.Uri.joinPath(this.extensionUri, 'resources'),
      ],
    };

    webviewView.webview.html = getWebviewHtml(
      webviewView.webview,
      {
        script: vscode.Uri.joinPath(webviewDistUri, 'webview.js'),
        style: vscode.Uri.joinPath(webviewDistUri, 'webview.css'),
      },
    );

    this.controllerSubscription = this.controller.subscribe((message) => {
      if (this.webviewView !== webviewView) {
        return;
      }
      void webviewView.webview.postMessage(message).then(
        () => undefined,
        () => undefined,
      );
    });
    this.messageListener = webviewView.webview.onDidReceiveMessage(
      (untrustedMessage: unknown) => {
        const message = parseWebviewMessage(untrustedMessage);
        if (message === undefined) {
          // Validation rejections used to be silent, which made
          // host<->webview message loss undiagnosable.
          this.diagnostics?.record({
            level: 'warn',
            name: 'host.bridge.rejected',
            attributes: { direction: 'inbound' },
            detail: safeStringify(untrustedMessage),
          });
          return;
        }

        if (message.type === 'webview.diagnostic') {
          this.diagnostics?.record({
            level: BEACON_ERROR_KINDS.has(message.kind)
              ? 'error'
              : 'info',
            name: `webview.${message.kind}`,
            detail: message.detail,
          });
          return;
        }

        this.controller.handleMessage(message);
      },
    );
    this.viewDisposalListener = webviewView.onDidDispose(() => {
      if (this.webviewView !== webviewView) {
        return;
      }
      this.disposeViewSubscriptions();
      this.webviewView = undefined;
    });
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.disposeViewSubscriptions();
    this.webviewView = undefined;
  }

  private disposeViewSubscriptions(): void {
    this.messageListener?.dispose();
    this.messageListener = undefined;
    this.viewDisposalListener?.dispose();
    this.viewDisposalListener = undefined;
    this.controllerSubscription?.dispose();
    this.controllerSubscription = undefined;
  }
}
