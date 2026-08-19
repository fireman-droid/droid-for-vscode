import * as vscode from 'vscode';

import type { RuntimeDiagnosticSink } from '../runtime/runtimeDiagnostics';
import type { SessionHistoryLoader } from '../runtime/history/SessionHistory';
import {
  SESSION_VIEWER_PROTOCOL_VERSION,
  type SessionViewerHostMessage,
  type SessionViewerSnapshotMessage,
  type SessionViewerStopOutcome,
  type SessionViewerTarget,
  type SessionViewerTargetKind,
} from '../shared/sessionViewerProtocol';
import { getWebviewHtml } from './webviewHtml';
import {
  readWebviewBootTheme,
  readWebviewThemePreference,
} from './webviewTheme';
import { parseSessionViewerWebviewMessage } from './validateSessionViewerMessage';

export const SESSION_VIEWER_REFRESH_MS = 2_500;
const VIEW_TYPE = 'droidvisx.sessionViewer';

export interface SessionViewerPanelTarget {
  readonly kind: SessionViewerTargetKind;
  readonly mode: 'standard' | 'mission-readonly';
  readonly sessionId: string;
  readonly title: string;
  readonly cwd: string;
}

export interface SessionViewerSource {
  isRunning(target: SessionViewerPanelTarget): Promise<boolean | null>;
  stop(
    target: SessionViewerPanelTarget,
  ): Promise<SessionViewerStopOutcome>;
}

export type SessionViewerSourceResolver = (
  kind: SessionViewerTargetKind,
) => SessionViewerSource | null;

interface ViewerEntry {
  target: SessionViewerPanelTarget;
  readonly panel: vscode.WebviewPanel;
  readonly disposables: vscode.Disposable[];
  timer: ReturnType<typeof setInterval> | null;
  refreshBusy: boolean;
  refreshTrailing: boolean;
  running: boolean;
  settledAt: number | null;
  stopping: boolean;
  stopError: boolean;
  lastSnapshot: SessionViewerSnapshotMessage | null;
}

/**
 * Reusable read-only editor-tab viewer for daemon session transcripts.
 * Sources such as a future official Mission Worker adapter can supply
 * lifecycle and Stop semantics without rebuilding the panel or transcript.
 */
export class SessionViewerPanelController implements vscode.Disposable {
  private readonly entries = new Map<string, ViewerEntry>();
  private readonly subscriptions: vscode.Disposable[];
  private disposed = false;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly history: SessionHistoryLoader,
    private readonly resolveSource: SessionViewerSourceResolver,
    private readonly diagnostics?: RuntimeDiagnosticSink,
  ) {
    this.subscriptions = [
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('droidvisx.theme')) {
          this.broadcastTheme();
        }
      }),
      vscode.window.onDidChangeActiveColorTheme(() => {
        if (readWebviewThemePreference() === 'auto') {
          this.broadcastTheme();
        }
      }),
    ];
  }

  open(target: SessionViewerPanelTarget): void {
    if (this.disposed) {
      return;
    }
    const key = targetKey(target);
    const existing = this.entries.get(key);
    if (existing !== undefined) {
      existing.target = target;
      existing.panel.title = target.title;
      existing.panel.reveal(undefined, false);
      this.startRefresh(existing);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      VIEW_TYPE,
      target.title,
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(
            this.extensionUri,
            'dist',
            'webview',
          ),
          vscode.Uri.joinPath(this.extensionUri, 'resources'),
        ],
      },
    );
    const webviewDistUri = vscode.Uri.joinPath(
      this.extensionUri,
      'dist',
      'webview',
    );
    const html = getWebviewHtml(
      panel.webview,
      {
        script: vscode.Uri.joinPath(
          webviewDistUri,
          'session-viewer.js',
        ),
        style: vscode.Uri.joinPath(webviewDistUri, 'webview.css'),
      },
      undefined,
      readWebviewBootTheme(),
    );
    const entry: ViewerEntry = {
      target,
      panel,
      disposables: [],
      timer: null,
      refreshBusy: false,
      refreshTrailing: false,
      running: true,
      settledAt: null,
      stopping: false,
      stopError: false,
      lastSnapshot: null,
    };
    this.entries.set(key, entry);
    entry.disposables.push(
      panel.webview.onDidReceiveMessage((value: unknown) => {
        this.handleMessage(entry, value);
      }),
      panel.onDidDispose(() => {
        this.disposeEntry(key, entry);
      }),
    );
    // Install the receive listener before the bundle can post its
    // ready handshake; otherwise a fast cached webview could miss the
    // only event that requests the initial snapshot.
    panel.webview.html = html;
    this.startRefresh(entry);
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    for (const entry of [...this.entries.values()]) {
      entry.panel.dispose();
    }
    this.entries.clear();
    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }
  }

  private handleMessage(entry: ViewerEntry, value: unknown): void {
    const message = parseSessionViewerWebviewMessage(value);
    if (message === null) {
      this.diagnostics?.record({
        level: 'warn',
        name: 'host.sessionViewer.rejected',
        attributes: { kind: entry.target.kind },
      });
      return;
    }
    if (message.type === 'webview.diagnostic') {
      this.diagnostics?.record({
        level: 'warn',
        name: `sessionViewer.${message.kind}`,
        detail: message.detail,
      });
      return;
    }
    if (message.type === 'sessionViewer.ready') {
      this.postTheme(entry);
      if (entry.lastSnapshot !== null) {
        this.post(entry, entry.lastSnapshot);
      }
      void this.refresh(entry);
      return;
    }
    if (entry.target.mode === 'mission-readonly') {
      this.diagnostics?.record({
        level: 'warn',
        name: 'host.sessionViewer.readonly-rejected',
        attributes: { kind: entry.target.kind },
      });
      return;
    }
    void this.stop(entry);
  }

  private startRefresh(entry: ViewerEntry): void {
    if (entry.timer === null) {
      entry.timer = setInterval(() => {
        void this.refresh(entry);
      }, SESSION_VIEWER_REFRESH_MS);
    }
    void this.refresh(entry);
  }

  private stopRefresh(entry: ViewerEntry): void {
    if (entry.timer !== null) {
      clearInterval(entry.timer);
      entry.timer = null;
    }
  }

  private async refresh(entry: ViewerEntry): Promise<void> {
    if (!this.isCurrent(entry)) {
      return;
    }
    if (entry.refreshBusy) {
      entry.refreshTrailing = true;
      return;
    }
    entry.refreshBusy = true;
    try {
      const source = this.resolveSource(entry.target.kind);
      const [loaded, running] = await Promise.all([
        this.history.loadHistory({
          cwd: entry.target.cwd,
          sessionId: entry.target.sessionId,
        }),
        source?.isRunning(entry.target) ?? Promise.resolve(null),
      ]);
      if (!this.isCurrent(entry)) {
        return;
      }
      const wasRunning = entry.running;
      if (running !== null) {
        entry.running = running;
      }
      if (entry.running) {
        entry.settledAt = null;
      } else if (entry.settledAt === null) {
        // Keep one final polling interval after the first settled
        // observation. The daemon transcript can finish flushing just
        // after listOpened() becomes idle, so this second read preserves
        // the completed tail before the tab becomes static.
        entry.settledAt = Date.now();
      } else if (
        Date.now() - entry.settledAt >=
        SESSION_VIEWER_REFRESH_MS
      ) {
        entry.stopping = false;
        this.stopRefresh(entry);
      }
      const target = publicTarget(entry.target);
      const snapshot: SessionViewerSnapshotMessage =
        loaded.status === 'available'
          ? {
              type: 'sessionViewer.snapshot',
              protocolVersion: SESSION_VIEWER_PROTOCOL_VERSION,
              status: 'ready',
              target,
              items: loaded.state.transcript,
              truncated: loaded.state.truncated,
              running: entry.running,
              stopping: entry.stopping,
              stopError: entry.stopError,
            }
          : {
              type: 'sessionViewer.snapshot',
              protocolVersion: SESSION_VIEWER_PROTOCOL_VERSION,
              status: 'unavailable',
              target,
              reason: 'This session transcript is unavailable.',
              running: entry.running,
              stopping: false,
              stopError: entry.stopError,
            };
      entry.lastSnapshot = snapshot;
      this.post(entry, snapshot);
      if (wasRunning && !entry.running) {
        this.diagnostics?.record({
          level: 'info',
          name: 'host.sessionViewer.settled',
          attributes: { kind: entry.target.kind },
        });
      }
    } catch {
      if (this.isCurrent(entry)) {
        this.diagnostics?.record({
          level: 'warn',
          name: 'host.sessionViewer.refresh',
          attributes: { outcome: 'failed' },
        });
      }
    } finally {
      entry.refreshBusy = false;
      const trailing = entry.refreshTrailing;
      entry.refreshTrailing = false;
      if (trailing && this.isCurrent(entry)) {
        void this.refresh(entry);
      }
    }
  }

  private async stop(entry: ViewerEntry): Promise<void> {
    if (
      !this.isCurrent(entry) ||
      !entry.running ||
      entry.stopping
    ) {
      return;
    }
    const source = this.resolveSource(entry.target.kind);
    if (source === null) {
      return;
    }
    entry.stopping = true;
    entry.stopError = false;
    this.repost(entry);
    let outcome: SessionViewerStopOutcome;
    try {
      outcome = await source.stop(entry.target);
    } catch {
      outcome = 'failed';
    }
    if (!this.isCurrent(entry)) {
      return;
    }
    entry.stopping = false;
    entry.stopError = outcome === 'failed';
    if (outcome === 'not-running') {
      entry.running = false;
    }
    await this.refresh(entry);
  }

  private repost(entry: ViewerEntry): void {
    const snapshot = entry.lastSnapshot;
    if (snapshot === null) {
      return;
    }
    const next: SessionViewerSnapshotMessage = {
      ...snapshot,
      running: entry.running,
      stopping: entry.stopping,
      stopError: entry.stopError,
    };
    entry.lastSnapshot = next;
    this.post(entry, next);
  }

  private postTheme(entry: ViewerEntry): void {
    const theme = readWebviewBootTheme();
    this.post(entry, {
      type: 'sessionViewer.theme',
      ...theme,
    });
  }

  private broadcastTheme(): void {
    for (const entry of this.entries.values()) {
      this.postTheme(entry);
    }
  }

  private post(entry: ViewerEntry, message: SessionViewerHostMessage): void {
    void entry.panel.webview.postMessage(message).then(
      () => undefined,
      () => undefined,
    );
  }

  private isCurrent(entry: ViewerEntry): boolean {
    return (
      !this.disposed &&
      this.entries.get(targetKey(entry.target)) === entry
    );
  }

  private disposeEntry(key: string, entry: ViewerEntry): void {
    if (this.entries.get(key) !== entry) {
      return;
    }
    this.entries.delete(key);
    this.stopRefresh(entry);
    for (const disposable of entry.disposables) {
      disposable.dispose();
    }
  }
}

function targetKey(target: SessionViewerPanelTarget): string {
  return `${target.kind}:${target.mode}:${target.sessionId}`;
}

function publicTarget(
  target: SessionViewerPanelTarget,
): SessionViewerTarget {
  return target.mode === 'mission-readonly'
    ? { kind: target.kind, mode: target.mode, title: target.title }
    : {
        kind: target.kind,
        mode: target.mode,
        sessionId: target.sessionId,
        title: target.title,
      };
}
