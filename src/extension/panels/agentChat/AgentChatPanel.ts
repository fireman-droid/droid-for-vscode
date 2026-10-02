import * as vscode from 'vscode';
import type { RuntimeDiagnosticSink } from '../../../runtime/runtimeDiagnostics';
import type { ReviewPanelOpen } from '../../../shared/protocol/reviewPanelProtocol';
import { parseAgentChatNavigation } from '../../../shared/protocol/agentChatProtocol';
import { isStrictRecord } from '../../../shared/validation/strictValidation';
import type { ChatController } from '../../chat/ChatController';
import { getWebviewHtml } from '../../webview/webviewHtml';
import { handleWebviewClipboard } from '../../webview/webviewClipboard';
import { routeWebviewMessage } from '../../webview/webviewMessageRouter';
import { createWebviewStateDelivery } from '../../webview/webviewStateDelivery';
import { readWebviewBootTheme, readWebviewThemePreference } from '../../webview/webviewTheme';

export interface AgentChatPanelOptions {
  readonly extensionUri: vscode.Uri;
  readonly title: string;
  readonly controller: ChatController;
  readonly diagnostics?: RuntimeDiagnosticSink;
  readonly navigation: {
    readonly subscribe: (listener: (message: unknown) => void) => vscode.Disposable;
    readonly replay: () => void;
    readonly handleMessage: (value: unknown) => boolean;
  };
  readonly onDispose?: () => void;
  readonly openReview?: (message: ReviewPanelOpen) => void;
  readonly openModels?: () => void;
  readonly authenticateMcp?: (serverName: string, sessionId: string) => void;
}

const SESSION_REPLACEMENT_COMMANDS = new Set([
  'session.new', 'session.select', 'session.fork', 'session.compact', 'worktree.createSession',
  'turn.editResend', 'rewind.info', 'editStage.begin', 'editStage.cancel',
]);

/** A retained ordinary chat surface whose controller is owned by one child session. */
export class AgentChatPanel implements vscode.Disposable {
  readonly reveal: () => void;
  readonly dispose: () => void;

  constructor(options: AgentChatPanelOptions) {
    const webviewDistUri = vscode.Uri.joinPath(options.extensionUri, 'dist', 'webview');
    const panel = vscode.window.createWebviewPanel('droidvisx.agentChat', options.title, vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [webviewDistUri, vscode.Uri.joinPath(options.extensionUri, 'resources')],
    });
    let disposed = false;
    const subscriptions: vscode.Disposable[] = [];
    const post = (message: unknown): void => {
      if (disposed) return;
      void panel.webview.postMessage(message).then(() => undefined, () => {
        if (!disposed) options.diagnostics?.record({ level: 'warn', name: 'host.agentChat.message-delivery-failed' });
      });
    };
    const postTheme = () => post({ type: 'ui.theme', ...readWebviewBootTheme() });
    const delivery = createWebviewStateDelivery({
      isCurrent: () => !disposed,
      isVisible: () => panel.visible,
      postMessage: (message) => panel.webview.postMessage(message),
      replayTo: (listener) => options.controller.replayTo(listener),
      ...(options.diagnostics === undefined ? {} : { diagnostics: options.diagnostics }),
    });
    const cleanup = (): void => {
      if (disposed) return;
      disposed = true;
      delivery.dispose();
      for (const subscription of subscriptions) subscription.dispose();
      options.onDispose?.();
    };
    subscriptions.push(
      options.controller.subscribe(delivery.post),
      options.navigation.subscribe((message) => {
        if (disposed) return;
        const navigation = parseAgentChatNavigation(message);
        const current = navigation?.agents.find((agent) => agent.key === navigation.currentKey);
        if (current) panel.title = current.title;
        post(message);
      }),
      panel.webview.onDidReceiveMessage((value: unknown) => {
        if (disposed || options.navigation.handleMessage(value)) return;
        if (handleWebviewClipboard(value, panel.webview)) return;
        if (isStrictRecord(value) && typeof value.type === 'string' && (
          SESSION_REPLACEMENT_COMMANDS.has(value.type) || value.type.startsWith('mission.') || value.type.startsWith('missionControl.') ||
          value.type === 'session.setting.update' && value.field === 'interactionMode' && value.value === 'mission'
        )) {
          options.diagnostics?.record({ level: 'warn', name: 'host.agentChat.session-replacement-rejected', attributes: { type: value.type } });
          void vscode.window.showWarningMessage('This action replaces the agent conversation. Return to the main chat to start or switch tasks.');
          return;
        }
        routeWebviewMessage(value, {
          controller: options.controller,
          ...(options.diagnostics === undefined ? {} : { diagnostics: options.diagnostics }),
          ...(options.openReview === undefined ? {} : { openReview: options.openReview }),
          ...(options.openModels === undefined ? {} : { openModels: options.openModels }),
          ...(options.authenticateMcp === undefined ? {} : { authenticateMcp: options.authenticateMcp }),
          postTheme,
          onReady: (message) => { options.navigation.replay(); delivery.onReady(message); },
          onStateApplied: delivery.onStateApplied,
        });
      }),
      panel.onDidChangeViewState(() => {
        if (!disposed && panel.visible) {
          postTheme();
          options.navigation.replay();
          delivery.onVisible();
        }
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (!disposed && panel.visible && event.affectsConfiguration('droidvisx.theme')) postTheme();
      }),
      vscode.window.onDidChangeActiveColorTheme(() => {
        if (!disposed && panel.visible && readWebviewThemePreference() === 'auto') postTheme();
      }),
      panel.onDidDispose(cleanup),
    );
    panel.webview.html = getWebviewHtml(panel.webview, {
      script: vscode.Uri.joinPath(webviewDistUri, 'webview.js'),
      style: vscode.Uri.joinPath(webviewDistUri, 'webview.css'),
    }, undefined, readWebviewBootTheme());
    this.reveal = () => { if (!disposed) panel.reveal(undefined, false); };
    this.dispose = () => { if (!disposed) { panel.dispose(); cleanup(); } };
  }
}
