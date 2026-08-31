import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import * as vscode from 'vscode';

import type { RuntimeGitDiff } from '../runtime/DroidRuntime';
import type {
  ReviewHostMessage,
  ReviewOpenMessage,
  ReviewScopeState,
  ReviewWebviewMessage,
} from '../shared/reviewProtocol';
import type { RuntimeDiagnosticSink } from '../runtime/runtimeDiagnostics';
import { toWorkspaceRelativePath } from '../runtime/toolFilePath';
import type { ChangeStatsPersistence, CommittedFileStat } from './changeStats';
import type { FileDiffOpener } from './fileDiffOpener';
import type { TurnSnapshotStore } from './turnSnapshots';
import {
  refreshScopeVersions,
  ReviewWatcherRefresh,
  watcherOpenMessage,
} from './reviewWatcherRefresh';
import { runAgentReview, type ReviewAgentRunner } from './reviewAgent';
import {
  digest,
  createActiveScope,
  isNotFound,
  isRecoveryEntry,
  latestPersistedScope,
  readPersistedScopes,
  restoreRecovery,
  sameBytes,
  scopeId,
  unavailableScope,
  type ActiveScope,
  type PersistedScope,
  type RecoveryEntry,
} from './reviewCoordinatorSupport';
import { openWritingTurn, refreshWritingTurn, settleWritingTurn, type ReviewWritingScopeHost } from './reviewWritingScopes';

const REVIEW_STORAGE_KEY = 'droidvisx.reviewState';
const REVIEW_STORAGE_VERSION = 1;
const MAX_PERSISTED_SCOPES = 16;
const MAX_RESTORE_BYTES = 16 * 1024 * 1024;
const RECOVERY_LOG = 'restore-recovery.json';
type Unsequenced<T> = T extends { readonly sequence: number }
  ? Omit<T, 'sequence'>
  : never;
type CanonicalTurnFiles = (sessionId: string, turnId: string) =>
  readonly CommittedFileStat[] | undefined;
export interface ReviewCoordinatorOptions {
  readonly getWorkspaceRoot: () => string | undefined;
  readonly snapshots: TurnSnapshotStore;
  readonly fileDiff: FileDiffOpener;
  readonly persistence: ChangeStatsPersistence;
  readonly storageDir: string;
  readonly publish: (message: Unsequenced<ReviewHostMessage>) => void;
  readonly readCanonicalTurnFiles: CanonicalTurnFiles;
  readonly readWorkspaceFiles: () => Promise<
    | { readonly baseline: string; readonly files: readonly CommittedFileStat[] }
    | undefined
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
}
export class ReviewCoordinator implements vscode.Disposable {
  private active: ActiveScope | null = null;
  private readonly persisted: Map<string, PersistedScope>;
  private readonly previews = new Map<string, RestorePreview>();
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
      setActive: (scope) => { if (!this.disposed) this.active = scope; },
      publish: (scope) => this.publishState(scope),
      loadSettled: (sessionId, turnId) =>
        this.loadTurnScope(sessionId, turnId),
      refreshVersions: (scope) => this.disposed ? Promise.resolve() : this.refreshVersions(scope),
      persist: (scope) => this.persistScope(scope),
      enqueue: (task) => this.enqueue(task, true),
    };
    this.watcherRefresh = new ReviewWatcherRefresh({
      getActive: () => this.active,
      setActive: (scope) => { if (!this.disposed) this.active = scope; },
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
    void this.recoverInterruptedRestore();
  }
  handle(message: ReviewWebviewMessage): void {
    if (this.disposed) return;
    void this.enqueue(() => this.handleNow(message))
      .catch((error) => {
        if (!this.disposed) this.result(
          message.sessionId,
          ('reviewScopeId' in message ? message.reviewScopeId : undefined) ??
            'review',
          'open',
          false,
          error instanceof Error ? error.message : 'Review operation failed.',
        );
      });
  }
  openWritingTurn(
    sessionId: string,
    turnId: string,
    files: readonly CommittedFileStat[],
  ): void {
    if (this.disposed) return;
    openWritingTurn(this.writingScopes, sessionId, turnId, files);
  }
  refreshWritingTurn(
    sessionId: string,
    turnId: string,
    files: readonly CommittedFileStat[],
  ): void {
    if (this.disposed) return;
    refreshWritingTurn(this.writingScopes, sessionId, turnId, files);
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
  }
  private enqueue(
    task: () => Promise<void>,
    reportFailure = false,
  ): Promise<void> {
    const result = this.operation.then(() => this.disposed ? undefined : task());
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
    if (this.disposed) return;
    await this.refreshVersions(loaded);
    if (this.disposed) return;
    this.active = loaded;
    this.publishState(loaded);
    if (this.disposed) return;
    (await this.openCurrent(loaded, false))
      ? this.result(loaded.sessionId, loaded.reviewScopeId, 'open', true, 'Review opened.')
      : this.publishState(loaded);
    await this.persistScope(loaded);
  }
  private async loadScope(message: ReviewOpenMessage): Promise<ActiveScope> {
    if (message.scopeKind === 'turn') {
      return this.loadTurnScope(message.sessionId, message.turnId!);
    }
    if (message.scopeKind === 'workspace') {
      const source = await this.options.readWorkspaceFiles();
      if (source === undefined) {
        return unavailableScope(message, 'HEAD is unavailable for this workspace.');
      }
      return createActiveScope(
        message,
        source.baseline,
        'HEAD',
        source.files,
        this.persisted,
      );
    }
    const source = await this.options.readBranchDiff();
    if (source === undefined) {
      return unavailableScope(message, 'Branch comparison is unavailable.');
    }
    return Object.assign(
      createActiveScope(message, source.baseline, source.diff.baseBranch,
        source.diff.files, this.persisted),
      { branchCommitCount: source.diff.commitCount },
    );
  }
  private async loadTurnScope(sessionId: string, turnId: string): Promise<ActiveScope> {
    const record = this.options.snapshots.read(sessionId, turnId);
    const files = this.options.readCanonicalTurnFiles(sessionId, turnId) ?? record?.files ?? [];
    const message: ReviewOpenMessage = {
      type: 'review.open',
      sessionId,
      scopeKind: 'turn',
      turnId,
    };
    if (record?.before === undefined || record.after === undefined) {
      if (files.length > 0) {
        const workspace = await this.options.readWorkspaceFiles();
        const fallback = createActiveScope(
          message,
          workspace?.baseline ?? record?.before ?? `missing-${turnId}`,
          'HEAD',
          files,
          this.persisted,
          true,
          false,
          workspace?.baseline,
        );
        fallback.message =
          workspace === undefined
            ? 'This turn has no complete snapshot. Review is read-only.'
            : 'This turn has no complete snapshot. Showing HEAD vs working tree.';
        return fallback;
      }
      const unavailable = createActiveScope(
        message,
        record?.before ?? `missing-${turnId}`,
        'Before turn',
        files,
        this.persisted,
        false,
      );
      unavailable.lifecycle = 'unavailable';
      unavailable.message = 'This turn no longer has a complete before/after snapshot.';
      return unavailable;
    }
    return createActiveScope(
      message,
      `${record.before}:${record.after}`,
      'Before turn',
      files,
      this.persisted,
    );
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
    const currentVersion = await this.fileVersion(scope, file.path);
    if (this.disposed) return;
    if (currentVersion !== file.version) {
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
    if (scope.currentIndex === null) return true;
    if (refresh) await this.refreshVersions(scope);
    if (this.disposed) return false;
    const file = scope.files[scope.currentIndex];
    if (file === undefined) return true;
    const outcome =
      scope.scopeKind === 'turn'
        ? await this.options.fileDiff.openDiff(file.path, {
            sessionId: scope.sessionId,
            turnId: scope.turnId!,
          }, scope.fallbackBaselineRef === undefined ? undefined : {
            baselineRef: scope.fallbackBaselineRef,
            baselineLabel: scope.baselineLabel,
          })
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
    await refreshScopeVersions(
      scope, affectedPaths,
      (path) => this.fileVersion(scope, path),
      () => this.disposed,
    );
    if (this.disposed) return;
    scope.lifecycle = this.scopeLifecycle(scope);
  }
  private async fileVersion(scope: ActiveScope, path: string): Promise<string> {
    const root = this.options.getWorkspaceRoot();
    if (root === undefined) {
      return 'unavailable';
    }
    let current: Buffer | null;
    try {
      current = await readFile(join(root, path));
    } catch (error) {
      current = isNotFound(error) ? null : Buffer.from('unavailable');
    }
    return digest([
      scope.baseline,
      path,
      current === null ? '<deleted>' : current,
    ]);
  }
  private publishState(
    scope: ActiveScope,
    publish: (message: Unsequenced<ReviewHostMessage>) => void =
      this.options.publish,
  ): void {
    if (this.disposed) return;
    const reviewableCount = scope.files.filter(({ comparable }) => comparable).length;
    const reviewedCount = scope.files.filter(
      ({ path, version, comparable }) =>
        comparable && scope.reviewed.get(path) === version,
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
    return comparable.every(
      ({ path, version }) => scope.reviewed.get(path) === version,
    )
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
    if (scope?.scopeKind !== 'turn' || scope.lifecycle === 'writing') {
      return;
    }
    const paths =
      message.target === 'file' && message.path !== undefined
        ? [message.path]
        : scope.files.map(({ path }) => path);
    if (
      message.target === 'file' &&
      scope.files.find(({ path }) => path === message.path)?.version !==
        message.version
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
    };
    this.previews.clear();
    this.previews.set(preview.id, preview);
    this.publish({
      type: 'review.restorePreview',
      sessionId: scope.sessionId,
      reviewScopeId: scope.reviewScopeId,
      previewId: preview.id,
      target: preview.target,
      restorable: entries
        .filter(({ status }) => status === 'restorable')
        .map(({ path }) => path),
      conflicted: entries
        .filter(({ status }) => status !== 'restorable')
        .map(({ path }) => path),
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
    if (root === undefined || scope.turnId === undefined) {
      return [];
    }
    const entries: RestoreEntry[] = [];
    for (const path of paths) {
      const snapshotPaths = this.options.snapshots.read(
        scope.sessionId, scope.turnId,
      )?.snapshotPaths;
      const before = await this.options.snapshots.readTreeBytes(
        { sessionId: scope.sessionId, turnId: scope.turnId },
        path,
        'before',
      );
      const after = await this.options.snapshots.readTreeBytes(
        { sessionId: scope.sessionId, turnId: scope.turnId },
        path,
        'after',
      );
      let current: Buffer | null | undefined;
      try {
        current = await readFile(join(root, path));
      } catch (error) {
        current = isNotFound(error) ? null : undefined;
      }
      const dirty = vscode.workspace.textDocuments.some((document) => {
        const relative = toWorkspaceRelativePath(root, document.uri.fsPath);
        return relative === path && document.isDirty;
      });
      const supported =
        before !== undefined &&
        after !== undefined &&
        current !== undefined &&
        (before !== null || after !== null || snapshotPaths?.includes(path) === true) &&
        (before?.length ?? 0) <= MAX_RESTORE_BYTES &&
        (after?.length ?? 0) <= MAX_RESTORE_BYTES;
      entries.push({
        path,
        before: before ?? null,
        after: after ?? null,
        current: current ?? null,
        status:
          !supported || current === undefined || after === undefined
            ? 'unsupported'
            : dirty || !sameBytes(current, after)
              ? 'conflicted'
              : 'restorable',
      });
    }
    return entries;
  }

  private async restore(
    message: Extract<
      ReviewWebviewMessage,
      { type: 'review.restoreFile' | 'review.restoreTurn' }
    >,
  ): Promise<void> {
    const scope = this.requireScope(message);
    const preview = this.previews.get(message.previewId);
    const operation =
      message.type === 'review.restoreFile' ? 'restore-file' : 'restore-turn';
    if (
      scope?.scopeKind !== 'turn' ||
      preview === undefined ||
      preview.reviewScopeId !== message.reviewScopeId ||
      preview.baseline !== message.baseline ||
      preview.target !== (operation === 'restore-file' ? 'file' : 'turn')
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
    if (this.disposed) return;
    const blocked = fresh.filter(({ status }) => status !== 'restorable');
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
        `Restore stopped because ${blocked.length} file(s) changed or are unavailable.`,
      );
      return;
    }
    await this.applyRestore(scope, fresh);
    if (this.disposed) return;
    this.previews.clear();
    await this.reloadActive();
    this.result(
      message.sessionId,
      message.reviewScopeId,
      operation,
      true,
      operation === 'restore-file'
        ? 'File restored to its before-turn state.'
        : `${fresh.length} files restored to their before-turn state.`,
    );
  }

  private async applyRestore(
    scope: ActiveScope,
    entries: readonly RestoreEntry[],
  ): Promise<void> {
    const root = this.options.getWorkspaceRoot()!;
    const recovery: RecoveryEntry[] = entries.map(({ path, current }) => ({
      path,
      existed: current !== null,
      ...(current === null ? {} : { dataBase64: current.toString('base64') }),
    }));
    await mkdir(this.options.storageDir, { recursive: true });
    const recoveryPath = join(this.options.storageDir, RECOVERY_LOG);
    await writeFile(
      recoveryPath,
      JSON.stringify({ version: 1, root, entries: recovery }),
      'utf8',
    );
    try {
      for (const entry of entries) {
        const target = join(root, entry.path);
        if (entry.before === null) {
          await unlink(target);
        } else {
          await mkdir(dirname(target), { recursive: true });
          await writeFile(target, entry.before);
        }
      }
      await rm(recoveryPath, { force: true });
    } catch (error) {
      await restoreRecovery(root, recovery);
      await rm(recoveryPath, { force: true }).catch(() => undefined);
      throw error;
    }
    if (!this.disposed) scope.reviewed.clear();
  }

  private async recoverInterruptedRestore(): Promise<void> {
    const path = join(this.options.storageDir, RECOVERY_LOG);
    try {
      const parsed = JSON.parse(await readFile(path, 'utf8')) as {
        root?: unknown;
        entries?: unknown;
      };
      if (
        typeof parsed.root === 'string' &&
        Array.isArray(parsed.entries) &&
        parsed.entries.every(isRecoveryEntry)
      ) {
        if (this.disposed) return;
        await restoreRecovery(parsed.root, parsed.entries);
      }
      await rm(path, { force: true });
    } catch (error) {
      if (!isNotFound(error)) {
        // Keep the recovery file for the next activation if recovery failed.
      }
    }
  }

  private noteWorkspaceChange(uri: vscode.Uri): void {
    if (this.disposed) return;
    if (this.active !== null) this.watcherRefresh.noteWorkspacePath(
      this.options.getWorkspaceRoot(), uri.fsPath,
    );
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
