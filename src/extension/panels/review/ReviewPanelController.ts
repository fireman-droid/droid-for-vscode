import * as vscode from 'vscode';
import type { ChatController } from '../../chat/ChatController';
import type { ReviewCoordinator } from '../../review/reviewCoordinator';
import type { GitWorkflow } from '../../workspace/gitWorkflow';
import { parseWebviewMessage } from '../../../shared/validateMessage';
import { parseReviewPanelRequest, type ReviewPanelOpen } from '../../../shared/protocol/reviewPanelProtocol';
import { getWebviewHtml } from '../../webview/webviewHtml';
import { handleWebviewClipboard } from '../../webview/webviewClipboard';
import { readWebviewBootTheme } from '../../webview/webviewTheme';
import { isTurnActive } from '../../chat/internals';
import type { SessionViewerPanelController } from '../sessionViewer/SessionViewerPanelController';
import { MAX_GIT_COMMIT_SUBJECT_LENGTH } from '../../../shared/protocol/gitCommitFlow';
import { operationDiffWithChanges } from '../../../shared/protocol/operationDiff';
import type { ReviewScopeState } from '../../../shared/protocol/reviewProtocol';

export class ReviewPanelController implements vscode.Disposable {
  private panel: vscode.WebviewPanel | null = null;
  private target: { sessionId: string; root: string; turnId?: string; toolUseId?: string; path?: string } | null = null;
  private ready = false;
  private committing = false;
  private invalidated = false;
  private pendingOpen: ReviewPanelOpen | null = null;
  private openGeneration = 0;
  private pendingIntent: { generation: number; request: ReviewPanelOpen } | null = null;
  private agentTarget: { sessionId: string; reviewSessionId: string; root: string } | null = null;
  private readonly subscriptions: vscode.Disposable[];
  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly controller: ChatController,
    private readonly review: ReviewCoordinator,
    private readonly git: GitWorkflow,
    private readonly viewer: SessionViewerPanelController,
  ) {
    this.subscriptions = [
      controller.subscribe((message) => {
        if (message.type === 'review.agentReviewState' && message.reviewSessionId && this.target?.sessionId === message.sessionId)
          this.agentTarget = { sessionId: message.sessionId, reviewSessionId: message.reviewSessionId, root: this.target.root };
        if (message.type === 'host.snapshot') {
          if (this.target && (this.target.sessionId !== controller.sessionState.sessionId || this.target.root !== controller.sessionState.activeRuntimeCwd))
            this.invalidated = true;
          if (!this.current()) this.cancelPendingOpen();
          this.postContext();
        }
        if (message.type === 'review.operationResult' && message.sessionId === this.target?.sessionId &&
          message.operation === 'open' && !message.ok) this.pendingIntent = null;
        if ('sessionId' in message && message.sessionId === this.target?.sessionId &&
          message.type.startsWith('review.')) this.post(message);
        if (message.type === 'review.state' && message.state.sessionId === this.target?.sessionId) this.post(message);
      }),
      vscode.window.onDidChangeActiveColorTheme(() => this.postTheme()),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('droidvisx.theme')) this.postTheme();
      }),
    ];
  }
  open(message?: ReviewPanelOpen): void {
    const { sessionId, activeRuntimeCwd: root } = this.controller.sessionState;
    if (!sessionId || !root || (message && message.sessionId !== sessionId)) return;
    const latestOperation = this.latestOperationTurn();
    const latest = this.controller.effects.readLatestConversationChanges();
    this.cancelPendingOpen();
    this.target = { sessionId, root,
      ...(message?.turnId ? { turnId: message.turnId } : {}),
      ...(message?.toolUseId ? { toolUseId: message.toolUseId } : {}),
      ...(message?.path ? { path: message.path } : {}),
    };
    this.invalidated = false;
    this.pendingOpen = message ?? (latestOperation
      ? { type: 'review.panel.open', sessionId, scopeKind: 'operations', turnId: latestOperation.turnId }
      : latest
      ? { type: 'review.panel.open', sessionId, scopeKind: 'turn', turnId: latest.turnId }
      : { type: 'review.panel.open', sessionId, scopeKind: 'workspace' });
    if (this.panel) {
      this.panel.reveal(undefined, false);
      this.initialize();
      return;
    }
    const panel = vscode.window.createWebviewPanel('droidvisx.review', 'Review changes', vscode.ViewColumn.Active, {
      enableScripts: true, retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview')],
    });
    this.panel = panel;
    const receive = panel.webview.onDidReceiveMessage((value) => { void this.handle(value).catch((error) => this.postError(error)); });
    const dispose = panel.onDidDispose(() => {
      receive.dispose(); dispose.dispose();
      if (this.panel === panel) { this.panel = null; this.ready = false; this.target = null; this.cancelPendingOpen(); }
    });
    const dist = vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview');
    panel.webview.html = getWebviewHtml(panel.webview, {
      script: vscode.Uri.joinPath(dist, 'review.js'), style: vscode.Uri.joinPath(dist, 'webview.css'),
    }, undefined, readWebviewBootTheme());
  }
  dispose(): void {
    this.cancelPendingOpen();
    this.panel?.dispose();
    this.subscriptions.forEach((subscription) => subscription.dispose());
  }
  private current(): boolean {
    return !this.invalidated && !!this.target && this.target.sessionId === this.controller.sessionState.sessionId &&
      this.target.root === this.controller.sessionState.activeRuntimeCwd &&
      this.controller.sessionState.connection.status === 'connected' && !this.controller.sessionState.disposed;
  }
  private initialize(): void {
    if (!this.ready || !this.pendingOpen || !this.current()) return;
    this.postTheme(); this.postContext();
    const message = this.pendingOpen;
    this.pendingOpen = null;
    const intent = message.toolUseId === undefined && (message.path !== undefined || message.action !== undefined)
      ? { generation: this.openGeneration, request: message } : null;
    if (intent) { void this.openWithIntent(intent); return; }
    this.controller.handleMessage({ type: 'review.open', sessionId: message.sessionId, scopeKind: message.scopeKind,
      ...(message.turnId ? { turnId: message.turnId } : {}) });
  }
  private async openWithIntent(intent: NonNullable<ReviewPanelController['pendingIntent']>): Promise<void> {
    const message = intent.request;
    try {
      // Drain earlier opens and their failures before arming this request's intent.
      await this.review.replayTo(message.sessionId, () => {});
      if (intent.generation !== this.openGeneration || !this.current()) return;
      this.pendingIntent = intent;
      this.controller.handleMessage({ type: 'review.open', sessionId: message.sessionId, scopeKind: message.scopeKind,
        ...(message.turnId ? { turnId: message.turnId } : {}) });
      // This queued replay follows this open; an earlier broadcast for the same turn cannot consume it.
      await this.review.replayTo(message.sessionId, (response) => {
        if (response.type === 'review.state') this.completeOpenIntent(intent, response.state);
      });
    } catch (error) {
      if (intent.generation !== this.openGeneration || !this.current()) return;
      this.pendingIntent = null;
      this.postError(error);
    }
  }
  private cancelPendingOpen(): void {
    this.openGeneration += 1;
    this.pendingOpen = null;
    this.pendingIntent = null;
  }
  private completeOpenIntent(intent: NonNullable<ReviewPanelController['pendingIntent']>, state: ReviewScopeState): void {
    const request = intent.request;
    if (this.pendingIntent !== intent || intent.generation !== this.openGeneration || !this.current() ||
      state.sessionId !== request.sessionId || state.scopeKind !== request.scopeKind || state.turnId !== request.turnId) return;
    this.pendingIntent = null;
    const scope = { sessionId: state.sessionId, reviewScopeId: state.reviewScopeId, baseline: state.baseline };
    if (request.path !== undefined) {
      if (!state.files.some((file) => file.path === request.path)) {
        this.postError(new Error('This file is no longer available in the selected review.'));
        return;
      }
      this.controller.handleMessage({ type: 'review.selectFile', ...scope, path: request.path });
    }
    if (request.action === 'undo') {
      if (state.lifecycle === 'writing') {
        this.postError(new Error('Wait for this turn and its delegated operations to finish before undoing changes.'));
        return;
      }
      if (state.files.length === 0) {
        this.postError(new Error('No recorded operations are available to undo for this turn.'));
        return;
      }
      this.controller.handleMessage({ type: 'review.restorePreview', ...scope, target: 'turn' });
    }
  }
  private postContext(): void {
    const target = this.target;
    const item = target?.toolUseId ? this.controller.recoveryState.transcript.transcript.find((entry) =>
      entry.kind === 'tool' && entry.turnId === target.turnId && entry.toolUseId === target.toolUseId) : undefined;
    const persistedOperation =
      item === undefined && target?.toolUseId !== undefined && target.turnId !== undefined &&
      this.controller.sessionState.conversationId !== null
        ? this.controller.recoveryStore
            .readTurn(this.controller.sessionState.conversationId, target.turnId)
            ?.toolOperations?.find(
              (operation) => operation.toolUseId === target.toolUseId,
            )?.operationDiff
        : undefined;
    this.post({
      type: 'reviewPanel.context', sessionId: target?.sessionId ?? null, valid: this.current(),
      latestTurnId:
        this.latestOperationTurn()?.turnId ??
        this.controller.effects.readLatestConversationChanges()?.turnId ??
        null,
      operation:
        item?.kind === 'tool'
          ? operationDiffWithChanges(
              item.operationDiff ?? { status: 'unavailable', reason: 'not-recorded' },
            )
          : persistedOperation === undefined
            ? null
            : operationDiffWithChanges(persistedOperation),
      operationPath: target?.path ?? null,
    });
  }
  private async handle(value: unknown): Promise<void> {
    if (this.panel && handleWebviewClipboard(value, this.panel.webview)) return;
    const message = parseReviewPanelRequest(value);
    if (message?.type === 'reviewPanel.ready') { this.ready = true; this.initialize(); return; }
    if (!this.current()) { this.postContext(); return; }
    const target = this.target!;
    if (message?.type === 'reviewPanel.readFile' || message?.type === 'reviewPanel.openNative') {
      const request = { ...message, sessionId: target.sessionId };
      if (message.type === 'reviewPanel.openNative') {
        const result = await this.review.openNative(request);
        if (result !== 'opened-diff') throw new Error('The native Diff could not be opened.');
      } else {
        try {
          const result = await this.review.readFile(request);
          if (this.target === target && this.current()) this.post({ type: 'reviewPanel.file', ...result,
            requestId: message.requestId, reviewScopeId: message.reviewScopeId, path: message.path, error: null });
        } catch (error) {
          if (this.target === target && this.current()) this.post({
            type: 'reviewPanel.file', requestId: message.requestId, reviewScopeId: message.reviewScopeId,
            path: message.path, version: '', patch: '', truncated: false,
            error: error instanceof Error ? error.message : 'Diff could not be read.',
          });
        }
      }
      return;
    }
    if (message?.type === 'reviewPanel.gitStatus') { await this.postGitStatus(target); return; }
    if (message?.type === 'reviewPanel.openAgent') {
      const agent = this.agentTarget;
      if (agent?.sessionId === target.sessionId && agent.root === target.root) this.viewer.open({
        kind: 'daemon-session', mode: 'standard', sessionId: agent.reviewSessionId,
        title: 'Agent Review', cwd: target.root,
      });
      return;
    }
    if (message?.type === 'reviewPanel.commit') {
      if (this.committing) return;
      const current = () => this.target === target && this.current() && !this.writing();
      if (!current()) throw new Error('Wait for the active turn to finish before committing.');
      this.committing = true;
      try {
        const result = await this.git.commit(target.root, message.paths, message.message, current);
        if (this.target === target && this.current()) {
          this.post({ type: 'git.commitResult', sequence: 0, sessionId: target.sessionId, turnId: 'review',
            ...result, ...(result.ok ? { subject: message.message.split('\n')[0]!.slice(0, MAX_GIT_COMMIT_SUBJECT_LENGTH) } : {}) });
          await this.postGitStatus(target);
          if (result.ok) this.review.handle({ type: 'review.refresh', sessionId: target.sessionId });
        }
      } finally { this.committing = false; }
      return;
    }
    if (message?.type === 'reviewPanel.openPath') {
      this.controller.handleMessage({
        type: 'workspace.openPath', sessionId: target.sessionId, path: message.path,
      });
      return;
    }
    const action = parseWebviewMessage(value);
    if (action && action.type.startsWith('review.') && 'sessionId' in action && action.sessionId === target.sessionId) {
      if (action.type === 'review.open') {
        this.cancelPendingOpen();
        this.target = { sessionId: target.sessionId, root: target.root };
        this.postContext();
      }
      this.controller.handleMessage(action);
    }
  }
  private writing(): boolean {
    return this.controller.turnState.turn !== null && isTurnActive(this.controller.turnState.turn);
  }
  private latestOperationTurn() {
    const conversationId = this.controller.sessionState.conversationId;
    return conversationId === null
      ? undefined
      : this.controller.recoveryStore.readLatestOperations(conversationId);
  }
  private async postGitStatus(target: NonNullable<ReviewPanelController['target']>): Promise<void> {
    const status = await this.git.status(target.root, new Set());
    if (this.target !== target || !this.current()) return;
    this.post({ type: 'git.status', sequence: 0, sessionId: target.sessionId, turnId: 'review',
      branch: status.available ? status.branch : null, files: status.available ? status.files : [],
      ...(!status.available ? { unavailableReason: status.reason } : {}) });
  }
  private postTheme(): void { this.post({ type: 'ui.theme', ...readWebviewBootTheme() }); }
  private postError(error: unknown): void {
    this.post({ type: 'reviewPanel.error', message: error instanceof Error ? error.message : 'Review operation failed.' });
  }
  private post(message: unknown): void {
    if (this.ready) void this.panel?.webview.postMessage(message);
  }
}
