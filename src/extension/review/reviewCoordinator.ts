import type { ReviewContext } from '../../shared/protocol/reviewPanelProtocol';
import { randomUUID } from 'node:crypto';
import * as vscode from 'vscode';

import type { RuntimeGitDiff } from '../../runtime/DroidRuntime';
import { MAX_REVIEW_UNDO_FILES } from '../../shared/protocol/reviewProtocol';
import type {
  ReviewHostMessage,
  ReviewOpenMessage,
  ReviewScopeState,
  ReviewWebviewMessage,
} from '../../shared/protocol/reviewProtocol';
import type { RuntimeDiagnosticSink } from '../../runtime/runtimeDiagnostics';
import type { ChangeStatsPersistence, CommittedFileStat } from '../changes/changeStats';
import type { FileDiffOpener } from '../changes/fileDiffOpener';
import type { TurnSnapshotStore } from '../changes/turnSnapshots';
import type { ReviewGitScope } from './reviewGitComparison';
import { loadTurnReviewScope } from './reviewTurnScope';
import { readReviewContents, readReviewPatch, reviewFileVersion } from './reviewContent';
import {
  refreshScopeVersions,
  ReviewWatcherRefresh,
  watcherOpenMessage,
} from './reviewWatcherRefresh';
import { runAgentReview, type ReviewAgentRunner } from './reviewAgent';
import {
  createActiveScope,
  isNotFound,
  latestPersistedScope,
  readPersistedScopes,
  sameBytes,
  scopeId,
  unavailableScope,
  type ActiveScope,
  type PersistedScope,
} from './reviewCoordinatorSupport';
import {
  invalidateWritingTurn,
  openWritingTurn,
  refreshWritingTurn,
  settleWritingTurn,
  type ReviewWritingScopeHost,
} from './reviewWritingScopes';
import {
  loadOperationReviewScope,
  preflightOperationRestore,
  recordedOperationVersion,
  type RecordedOperation,
} from './reviewOperationScope';
import { applyOperationUndo, recoverOperationUndo } from './operationUndoFiles';

const REVIEW_STORAGE_KEY = 'droidvisx.reviewState';
const REVIEW_STORAGE_VERSION = 1;
const MAX_PERSISTED_SCOPES = 16;
type Unsequenced<T> = T extends { readonly sequence: number } ? Omit<T, 'sequence'> : never;
type CanonicalTurnFiles = (
  sessionId: string,
  turnId: string,
) => readonly CommittedFileStat[] | undefined;
export interface ReviewCoordinatorOptions {
  readonly isTurnWriting?: (sessionId: string, turnId: string) => boolean;
  readonly isOperationWriting?: (sessionId: string, turnId: string) => boolean;
  readonly readTurnOperations?: (
    sessionId: string,
    turnId: string,
  ) => readonly RecordedOperation[];
  readonly readTurnOperationNotices?: (sessionId: string, turnId: string) => readonly string[];
  readonly isSessionCurrent?: (sessionId: string) => boolean;
  readonly openSelectionInEditor?: boolean;
  readonly readGitScope?: (kind: 'workspace' | 'branch' | 'staged' | 'unstaged') => Promise<ReviewGitScope>;
  readonly getWorkspaceRoot: () => string | undefined;
  readonly snapshots: TurnSnapshotStore;
  readonly fileDiff: FileDiffOpener;
  readonly persistence: ChangeStatsPersistence;
  readonly storageDir: string;
  readonly publish: (message: Unsequenced<ReviewHostMessage>) => void;
  readonly readCanonicalTurnFiles: CanonicalTurnFiles;
  readonly resolveCanonicalTurnSessionId?: (
    sessionId: string,
    turnId: string,
  ) => string | undefined;
  readonly readWorkspaceFiles: () => Promise<
    { readonly baseline: string; readonly files: readonly CommittedFileStat[] } | undefined
  >;
  readonly readBranchDiff: () => Promise<
    | {
        readonly baseline: string;
        readonly diff: RuntimeGitDiff;
      }
    | undefined
  >;
  readonly runAgentReview?: ReviewAgentRunner;
  readonly diagnostics?: Pick<RuntimeDiagnosticSink, 'record'>;
}
interface RestoreEntry {
  readonly path: string;
  readonly before: Buffer | null;
  readonly after: Buffer | null;
  readonly current: Buffer | null;
  readonly status: 'restorable' | 'conflicted' | 'unsupported';
}
interface RestorePreview {
  readonly id: string;
  readonly reviewScopeId: string;
  readonly baseline: string;
  readonly target: 'file' | 'turn';
  readonly entries: readonly RestoreEntry[];
  readonly versions: readonly { path: string; version: string }[];
}
export class ReviewCoordinator implements vscode.Disposable {
  private active: ActiveScope | null = null;
  private readonly persisted: Map<string, PersistedScope>;
  private readonly previews = new Map<string, RestorePreview>();
  private readonly pendingOperationRefreshes = new Set<string>();
  private readonly disposables: vscode.Disposable[];
  private operation: Promise<void> = Promise.resolve();
  private disposed = false;
  private readonly writingScopes: ReviewWritingScopeHost;
  private readonly watcherRefresh: ReviewWatcherRefresh;

  constructor(private readonly options: ReviewCoordinatorOptions) {
    this.persisted = readPersistedScopes(
      options.persistence,
      REVIEW_STORAGE_KEY,
      REVIEW_STORAGE_VERSION,
      MAX_PERSISTED_SCOPES,
    );
    this.writingScopes = {
      snapshots: options.snapshots,
      persisted: this.persisted,
      getActive: () => this.active,
      setActive: (scope) => {
        if (!this.disposed) this.active = scope;
      },
      publish: (scope) => this.publishState(scope),
      loadSettled: (sessionId, turnId) => this.loadTurnScope(sessionId, turnId),
      refreshVersions: (scope, paths) =>
        this.disposed ? Promise.resolve() : this.refreshVersions(scope, paths),
      persist: (scope) => this.persistScope(scope),
      enqueue: (task) => this.enqueue(task, true),
    };
    this.watcherRefresh = new ReviewWatcherRefresh({
      getActive: () => this.active,
      setActive: (scope) => {
        if (!this.disposed) this.active = scope;
      },
      loadScope: (scope) => this.loadScope(watcherOpenMessage(scope)),
      refreshVersions: (scope, paths) => this.refreshVersions(scope, paths),
      publish: (scope) => this.publishState(scope),
      enqueue: (task) => this.enqueue(task, true),
    });
    const watcher = vscode.workspace.createFileSystemWatcher('**/*');
    this.disposables = [
      watcher,
      watcher.onDidChange((uri) => this.noteWorkspaceChange(uri)),
      watcher.onDidCreate((uri) => this.noteWorkspaceChange(uri)),
      watcher.onDidDelete((uri) => this.noteWorkspaceChange(uri)),
      vscode.workspace.onDidChangeTextDocument(({ document }) => {
        this.noteWorkspaceChange(document.uri);
      }),
    ];
  }
  start(): void {
    void this.recoverInterruptedRestore();
  }
  handle(message: ReviewWebviewMessage): void {
    if (this.disposed) return;
    void this.enqueue(() => this.handleNow(message)).catch((error) => {
      if (!this.disposed)
        this.result(
          message.sessionId,
          ('reviewScopeId' in message ? message.reviewScopeId : undefined) ?? 'review',
          'open',
          false,
          error instanceof Error ? error.message : 'Review operation failed.',
        );
    });
  }
  async readFile(message: { sessionId: string; reviewScopeId: string; baseline: string; path: string; context: ReviewContext }) {
    await this.operation;
    const scope = this.requireScope(message);
    if (!scope) throw new Error('The review scope changed. Refresh the review.');
    return readReviewPatch(this.options, scope, message.path, message.context);
  }
  async openNative(message: { sessionId: string; reviewScopeId: string; baseline: string; path: string }) {
    await this.operation;
    const scope = this.requireScope(message);
    if (!scope) throw new Error('The review scope changed.');
    if (scope.scopeKind === 'operations') throw new Error('Recorded operations do not have a full-file native comparison.');
    const contents = await readReviewContents(this.options, scope, message.path, 8 * 1024 * 1024);
    return this.options.fileDiff.openDiff(message.path, { sessionId: scope.sessionId, turnId: scope.turnId ?? scope.reviewScopeId }, {
      baselineLabel: scope.baselineLabel,
      turnSnapshot: { before: contents.before.toString('utf8'), after: contents.after.toString('utf8'), phase: scope.lifecycle === 'writing' ? 'live' : 'settled' },
    });
  }
  openWritingTurn(sessionId: string, turnId: string, files: readonly CommittedFileStat[]): void {
    if (this.disposed) return;
    openWritingTurn(this.writingScopes, sessionId, turnId, files);
  }
  refreshWritingTurn(sessionId: string, turnId: string, files: readonly CommittedFileStat[]): void {
    if (this.disposed) return;
    refreshWritingTurn(this.writingScopes, sessionId, turnId, files);
  }
  invalidateWritingTurn(sessionId: string, turnId: string, paths: readonly string[]): void {
    if (this.disposed) return;
    invalidateWritingTurn(this.writingScopes, sessionId, turnId, paths);
  }
  settleWritingTurn(
    sessionId: string,
    turnId: string,
    files: readonly CommittedFileStat[],
  ): Promise<void> {
    return this.disposed
      ? Promise.resolve()
      : settleWritingTurn(this.writingScopes, sessionId, turnId, files);
  }
  refreshOperationsTurn(sessionId: string, turnId: string): void {
    if (
      this.disposed ||
      this.active?.scopeKind !== 'operations' ||
      this.active.sessionId !== sessionId ||
      this.active.turnId !== turnId
    ) return;
    const key = JSON.stringify([sessionId, turnId]);
    if (this.pendingOperationRefreshes.has(key)) return;
    this.pendingOperationRefreshes.add(key);
    void this.enqueue(async () => {
      // Read the latest evidence once for each queued burst. Updates arriving during
      // this refresh may append one follow-up, behind already queued user actions.
      this.pendingOperationRefreshes.delete(key);
      const current = this.active;
      if (
        current?.scopeKind !== 'operations' ||
        current.sessionId !== sessionId ||
        current.turnId !== turnId
      ) return;
      const refreshed = await this.loadScope({
        type: 'review.open',
        sessionId,
        scopeKind: 'operations',
        turnId,
      });
      if (this.disposed || this.active !== current || this.options.isSessionCurrent?.(sessionId) === false) return;
      this.active = refreshed;
      this.publishState(refreshed);
      await this.persistScope(refreshed);
    }, true);
  }
  replay(sessionId: string): Promise<void> {
    return this.replayTo(sessionId, (message) => this.publish(message));
  }
  async replayTo(
    sessionId: string,
    publish: (message: Unsequenced<ReviewHostMessage>) => void,
  ): Promise<void> {
    if (this.disposed) return;
    return this.enqueue(() => this.replayNow(sessionId, publish));
  }
  private async replayNow(
    sessionId: string,
    publish: (message: Unsequenced<ReviewHostMessage>) => void,
  ): Promise<void> {
    if (this.disposed) return;
    if (this.active?.sessionId !== sessionId) {
      const saved = latestPersistedScope(this.persisted, sessionId);
      if (saved === undefined) {
        this.active = null;
        return;
      }
      const restored = await this.loadScope({
        type: 'review.open',
        sessionId,
        scopeKind: saved.scopeKind,
        ...(saved.turnId === undefined ? {} : { turnId: saved.turnId }),
      });
      await this.refreshVersions(restored);
      if (this.disposed) return;
      this.active = restored;
    }
    if (this.disposed) return;
    this.publishState(this.active, publish);
  }
  dispose(): void {
    this.disposed = true;
    this.watcherRefresh.dispose();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.previews.clear();
    this.pendingOperationRefreshes.clear();
  }
  private enqueue(task: () => Promise<void>, reportFailure = false): Promise<void> {
    const result = this.operation.then(() => (this.disposed ? undefined : task()));
    this.operation = result.catch(() => undefined);
    if (reportFailure) void result.catch(() => this.reportQueueFailure());
    return result;
  }
  private reportQueueFailure(): void {
    try {
      this.options.diagnostics?.record({
        level: 'warn',
        name: 'host.review.queue-failed',
      });
    } catch {}
  }
  private async handleNow(message: ReviewWebviewMessage): Promise<void> {
    if (this.options.isSessionCurrent?.(message.sessionId) === false) return;
    switch (message.type) {
      case 'review.open':
        return this.open(message);
      case 'review.refresh':
        if (
          this.active !== null &&
          this.active.sessionId === message.sessionId &&
          (message.reviewScopeId === undefined ||
            message.reviewScopeId === this.active.reviewScopeId)
        ) {
          await this.reloadActive();
        }
        return;
      case 'review.navigate':
        return this.navigate(message);
      case 'review.selectFile':
        return this.selectFile(message);
      case 'review.markReviewed':
        return this.markReviewed(message);
      case 'review.restorePreview':
        return this.previewRestore(message);
      case 'review.restoreFile':
      case 'review.restoreTurn':
        return this.restore(message);
      case 'review.runAgentReview':
        return runAgentReview(
          this.options.runAgentReview,
          (response) => this.publish(response),
          message,
          this.requireScope(message),
        );
    }
  }
  private async open(message: ReviewOpenMessage): Promise<void> {
    const loaded = await this.loadScope(message);
    if (this.disposed || this.options.isSessionCurrent?.(message.sessionId) === false) return;
    await this.refreshVersions(loaded);
    if (this.disposed) return;
    this.active = loaded;
    this.publishState(loaded);
    if (this.disposed) return;
    if (message.openCurrent === true) {
      (await this.openCurrent(loaded, false))
        ? this.result(loaded.sessionId, loaded.reviewScopeId, 'open', true, 'Review opened.')
        : this.publishState(loaded);
    }
    await this.persistScope(loaded);
  }
  private async loadScope(message: ReviewOpenMessage): Promise<ActiveScope> {
    if (message.scopeKind === 'operations') {
      const scope = loadOperationReviewScope(
        message,
        this.options.readTurnOperations?.(message.sessionId, message.turnId!) ?? [],
        this.persisted,
        this.options.readTurnOperationNotices?.(message.sessionId, message.turnId!) ?? [],
      );
      if (this.options.isOperationWriting?.(message.sessionId, message.turnId!) ??
        this.options.isTurnWriting?.(message.sessionId, message.turnId!)) scope.lifecycle = 'writing';
      scope.snapshotSessionId = this.options.resolveCanonicalTurnSessionId?.(message.sessionId, message.turnId!) ?? message.sessionId;
      return scope;
    }
    if (message.scopeKind === 'turn') {
      return this.loadTurnScope(message.sessionId, message.turnId!);
    }
    if (this.options.readGitScope) {
      const source = await this.options.readGitScope(message.scopeKind);
      return Object.assign(createActiveScope(message, source.baseline, source.label, source.files, this.persisted), {
        comparison: source.comparison, branchCommitCount: source.commitCount, sdkPatches: source.sdkPatches,
      });
    }
    if (message.scopeKind === 'workspace') {
      const source = await this.options.readWorkspaceFiles();
      if (source === undefined) {
        return unavailableScope(message, 'HEAD is unavailable for this workspace.');
      }
      return createActiveScope(message, source.baseline, 'HEAD', source.files, this.persisted);
    }
    const source = await this.options.readBranchDiff();
    if (source === undefined) {
      return unavailableScope(message, 'Branch comparison is unavailable.');
    }
    return Object.assign(
      createActiveScope(
        message,
        source.baseline,
        source.diff.baseBranch,
        source.diff.files,
        this.persisted,
      ),
      { branchCommitCount: source.diff.commitCount },
    );
  }
  private async loadTurnScope(sessionId: string, turnId: string): Promise<ActiveScope> {
    return loadTurnReviewScope(this.options, this.persisted, this.active, sessionId, turnId);
  }
  private async reloadActive(): Promise<void> {
    const active = this.active;
    if (active === null || this.disposed) return;
    const reloaded = await this.loadScope({
      type: 'review.open',
      sessionId: active.sessionId,
      scopeKind: active.scopeKind,
      ...(active.turnId === undefined ? {} : { turnId: active.turnId }),
    });
    if (reloaded.baseline !== active.baseline) {
      reloaded.lifecycle = 'stale';
      reloaded.message = 'The review baseline changed. Reopen this scope.';
    }
    await this.refreshVersions(reloaded);
    if (this.disposed) return;
    this.active = reloaded;
    this.publishState(reloaded);
  }
  private async navigate(
    message: Extract<ReviewWebviewMessage, { type: 'review.navigate' }>,
  ): Promise<void> {
    const scope = this.requireScope(message);
    if (scope === undefined || scope.files.length === 0) {
      return;
    }
    const current = scope.currentIndex ?? 0;
    scope.currentIndex =
      message.direction === 'next'
        ? Math.min(scope.files.length - 1, current + 1)
        : Math.max(0, current - 1);
    scope.lifecycle = this.scopeLifecycle(scope);
    await this.openCurrent(scope);
    await this.persistScope(scope);
    this.publishState(scope);
  }
  private async selectFile(
    message: Extract<ReviewWebviewMessage, { type: 'review.selectFile' }>,
  ): Promise<void> {
    const scope = this.requireScope(message);
    const index = scope?.files.findIndex(({ path }) => path === message.path) ?? -1;
    if (scope === undefined || index < 0) {
      return;
    }
    scope.currentIndex = index;
    scope.lifecycle = this.scopeLifecycle(scope);
    await this.openCurrent(scope);
    await this.persistScope(scope);
    this.publishState(scope);
  }
  private async markReviewed(
    message: Extract<ReviewWebviewMessage, { type: 'review.markReviewed' }>,
  ): Promise<void> {
    const scope = this.requireScope(message);
    const file = scope?.files.find(({ path }) => path === message.path);
    if (
      scope === undefined ||
      file === undefined ||
      scope.lifecycle === 'writing' ||
      file.version === 'unavailable' ||
      !file.comparable ||
      message.version !== file.version
    ) {
      this.result(
        message.sessionId,
        message.reviewScopeId,
        'mark-reviewed',
        false,
        'The file changed. Refresh the review before marking it reviewed.',
      );
      return;
    }
    const currentScope = scope.sdkPatches === undefined ? scope : await this.loadScope(watcherOpenMessage(scope));
    const currentVersion = currentScope.baseline === scope.baseline &&
      currentScope.files.some((entry) => entry.path === file.path)
      ? await this.fileVersion(currentScope, file.path) : 'unavailable';
    if (this.disposed) return;
    if (currentVersion !== file.version) {
      if (scope.sdkPatches !== undefined) {
        await this.reloadActive();
        this.result(message.sessionId, message.reviewScopeId, 'mark-reviewed', false,
          'The SDK Diff changed. Review the refreshed file before marking it reviewed.');
        return;
      }
      file.version = currentVersion;
      scope.reviewed.delete(file.path);
      this.publishState(scope);
      return;
    }
    scope.reviewed.set(file.path, file.version);
    if (
      message.advance &&
      scope.currentIndex !== null &&
      scope.currentIndex < scope.files.length - 1
    ) {
      scope.currentIndex += 1;
      await this.openCurrent(scope);
    }
    scope.lifecycle = this.scopeLifecycle(scope);
    await this.persistScope(scope);
    this.publishState(scope);
  }
  private async openCurrent(scope: ActiveScope, refresh = true): Promise<boolean> {
    if (scope.lifecycle === 'unavailable') return false;
    if (scope.currentIndex === null) return true;
    if (this.options.openSelectionInEditor === false) return true;
    if (refresh) await this.refreshVersions(scope);
    if (this.disposed) return false;
    const file = scope.files[scope.currentIndex];
    if (file === undefined) return true;
    const outcome =
      scope.scopeKind === 'turn'
        ? await this.options.fileDiff.openDiff(
            file.path,
            {
              sessionId: scope.sessionId,
              turnId: scope.turnId!,
            },
            scope.fallbackBaselineRef === undefined
              ? undefined
              : {
                  baselineRef: scope.fallbackBaselineRef,
                  baselineLabel: scope.baselineLabel,
                },
          )
        : await this.options.fileDiff.openDiff(
            file.path,
            { sessionId: scope.sessionId, turnId: scope.reviewScopeId },
            {
              baselineRef: scope.baseline,
              baselineLabel: scope.baselineLabel,
            },
          );
    if (this.disposed) return false;
    if (outcome !== 'opened-diff') {
      file.comparable = false;
      file.restorable = false;
      scope.reviewed.delete(file.path);
      this.result(
        scope.sessionId,
        scope.reviewScopeId,
        'open',
        false,
        outcome === 'not-found'
          ? `${file.path} no longer exists.`
          : `A reliable Diff could not be opened for ${file.path}.`,
      );
      return false;
    }
    return true;
  }
  private async refreshVersions(
    scope: ActiveScope,
    affectedPaths?: ReadonlySet<string>,
  ): Promise<void> {
    if (scope.scopeKind === 'operations') {
      for (const file of scope.files) {
        if (affectedPaths === undefined || file.version === '' || affectedPaths.has(file.path)) {
          file.version = recordedOperationVersion(
            scope.recordedOperations?.filter((entry) => entry.path === file.path) ?? [],
          );
        }
      }
      scope.lifecycle = this.scopeLifecycle(scope);
      return;
    }
    await refreshScopeVersions(
      scope,
      affectedPaths,
      (path) => this.fileVersion(scope, path),
      () => this.disposed,
    );
    if (this.disposed) return;
    scope.lifecycle = this.scopeLifecycle(scope);
  }
  private async fileVersion(scope: ActiveScope, path: string): Promise<string> {
    return reviewFileVersion(this.options, scope, path, this.options.openSelectionInEditor === false);
  }
  private publishState(
    scope: ActiveScope,
    publish: (message: Unsequenced<ReviewHostMessage>) => void = this.options.publish,
  ): void {
    if (this.disposed) return;
    const reviewableCount = scope.files.filter(({ comparable }) => comparable).length;
    const reviewedCount = scope.files.filter(
      ({ path, version, comparable }) => comparable && scope.reviewed.get(path) === version,
    ).length;
    publish({
      type: 'review.state',
      state: {
        sessionId: scope.sessionId,
        reviewScopeId: scope.reviewScopeId,
        scopeKind: scope.scopeKind,
        ...(scope.turnId === undefined ? {} : { turnId: scope.turnId }),
        baseline: scope.baseline,
        baselineLabel: scope.baselineLabel,
        lifecycle: scope.lifecycle,
        files: scope.files.map((file, index) => ({
          path: file.path,
          ...(file.changeKind === undefined ? {} : { changeKind: file.changeKind }),
          additions: file.additions,
          deletions: file.deletions,
          status: !file.comparable
            ? 'open-only'
            : file.restoreConflict
              ? 'restore-conflict'
              : scope.reviewed.get(file.path) === file.version
                ? 'reviewed'
                : scope.reviewed.has(file.path)
                  ? 'changed-after-review'
                  : index === scope.currentIndex
                    ? 'current'
                    : 'unreviewed',
          version: file.version,
          restorable: file.restorable,
        })),
        currentIndex: scope.currentIndex,
        reviewedCount,
        reviewableCount,
        ...(scope.recordedOperations === undefined ? {} : { recordedOnly: true as const }),
        ...(scope.branchCommitCount === undefined
          ? {}
          : { branchCommitCount: scope.branchCommitCount }),
        ...(scope.message === undefined ? {} : { message: scope.message }),
      },
    });
  }
  private scopeLifecycle(scope: ActiveScope): ReviewScopeState['lifecycle'] {
    if (
      scope.lifecycle === 'writing' ||
      scope.lifecycle === 'stale' ||
      scope.lifecycle === 'unavailable'
    ) {
      return scope.lifecycle;
    }
    const comparable = scope.files.filter(({ comparable }) => comparable);
    if (comparable.length === 0) {
      return scope.files.length === 0 ? 'complete' : 'unavailable';
    }
    return comparable.every(({ path, version }) => scope.reviewed.get(path) === version)
      ? 'complete'
      : scope.currentIndex === null
        ? 'settled'
        : 'reviewing';
  }
  private requireScope(message: {
    readonly sessionId: string;
    readonly reviewScopeId: string;
    readonly baseline: string;
  }): ActiveScope | undefined {
    const active = this.active;
    if (
      this.options.isSessionCurrent?.(message.sessionId) === false ||
      active === null ||
      active.sessionId !== message.sessionId ||
      active.reviewScopeId !== message.reviewScopeId ||
      active.baseline !== message.baseline
    ) {
      return undefined;
    }
    return active;
  }

  private async persistScope(scope: ActiveScope): Promise<void> {
    if (this.disposed) return;
    const record: PersistedScope = {
      reviewScopeId: scope.reviewScopeId,
      sessionId: scope.sessionId,
      scopeKind: scope.scopeKind,
      ...(scope.turnId === undefined ? {} : { turnId: scope.turnId }),
      baseline: scope.baseline,
      ...(scope.currentIndex === null
        ? {}
        : { currentPath: scope.files[scope.currentIndex]?.path }),
      reviewed: [...scope.reviewed].map(([path, version]) => ({
        path,
        version,
      })),
      updatedAt: Date.now(),
    };
    const next = new Map(this.persisted);
    next.delete(record.reviewScopeId);
    next.set(record.reviewScopeId, record);
    while (next.size > MAX_PERSISTED_SCOPES) {
      const oldest = next.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      next.delete(oldest);
    }
    await Promise.resolve(
      this.options.persistence.update(REVIEW_STORAGE_KEY, {
        version: REVIEW_STORAGE_VERSION,
        scopes: [...next.values()],
      }),
    );
    if (this.disposed) return;
    this.persisted.clear();
    for (const [id, persisted] of next) this.persisted.set(id, persisted);
  }

  private async previewRestore(
    message: Extract<ReviewWebviewMessage, { type: 'review.restorePreview' }>,
  ): Promise<void> {
    const scope = this.requireScope(message);
    if (
      scope?.scopeKind !== 'operations' ||
      scope.lifecycle === 'writing'
    ) {
      return;
    }
    const paths =
      message.target === 'file' && message.path !== undefined
        ? [message.path]
        : scope.files.map(({ path }) => path);
    if (paths.length > MAX_REVIEW_UNDO_FILES) {
      throw new Error(`Automatic undo supports up to ${MAX_REVIEW_UNDO_FILES} files at a time. Undo individual files instead.`);
    }
    if (
      message.target === 'file' &&
      scope.files.find(({ path }) => path === message.path)?.version !== message.version
    ) {
      return;
    }
    const entries = await this.preflight(scope, paths);
    if (this.disposed) return;
    const preview: RestorePreview = {
      id: randomUUID(),
      reviewScopeId: scope.reviewScopeId,
      baseline: scope.baseline,
      target: message.target,
      entries,
      versions: paths.map((path) => ({ path, version: scope.files.find((file) => file.path === path)!.version })),
    };
    this.previews.clear();
    this.previews.set(preview.id, preview);
    this.publish({
      type: 'review.restorePreview',
      sessionId: scope.sessionId,
      reviewScopeId: scope.reviewScopeId,
      previewId: preview.id,
      target: preview.target,
      restorable: entries.filter(({ status }) => status === 'restorable').map(({ path }) => path),
      conflicted: entries.filter(({ status }) => status !== 'restorable').map(({ path }) => path),
      created: entries
        .filter(({ before, after }) => before === null && after !== null)
        .map(({ path }) => path),
      deleted: entries
        .filter(({ before, after }) => before !== null && after === null)
        .map(({ path }) => path),
    });
  }
  private async preflight(
    scope: ActiveScope,
    paths: readonly string[],
  ): Promise<readonly RestoreEntry[]> {
    const root = this.options.getWorkspaceRoot();
    if (
      root === undefined ||
      scope.turnId === undefined ||
      scope.scopeKind !== 'operations'
    ) {
      return [];
    }
    return preflightOperationRestore(root, scope, paths);
  }

  private async restore(
    message: Extract<ReviewWebviewMessage, { type: 'review.restoreFile' | 'review.restoreTurn' }>,
  ): Promise<void> {
    const scope = this.requireScope(message);
    const preview = this.previews.get(message.previewId);
    const operation = message.type === 'review.restoreFile' ? 'restore-file' : 'restore-turn';
    if (
      scope?.scopeKind !== 'operations' ||
      scope.lifecycle === 'writing' ||
      preview === undefined ||
      preview.reviewScopeId !== message.reviewScopeId ||
      preview.baseline !== message.baseline ||
      preview.target !== (operation === 'restore-file' ? 'file' : 'turn') ||
      preview.versions.some((entry) => scope.files.find((file) => file.path === entry.path)?.version !== entry.version) ||
      preview.target === 'turn' && preview.entries.length !== scope.files.length
    ) {
      this.result(
        message.sessionId,
        message.reviewScopeId,
        operation,
        false,
        'The restore preview is stale. Preview the restore again.',
      );
      return;
    }
    const paths = preview.entries.map(({ path }) => path);
    const fresh = await this.preflight(scope, paths);
    if (this.disposed || this.options.isSessionCurrent?.(message.sessionId) === false) return;
    const blocked = fresh.filter((entry) => entry.status !== 'restorable' ||
      !sameBytes(entry.current, preview.entries.find((saved) => saved.path === entry.path)?.current ?? null));
    if (blocked.length > 0) {
      for (const file of scope.files) {
        file.restoreConflict = blocked.some(({ path }) => path === file.path);
      }
      this.publishState(scope);
      this.result(
        message.sessionId,
        message.reviewScopeId,
        operation,
        false,
        `Undo stopped because ${blocked.length} file(s) changed or are unavailable. Preview again.`,
      );
      return;
    }
    const outcome = await this.applyOperationRestore(scope, fresh);
    if (!outcome.complete) {
      this.previews.clear();
      await this.reloadActive();
      this.result(
        message.sessionId,
        message.reviewScopeId,
        operation,
        false,
        `${outcome.reason ?? 'Undo stopped.'} ${outcome.written} file(s) completed. Any recovery journal was retained.`,
      );
      return;
    }
    if (this.disposed) return;
    this.previews.clear();
    await this.reloadActive();
    this.result(
      message.sessionId,
      message.reviewScopeId,
      operation,
      true,
      operation === 'restore-file'
        ? 'The confirmed file operation was undone.'
        : `${fresh.length} files had their confirmed operations undone.`,
    );
  }

  private async applyOperationRestore(
    scope: ActiveScope,
    entries: readonly RestoreEntry[],
  ): Promise<{ readonly complete: boolean; readonly written: number; readonly reason?: string }> {
    const root = this.options.getWorkspaceRoot();
    if (!root) return { complete: false, written: 0, reason: 'The workspace is unavailable.' };
    const outcome = await applyOperationUndo(this.options.storageDir, root, entries, () =>
      !this.disposed && this.active === scope && this.options.getWorkspaceRoot() === root &&
      this.options.isSessionCurrent?.(scope.sessionId) !== false &&
      (this.options.isOperationWriting?.(scope.sessionId, scope.turnId!) ??
        this.options.isTurnWriting?.(scope.sessionId, scope.turnId!)) !== true);
    if (outcome.complete && !this.disposed) scope.reviewed.clear();
    return outcome;
  }

  private async recoverInterruptedRestore(): Promise<void> {
    try {
      if (!this.disposed) await recoverOperationUndo(this.options.storageDir, this.options.getWorkspaceRoot());
    } catch { this.options.diagnostics?.record({ level: 'warn', name: 'host.review.recovery-blocked' }); }
  }

  private noteWorkspaceChange(uri: vscode.Uri): void {
    if (this.disposed) return;
    if (this.active !== null && this.active.scopeKind !== 'operations')
      this.watcherRefresh.noteWorkspacePath(this.options.getWorkspaceRoot(), uri.fsPath);
  }

  private result(
    sessionId: string,
    reviewScopeId: string,
    operation: Extract<
      Unsequenced<ReviewHostMessage>,
      { type: 'review.operationResult' }
    >['operation'],
    ok: boolean,
    message: string,
  ): void {
    this.publish({
      type: 'review.operationResult',
      sessionId,
      reviewScopeId,
      operation,
      ok,
      message,
    });
  }

  private publish(message: Unsequenced<ReviewHostMessage>): void {
    if (!this.disposed) this.options.publish(message);
  }
}
