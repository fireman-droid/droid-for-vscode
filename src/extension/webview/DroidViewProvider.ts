import * as vscode from 'vscode';

import type { RuntimeDiagnosticSink } from '../../runtime/runtimeDiagnostics';
import type { ChatController } from '../chat/ChatController';
import { getWebviewHtml } from './webviewHtml';
import { handleWebviewClipboard } from './webviewClipboard';
import { routeWebviewMessage } from './webviewMessageRouter';
import { readWebviewBootTheme, readWebviewThemePreference } from './webviewTheme';
import type { ReviewPanelOpen } from '../../shared/protocol/reviewPanelProtocol';
import { createWebviewStateDelivery } from './webviewStateDelivery';

export class DroidViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  static readonly viewType = 'droidvisx.chat';

  private messageListener: vscode.Disposable | undefined;
  private viewDisposalListener: vscode.Disposable | undefined;
  private visibilityListener: vscode.Disposable | undefined;
  private configurationListener: vscode.Disposable | undefined;
  private colorThemeListener: vscode.Disposable | undefined;
  private missionSetupListener: vscode.Disposable | undefined;
  private controllerSubscription: vscode.Disposable | undefined;
  private stateDelivery: ReturnType<typeof createWebviewStateDelivery> | undefined;
  private webviewView: vscode.WebviewView | undefined;
  private disposed = false;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly controller: ChatController,
    private readonly diagnostics?: RuntimeDiagnosticSink,
    private readonly openMissionControl?: (
      target: 'catalog' | 'setup',
      task?: string,
    ) => void,
    private readonly missionWorkspace?: {
      readonly subscribe: (listener: (message: unknown) => void) => vscode.Disposable;
      readonly replay: () => void;
      readonly handleMessage: (value: unknown) => boolean;
    },
    private readonly openModels?: () => void,
    private readonly openReview?: (message: ReviewPanelOpen) => void,
    private readonly authenticateMcp?: (serverName: string, sessionId: string) => void,
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
    const webviewDistUri = vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview');

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        webviewDistUri,
        vscode.Uri.joinPath(this.extensionUri, 'resources'),
      ],
    };

    const postTheme = (): void => {
      const theme = readWebviewBootTheme();
      void webviewView.webview
        .postMessage({
          type: 'ui.theme',
          ...theme,
        })
        .then(
          () => undefined,
          () => undefined,
        );
    };
    // Settings-UI edits of droidvisx.theme reach the shell without a
    // reload; the webview's own ui.theme.set writes echo back through
    // the same listener (the shell applies them idempotently).
    this.configurationListener = vscode.workspace.onDidChangeConfiguration((event) => {
      if (
        this.webviewView === webviewView &&
        webviewView.visible &&
        event.affectsConfiguration('droidvisx.theme')
      ) {
        postTheme();
      }
    });
    this.colorThemeListener = vscode.window.onDidChangeActiveColorTheme(() => {
      if (
        this.webviewView === webviewView &&
        webviewView.visible &&
        readWebviewThemePreference() === 'auto'
      ) {
        postTheme();
      }
    });
    this.missionSetupListener = this.missionWorkspace?.subscribe((message) => {
      if (this.webviewView === webviewView) {
        void webviewView.webview.postMessage(message).then(
          () => undefined,
          () => undefined,
        );
      }
    });

    const delivery = createWebviewStateDelivery({
      isCurrent: () => this.webviewView === webviewView,
      isVisible: () => webviewView.visible,
      postMessage: (message) => webviewView.webview.postMessage(message),
      replayTo: (listener) => this.controller.replayTo(listener),
      ...(this.diagnostics === undefined ? {} : { diagnostics: this.diagnostics }),
    });
    this.stateDelivery = delivery;
    this.controllerSubscription = this.controller.subscribe(delivery.post);
    this.messageListener = webviewView.webview.onDidReceiveMessage(
      (untrustedMessage: unknown) => {
        if (handleWebviewClipboard(untrustedMessage, webviewView.webview)) return;
        routeWebviewMessage(untrustedMessage, {
          controller: this.controller,
          diagnostics: this.diagnostics,
          ...(this.missionWorkspace === undefined
            ? {}
            : { missionWorkspace: this.missionWorkspace }),
          ...(this.openMissionControl === undefined
            ? {}
            : { openMissionControl: this.openMissionControl }),
          postTheme,
          ...(this.openModels === undefined ? {} : { openModels: this.openModels }),
          ...(this.openReview === undefined ? {} : { openReview: this.openReview }),
          ...(this.authenticateMcp === undefined ? {} : { authenticateMcp: this.authenticateMcp }),
          onReady: delivery.onReady,
          onStateApplied: delivery.onStateApplied,
        });
      },
    );
    this.viewDisposalListener = webviewView.onDidDispose(() => {
      if (this.webviewView !== webviewView) {
        return;
      }
      this.disposeViewSubscriptions();
      this.webviewView = undefined;
    });
    // With retainContextWhenHidden the view survives tab switches
    // (no reboot, no re-resolve), so hide/show becomes a visibility
    // flip. The visibility log is the observable proof that a
    // switch-back happened without a webview.boot-ok. Re-show catches up
    // state updated while hidden or explicitly missed in delivery; a
    // healthy view with no intervening updates keeps its existing state.
    this.visibilityListener = webviewView.onDidChangeVisibility(() => {
      if (this.webviewView !== webviewView) {
        return;
      }
      this.diagnostics?.record({
        level: 'info',
        name: 'host.view.visibility',
        attributes: { visible: webviewView.visible },
      });
      if (webviewView.visible) {
        postTheme();
        delivery.onVisible();
      }
    });
    // Install receive and state listeners before the page can send its first ready message.
    webviewView.webview.html = getWebviewHtml(
      webviewView.webview,
      {
        script: vscode.Uri.joinPath(webviewDistUri, 'webview.js'),
        style: vscode.Uri.joinPath(webviewDistUri, 'webview.css'),
      },
      undefined,
      readWebviewBootTheme(),
    );
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
    this.stateDelivery?.dispose();
    this.stateDelivery = undefined;
    this.messageListener?.dispose();
    this.messageListener = undefined;
    this.viewDisposalListener?.dispose();
    this.viewDisposalListener = undefined;
    this.visibilityListener?.dispose();
    this.visibilityListener = undefined;
    this.configurationListener?.dispose();
    this.configurationListener = undefined;
    this.colorThemeListener?.dispose();
    this.colorThemeListener = undefined;
    this.missionSetupListener?.dispose();
    this.missionSetupListener = undefined;
    this.controllerSubscription?.dispose();
    this.controllerSubscription = undefined;
  }
}
