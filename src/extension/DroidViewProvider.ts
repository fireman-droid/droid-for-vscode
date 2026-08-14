import * as vscode from 'vscode';

import type { RuntimeDiagnosticSink } from '../runtime/runtimeDiagnostics';
import {
  BRIDGE_PROTOCOL_VERSION,
  type ThemePreference,
} from '../shared/bridgeMessages';
import { isStrictRecord } from '../shared/strictValidation';
import { parseWebviewMessage } from '../shared/validateMessage';
import type { ChatController } from './ChatController';
import { getWebviewHtml, type WebviewBootTheme } from './webviewHtml';

const BEACON_ERROR_KINDS: ReadonlySet<string> = new Set([
  'boot-timeout',
  'handshake-timeout',
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

/**
 * Detects a `webview.ready` handshake carrying a foreign protocol
 * version: the signature of a VSIX overwrite install where the bundle
 * on disk is newer than this in-memory host. Such a ready must be
 * loggable as its own event — burying it in the generic
 * `host.bridge.rejected` stream made the resulting dead panel
 * undiagnosable.
 */
function readReadyProtocolMismatch(
  value: unknown,
): string | number | null {
  if (
    !isStrictRecord(value) ||
    value.type !== 'webview.ready' ||
    value.protocolVersion === BRIDGE_PROTOCOL_VERSION
  ) {
    return null;
  }
  return typeof value.protocolVersion === 'number'
    ? value.protocolVersion
    : safeStringify(value.protocolVersion).slice(0, 64);
}

/** The persisted `droidvisx.theme` user setting (fail to 'auto'). */
function readThemePreference(): ThemePreference {
  const value = vscode.workspace
    .getConfiguration('droidvisx')
    .get<string>('theme', 'auto');
  return value === 'light' || value === 'dark' ? value : 'auto';
}

/**
 * The theme the webview HTML boots with, so the anti-flash inline
 * background and the first styled frame already match. 'auto' maps
 * the editor's active color theme kind; runtime changes arrive from
 * the Host color-theme listener through authoritative `ui.theme` pushes.
 */
function bootTheme(): WebviewBootTheme {
  const preference = readThemePreference();
  if (preference !== 'auto') {
    return { preference, resolved: preference };
  }
  const kind = vscode.window.activeColorTheme.kind;
  const resolved =
    kind === vscode.ColorThemeKind.Dark ||
    kind === vscode.ColorThemeKind.HighContrast
      ? 'dark'
      : 'light';
  return { preference, resolved };
}

export class DroidViewProvider
  implements vscode.WebviewViewProvider, vscode.Disposable
{
  static readonly viewType = 'droidvisx.chat';

  private messageListener: vscode.Disposable | undefined;
  private viewDisposalListener: vscode.Disposable | undefined;
  private visibilityListener: vscode.Disposable | undefined;
  private configurationListener: vscode.Disposable | undefined;
  private colorThemeListener: vscode.Disposable | undefined;
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
      undefined,
      bootTheme(),
    );

    const postTheme = (): void => {
      const theme = bootTheme();
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
    this.configurationListener =
      vscode.workspace.onDidChangeConfiguration((event) => {
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
        readThemePreference() === 'auto'
      ) {
        postTheme();
      }
    });

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
          const mismatch = readReadyProtocolMismatch(untrustedMessage);
          if (mismatch !== null) {
            this.diagnostics?.record({
              level: 'error',
              name: 'host.bridge.protocol-mismatch',
              attributes: {
                expected: BRIDGE_PROTOCOL_VERSION,
                received: mismatch,
              },
            });
            return;
          }
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

        // Theme preference is a view concern, not a session concern:
        // persist it as the user setting and stop here. The write
        // triggers onDidChangeConfiguration, which echoes ui.theme.
        if (message.type === 'ui.theme.set') {
          void vscode.workspace
            .getConfiguration('droidvisx')
            .update(
              'theme',
              message.preference,
              vscode.ConfigurationTarget.Global,
            )
            .then(
              () => undefined,
              () => {
                this.diagnostics?.record({
                  level: 'warn',
                  name: 'host.theme.persist-failed',
                  attributes: { preference: message.preference },
                });
              },
            );
          return;
        }

        // The ready resync (boot or re-show) also refreshes the theme
        // preference the retained webview may have missed while hidden.
        if (message.type === 'webview.ready') {
          postTheme();
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
    // With retainContextWhenHidden the view survives tab switches
    // (no reboot, no re-resolve), so hide/show becomes a visibility
    // flip. The visibility log is the observable proof that a
    // switch-back happened without a webview.boot-ok. The ready
    // resync on re-show is defensive: an initialized controller
    // treats a repeated ready as "re-emit the snapshot and replay
    // pending interactions", both of which the webview handles
    // idempotently, so any message the suspended webview might have
    // missed while hidden is reconciled wholesale.
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
        this.controller.handleMessage({
          type: 'webview.ready',
          protocolVersion: BRIDGE_PROTOCOL_VERSION,
        });
      }
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
    this.visibilityListener?.dispose();
    this.visibilityListener = undefined;
    this.configurationListener?.dispose();
    this.configurationListener = undefined;
    this.colorThemeListener?.dispose();
    this.colorThemeListener = undefined;
    this.controllerSubscription?.dispose();
    this.controllerSubscription = undefined;
  }
}
