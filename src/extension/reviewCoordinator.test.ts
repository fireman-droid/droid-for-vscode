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
  });
}

describe('ReviewCoordinator reload recovery', () => {
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
});
