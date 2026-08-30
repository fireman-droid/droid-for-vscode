import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => {
  const disposable = (): { dispose(): void } => ({ dispose: vi.fn() });
  return {
    workspace: {
      createFileSystemWatcher: vi.fn(() => ({
        dispose: vi.fn(),
        onDidChange: vi.fn(disposable),
        onDidCreate: vi.fn(disposable),
        onDidDelete: vi.fn(disposable),
      })),
      onDidChangeTextDocument: vi.fn(disposable),
    },
  };
});

import type { ChangeStatsPersistence } from './changeStats';
import type { FileDiffOpener } from './fileDiffOpener';
import type { ReviewAgentRunner } from './reviewAgent';
import { ReviewCoordinator } from './reviewCoordinator';
import { scopeId } from './reviewCoordinatorSupport';
import type { TurnSnapshotStore } from './turnSnapshots';

const files = [
  { path: 'old.txt', additions: 1, deletions: 0 },
  { path: 'latest.txt', additions: 1, deletions: 0 },
] as const;

function createCoordinator(
  persistence: ChangeStatsPersistence,
  publish = vi.fn(),
  openDiff = vi.fn<FileDiffOpener['openDiff']>(
    async () => 'opened-diff',
  ),
  snapshots = {} as TurnSnapshotStore,
  runAgentReview?: ReviewAgentRunner,
): ReviewCoordinator {
  return new ReviewCoordinator({
    getWorkspaceRoot: () => 'Z:\\missing-review-workspace',
    snapshots,
    fileDiff: { openDiff },
    persistence,
    storageDir: 'Z:\\missing-review-storage',
    publish,
    readWorkspaceFiles: async () => ({
      baseline: 'head-baseline',
      files,
    }),
    readBranchDiff: async () => undefined,
    runAgentReview,
  });
}

describe('ReviewCoordinator reload recovery', () => {
  it('publishes Branch state before Diff and reports when it opens', async () => {
    const persistence: ChangeStatsPersistence = {
      get: <T,>() => undefined as T | undefined,
      update: vi.fn(() => Promise.resolve()),
    };
    const publish = vi.fn();
    let resolveOpen: ((outcome: 'opened-diff') => void) | undefined;
    const openDiff = vi.fn<FileDiffOpener['openDiff']>(
      () =>
        new Promise((resolve) => {
          resolveOpen = resolve;
        }),
    );
    const readBranchDiff = vi.fn(async () => ({
      baseline: 'branch-baseline',
      diff: {
        branch: 'feature/review',
        baseBranch: 'main',
        files: [{ path: 'old.txt', additions: 1, deletions: 0 }],
        additions: 1,
        deletions: 0,
        commitCount: 2,
      },
    }));
    const coordinator = new ReviewCoordinator({
      getWorkspaceRoot: () => 'Z:\\missing-review-workspace',
      snapshots: {} as TurnSnapshotStore,
      fileDiff: { openDiff },
      persistence,
      storageDir: 'Z:\\missing-review-storage',
      publish,
      readWorkspaceFiles: async () => ({
        baseline: 'head-baseline',
        files,
      }),
      readBranchDiff,
    });

    coordinator.handle({
      type: 'review.open',
      sessionId: 'session-1',
      scopeKind: 'branch',
    });

    await vi.waitFor(() => {
      expect(publish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'review.state',
          state: expect.objectContaining({
            scopeKind: 'branch',
            branchCommitCount: 2,
          }),
        }),
      );
    });
    expect(readBranchDiff).toHaveBeenCalledOnce();
    expect(openDiff).toHaveBeenCalledOnce();
    expect(publish).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'review.operationResult',
        operation: 'open',
        ok: true,
      }),
    );

    resolveOpen?.('opened-diff');
    await coordinator.replay('session-1');

    expect(readBranchDiff).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'review.operationResult',
        operation: 'open',
        ok: true,
      }),
    );
    coordinator.dispose();
  });

  it('restores the current Session latest scope without reopening Diff', async () => {
    const currentScopeId = scopeId(
      {
        type: 'review.open',
        sessionId: 'session-1',
        scopeKind: 'workspace',
      },
      'head-baseline',
    );
    const persistence: ChangeStatsPersistence = {
      get: <T,>() =>
        ({
          version: 1,
          scopes: [
            {
              reviewScopeId: 'old-branch-scope',
              sessionId: 'session-1',
              scopeKind: 'branch',
              baseline: 'branch-baseline',
              currentPath: 'old.txt',
              reviewed: [],
              updatedAt: 1,
            },
            {
              reviewScopeId: 'other-session',
              sessionId: 'session-2',
              scopeKind: 'workspace',
              baseline: 'head-baseline',
              currentPath: 'old.txt',
              reviewed: [],
              updatedAt: 3,
            },
            {
            reviewScopeId: currentScopeId,
              sessionId: 'session-1',
              scopeKind: 'workspace',
              baseline: 'head-baseline',
              currentPath: 'latest.txt',
              reviewed: [],
              updatedAt: 2,
            },
          ],
        }) as T,
      update: vi.fn(),
    };
    const publish = vi.fn();
    const openDiff = vi.fn<FileDiffOpener['openDiff']>(
      async () => 'opened-diff',
    );
    const coordinator = createCoordinator(persistence, publish, openDiff);

    await coordinator.replayTo('session-1', publish);

    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'review.state',
        state: expect.objectContaining({
          sessionId: 'session-1',
          currentIndex: 1,
        }),
      }),
    );
    expect(openDiff).not.toHaveBeenCalled();
    coordinator.dispose();
  });

  it('opens the current Diff when a scope is opened', async () => {
    const update = vi.fn(() => Promise.resolve());
    const persistence: ChangeStatsPersistence = {
      get: <T,>() => undefined as T | undefined,
      update,
    };
    const openDiff = vi.fn<FileDiffOpener['openDiff']>(
      async () => 'opened-diff',
    );
    const coordinator = createCoordinator(persistence, vi.fn(), openDiff);
    const reviewScopeId = scopeId(
      {
        type: 'review.open',
        sessionId: 'session-1',
        scopeKind: 'workspace',
      },
      'head-baseline',
    );

    coordinator.handle({
      type: 'review.open',
      sessionId: 'session-1',
      scopeKind: 'workspace',
    });
    await coordinator.replay('session-1');

    expect(openDiff).toHaveBeenCalledOnce();
    expect(openDiff).toHaveBeenCalledWith(
      'old.txt',
      { sessionId: 'session-1', turnId: reviewScopeId },
      { baselineRef: 'head-baseline', baselineLabel: 'HEAD' },
    );
    expect(update).toHaveBeenCalledWith(
      'droidvisx.reviewState',
      expect.objectContaining({
        version: 1,
        scopes: [
          expect.objectContaining({
            sessionId: 'session-1',
            scopeKind: 'workspace',
            currentPath: 'old.txt',
          }),
        ],
      }),
    );

    coordinator.handle({
      type: 'review.selectFile',
      sessionId: 'session-1',
      reviewScopeId,
      baseline: 'head-baseline',
      path: 'latest.txt',
    });
    await coordinator.replay('session-1');

    expect(openDiff).toHaveBeenCalledTimes(2);
    expect(openDiff).toHaveBeenCalledWith(
      'latest.txt',
      { sessionId: 'session-1', turnId: reviewScopeId },
      { baselineRef: 'head-baseline', baselineLabel: 'HEAD' },
    );
    expect(update).toHaveBeenLastCalledWith(
      'droidvisx.reviewState',
      expect.objectContaining({
        scopes: [
          expect.objectContaining({
            currentPath: 'latest.txt',
          }),
        ],
      }),
    );
    coordinator.dispose();
  });

  it('falls back to HEAD when a turn snapshot is unavailable', async () => {
    const persistence: ChangeStatsPersistence = {
      get: <T,>() => undefined as T | undefined,
      update: vi.fn(() => Promise.resolve()),
    };
    const openDiff = vi.fn<FileDiffOpener['openDiff']>(
      async () => 'opened-diff',
    );
    const snapshots = {
      read: () => ({
        turnId: 'turn-1',
        files: [{ path: 'latest.txt', additions: 3, deletions: 1 }],
      }),
    } as unknown as TurnSnapshotStore;
    const publish = vi.fn();
    const coordinator = createCoordinator(
      persistence,
      publish,
      openDiff,
      snapshots,
    );

    coordinator.handle({
      type: 'review.open',
      sessionId: 'session-1',
      scopeKind: 'turn',
      turnId: 'turn-1',
    });
    await coordinator.replay('session-1');

    expect(openDiff).toHaveBeenCalledWith(
      'latest.txt',
      { sessionId: 'session-1', turnId: 'turn-1' },
      { baselineRef: 'head-baseline', baselineLabel: 'HEAD' },
    );
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'review.state',
        state: expect.objectContaining({
          lifecycle: 'reviewing',
          baseline: 'head-baseline',
          files: [
            expect.objectContaining({
              path: 'latest.txt',
              restorable: false,
            }),
          ],
        }),
      }),
    );
    coordinator.dispose();
  });

  it('refreshes an opened writing turn and settles it without reopening Diff', async () => {
    const persistence: ChangeStatsPersistence = {
      get: <T,>() => undefined as T | undefined,
      update: vi.fn(() => Promise.resolve()),
    };
    let snapshotState: 'missing' | 'before' | 'settled' = 'missing';
    const snapshots = {
      read: () =>
        snapshotState === 'settled'
          ? {
              turnId: 'turn-1',
              before: 'before-tree',
              after: 'after-tree',
              files: [
                { path: 'latest.txt', additions: 2, deletions: 1 },
              ],
            }
          : snapshotState === 'before'
            ? { turnId: 'turn-1', before: 'before-tree' }
            : { turnId: 'turn-1' },
    } as unknown as TurnSnapshotStore;
    const publish = vi.fn();
    const openDiff = vi.fn<FileDiffOpener['openDiff']>(
      async () => 'opened-diff',
    );
    const coordinator = createCoordinator(
      persistence,
      publish,
      openDiff,
      snapshots,
    );

    coordinator.openWritingTurn('session-1', 'turn-1', [
      { path: 'old.txt', additions: null, deletions: null },
    ]);
    const writingState = publish.mock.calls.at(-1)?.[0]?.state;
    snapshotState = 'before';
    coordinator.refreshWritingTurn('session-1', 'turn-1', [
      { path: 'old.txt', additions: 1, deletions: 0 },
      { path: 'latest.txt', additions: null, deletions: null },
    ]);
    expect(publish).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: 'review.state',
        state: expect.objectContaining({
          reviewScopeId: writingState.reviewScopeId,
          baseline: writingState.baseline,
          lifecycle: 'writing',
          files: [
            expect.objectContaining({ path: 'old.txt' }),
            expect.objectContaining({ path: 'latest.txt' }),
          ],
        }),
      }),
    );
    coordinator.handle({
      type: 'review.selectFile',
      sessionId: 'session-1',
      reviewScopeId: writingState.reviewScopeId,
      baseline: writingState.baseline,
      path: 'latest.txt',
    });
    await coordinator.replay('session-1');
    expect(openDiff).toHaveBeenCalledWith(
      'latest.txt',
      { sessionId: 'session-1', turnId: 'turn-1' },
      undefined,
    );

    snapshotState = 'settled';
    coordinator.settleWritingTurn('session-1', 'turn-1', [
      { path: 'latest.txt', additions: 2, deletions: 1 },
    ]);
    await coordinator.replay('session-1');
    expect(publish).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: 'review.state',
        state: expect.objectContaining({
          files: [expect.objectContaining({ path: 'latest.txt' })],
        }),
      }),
    );
    coordinator.dispose();
  });

  it('rejects Agent Review for a private turn baseline', async () => {
    const persistence: ChangeStatsPersistence = {
      get: <T,>() => undefined as T | undefined,
      update: vi.fn(() => Promise.resolve()),
    };
    const publish = vi.fn();
    const run = vi.fn<ReviewAgentRunner['run']>();
    const snapshots = {
      read: () => ({ turnId: 'turn-1', before: 'before-tree' }),
    } as unknown as TurnSnapshotStore;
    const coordinator = createCoordinator(
      persistence,
      publish,
      undefined,
      snapshots,
      { run },
    );
    coordinator.openWritingTurn('session-1', 'turn-1', [
      { path: 'old.txt', additions: null, deletions: null },
    ]);
    const reviewScopeId = scopeId(
      {
        type: 'review.open',
        sessionId: 'session-1',
        scopeKind: 'turn',
        turnId: 'turn-1',
      },
      'before-tree',
    );
    coordinator.handle({
      type: 'review.runAgentReview',
      sessionId: 'session-1',
      reviewScopeId,
      baseline: 'before-tree',
    });
    await coordinator.replay('session-1');

    expect(run).not.toHaveBeenCalled();
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'review.agentReviewState',
        status: 'failed',
      }),
    );
    coordinator.dispose();
  });
});
