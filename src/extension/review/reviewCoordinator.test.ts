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
      textDocuments: [],
    },
  };
});

import type { ChangeStatsPersistence } from '../changes/changeStats';
import type { FileDiffOpener } from '../changes/fileDiffOpener';
import type { ReviewAgentRunner } from './reviewAgent';
import type { RuntimeDiagnosticSink } from '../../runtime/runtimeDiagnostics';
import { ReviewCoordinator } from './reviewCoordinator';
import { scopeId } from './reviewCoordinatorSupport';
import type { TurnSnapshotStore } from '../changes/turnSnapshots';
import { loadTurnReviewScope } from './reviewTurnScope';
import { readReviewContents, readReviewPatch } from './reviewContent';
import { loadOperationReviewScope } from './reviewOperationScope';

const files = [
  { path: 'old.txt', additions: 1, deletions: 0 },
  { path: 'latest.txt', additions: 1, deletions: 0 },
] as const;

function createCoordinator(
  persistence: ChangeStatsPersistence,
  publish = vi.fn(),
  openDiff = vi.fn<FileDiffOpener['openDiff']>(async () => 'opened-diff'),
  snapshots = {} as TurnSnapshotStore,
  runAgentReview?: ReviewAgentRunner,
  diagnostics?: Pick<RuntimeDiagnosticSink, 'record'>,
): ReviewCoordinator {
  return new ReviewCoordinator({
    getWorkspaceRoot: () => 'Z:\\missing-review-workspace',
    snapshots,
    fileDiff: { openDiff },
    persistence,
    storageDir: 'Z:\\missing-review-storage',
    publish,
    readCanonicalTurnFiles: () => undefined,
    readWorkspaceFiles: async () => ({
      baseline: 'head-baseline',
      files,
    }),
    readBranchDiff: async () => undefined,
    runAgentReview,
    diagnostics,
  });
}

describe('ReviewCoordinator reload recovery', () => {
  it('keeps historical operation excerpts separate when no turn snapshot exists', async () => {
    const operations = [
      { toolUseId: 'first', path: 'old.txt', patch: '@@ -1 +1 @@\n-before\n+middle' },
      { toolUseId: 'second', path: 'old.txt', patch: '@@ -1 +1 @@\n-middle\n+after' },
    ];
    const snapshots = { read: () => undefined, readTreeBytes: vi.fn(async () => undefined) } as unknown as TurnSnapshotStore;
    const options = { snapshots, getWorkspaceRoot: () => 'Z:\\missing-review-workspace',
      readCanonicalTurnFiles: () => files, readTurnOperations: () => [
        { toolUseId: 'context-only', path: 'old.txt', patch: '@@\n unchanged context' },
        { toolUseId: 'identical', path: 'latest.txt', patch: '@@\n-same\n+same' },
        ...operations,
      ],
    };
    const scope = loadTurnReviewScope(options, new Map(), null, 'session-1', 'turn-1');
    expect(scope).toMatchObject({ lifecycle: 'unavailable', baselineLabel: 'Before turn → after turn' });
    expect(scope.files.every((file) => !file.comparable && !file.restorable)).toBe(true);
    const recorded = loadOperationReviewScope({ type: 'review.open', sessionId: 'session-1', scopeKind: 'operations', turnId: 'turn-1' },
      operations.map((operation, sequence) => ({ sequence, sessionId: 'session-1', toolUseId: operation.toolUseId, toolName: 'Edit',
        operationDiff: { status: 'ready', source: 'tool-result', files: [{ path: operation.path, patch: operation.patch, kind: 'modified', outcome: 'applied' }] },
      })), new Map());
    expect(await readReviewPatch(options, recorded, 'old.txt', 3)).toMatchObject({
      patch: '', truncated: false, recordedOperations: operations.map(({ toolUseId, patch }) => ({ toolUseId, patch })),
    });
    expect(snapshots.readTreeBytes).not.toHaveBeenCalled();
    await expect(readReviewPatch(options, recorded, 'latest.txt', 3)).rejects.toThrow('Review file is no longer available');
    await expect(readReviewContents(options, scope, 'old.txt')).rejects.toThrow('saved baseline for this turn is unavailable');
  });

  it('loads Branch state without opening Diff and refreshes explicitly', async () => {
    const persistence: ChangeStatsPersistence = {
      get: <T>() => undefined as T | undefined,
      update: vi.fn(() => Promise.resolve()),
    };
    const publish = vi.fn();
    const openDiff = vi.fn<FileDiffOpener['openDiff']>(async () => 'opened-diff');
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
      readCanonicalTurnFiles: () => undefined,
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
    expect(openDiff).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'review.operationResult',
        operation: 'open',
        ok: true,
      }),
    );

    await coordinator.replay('session-1');
    expect(readBranchDiff).toHaveBeenCalledOnce();
    coordinator.handle({
      type: 'review.refresh',
      sessionId: 'session-1',
      reviewScopeId: scopeId(
        {
          type: 'review.open',
          sessionId: 'session-1',
          scopeKind: 'branch',
        },
        'branch-baseline',
      ),
    });
    await coordinator.replay('session-1');
    expect(readBranchDiff).toHaveBeenCalledTimes(2);
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
      get: <T>() =>
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
    const openDiff = vi.fn<FileDiffOpener['openDiff']>(async () => 'opened-diff');
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

  it('opens the current Diff only when explicitly requested', async () => {
    const update = vi.fn(() => Promise.resolve());
    const persistence: ChangeStatsPersistence = {
      get: <T>() => undefined as T | undefined,
      update,
    };
    const openDiff = vi.fn<FileDiffOpener['openDiff']>(async () => 'opened-diff');
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
      openCurrent: true,
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

  it('reports missing turn snapshots without silently substituting HEAD', async () => {
    const persistence: ChangeStatsPersistence = {
      get: <T>() => undefined as T | undefined,
      update: vi.fn(() => Promise.resolve()),
    };
    const openDiff = vi.fn<FileDiffOpener['openDiff']>(async () => 'opened-diff');
    const snapshots = {
      read: () => ({
        turnId: 'turn-1',
        files: [{ path: 'latest.txt', additions: 3, deletions: 1 }],
      }),
    } as unknown as TurnSnapshotStore;
    const publish = vi.fn();
    const coordinator = createCoordinator(persistence, publish, openDiff, snapshots);

    coordinator.handle({
      type: 'review.open',
      sessionId: 'session-1',
      scopeKind: 'turn',
      turnId: 'turn-1',
      openCurrent: true,
    });
    await coordinator.replay('session-1');

    expect(openDiff).not.toHaveBeenCalled();
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'review.state',
        state: expect.objectContaining({
          lifecycle: 'unavailable',
          baseline: 'missing-turn-1',
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
      get: <T>() => undefined as T | undefined,
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
              files: [{ path: 'latest.txt', additions: 2, deletions: 1 }],
            }
          : snapshotState === 'before'
            ? { turnId: 'turn-1', before: 'before-tree' }
            : { turnId: 'turn-1' },
    } as unknown as TurnSnapshotStore;
    const publish = vi.fn();
    const openDiff = vi.fn<FileDiffOpener['openDiff']>(async () => 'opened-diff');
    const coordinator = createCoordinator(persistence, publish, openDiff, snapshots);

    coordinator.openWritingTurn('session-1', 'turn-1', [
      { path: 'old.txt', additions: null, deletions: null },
    ]);
    const writingState = publish.mock.calls.at(-1)?.[0]?.state;
    snapshotState = 'before';
    coordinator.refreshWritingTurn('session-1', 'turn-1', [
      { path: 'old.txt', additions: 1, deletions: 0 },
      { path: 'latest.txt', additions: null, deletions: null },
    ]);
    await coordinator.replay('session-1');
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

    coordinator.handle({ type: 'review.open', sessionId: 'session-1', scopeKind: 'turn', turnId: 'turn-1' });
    await coordinator.replay('session-1');
    expect(publish.mock.calls.at(-1)?.[0]?.state).toMatchObject({
      lifecycle: 'writing',
      files: [expect.objectContaining({ path: 'old.txt' }), expect.objectContaining({ path: 'latest.txt' })],
    });

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

  it('uses canonical turn rows and saved file bytes for Review without granting turn Undo', async () => {
    const persistence: ChangeStatsPersistence = {
      get: <T>() => undefined as T | undefined,
      update: vi.fn(() => Promise.resolve()),
    };
    const publish = vi.fn();
    const readTreeBytes = vi.fn(async (_scope: unknown, _path: string, phase: string) => Buffer.from(phase === 'before' ? 'before\n' : 'after\n'));
    const coordinator = new ReviewCoordinator({
      getWorkspaceRoot: () => 'Z:\\missing-review-workspace',
      snapshots: {
        read: () => ({
          turnId: 'turn-1',
          before: 'before-tree',
          after: 'after-tree',
          snapshotPaths: ['canonical.txt'],
          files: [{ path: 'legacy.txt', additions: 99, deletions: 99 }],
        }),
        readTreeBytes,
      } as unknown as TurnSnapshotStore,
      fileDiff: {
        openDiff: vi.fn<FileDiffOpener['openDiff']>(async () => 'opened-diff'),
      },
      persistence,
      storageDir: 'Z:\\missing-review-storage',
      publish,
      readCanonicalTurnFiles: () => [
        { path: 'canonical.txt', additions: 2, deletions: 1 },
      ],
      readWorkspaceFiles: async () => ({
        baseline: 'head-baseline',
        files,
      }),
      readBranchDiff: async () => undefined,
    });

    coordinator.handle({
      type: 'review.open',
      sessionId: 'session-1',
      scopeKind: 'turn',
      turnId: 'turn-1',
    });
    await coordinator.replay('session-1');

    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'review.state',
        state: expect.objectContaining({
          files: [
            expect.objectContaining({
              path: 'canonical.txt',
              additions: 2,
              deletions: 1,
            }),
          ],
        }),
      }),
    );
    const state = publish.mock.calls.find(
      ([message]) => message.type === 'review.state',
    )?.[0]?.state;
    const content = await coordinator.readFile({ sessionId: 'session-1', reviewScopeId: state.reviewScopeId,
      baseline: state.baseline, path: 'canonical.txt', context: 'all' });
    expect(content.patch).toContain('-before\n+after');
    coordinator.handle({
      type: 'review.restorePreview',
      sessionId: 'session-1',
      reviewScopeId: state.reviewScopeId,
      baseline: state.baseline,
      target: 'turn',
    });
    await coordinator.replay('session-1');

    expect(readTreeBytes).toHaveBeenCalledWith(
      { sessionId: 'session-1', turnId: 'turn-1' },
      'canonical.txt',
      'before',
    );
    expect(readTreeBytes).not.toHaveBeenCalledWith(
      expect.anything(),
      'legacy.txt',
      expect.anything(),
    );
    expect(state.files[0].restorable).toBe(false);
    expect(publish).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'review.restorePreview' }));
    coordinator.dispose();
  });

  it('keeps canonical Review rows when snapshot metadata makes Restore unavailable', async () => {
    const persistence: ChangeStatsPersistence = {
      get: <T>() => undefined as T | undefined,
      update: vi.fn(() => Promise.resolve()),
    };
    const publish = vi.fn();
    const coordinator = new ReviewCoordinator({
      getWorkspaceRoot: () => 'Z:\\missing-review-workspace',
      snapshots: {
        read: () => ({
          turnId: 'turn-1',
          before: 'before-tree',
          after: 'after-tree',
        }),
        readTreeBytes: vi.fn(async () => null),
      } as unknown as TurnSnapshotStore,
      fileDiff: {
        openDiff: vi.fn<FileDiffOpener['openDiff']>(async () => 'opened-diff'),
      },
      persistence,
      storageDir: 'Z:\\missing-review-storage',
      publish,
      readCanonicalTurnFiles: () => [
        { path: 'canonical.txt', additions: 2, deletions: 1 },
      ],
      readWorkspaceFiles: async () => ({
        baseline: 'head-baseline',
        files,
      }),
      readBranchDiff: async () => undefined,
    });

    coordinator.handle({
      type: 'review.open',
      sessionId: 'session-1',
      scopeKind: 'turn',
      turnId: 'turn-1',
    });
    await coordinator.replay('session-1');
    const state = publish.mock.calls.find(
      ([message]) => message.type === 'review.state',
    )?.[0]?.state;
    expect(state.files).toEqual([expect.objectContaining({ path: 'canonical.txt' })]);

    coordinator.handle({
      type: 'review.restorePreview',
      sessionId: 'session-1',
      reviewScopeId: state.reviewScopeId,
      baseline: state.baseline,
      target: 'turn',
    });
    await coordinator.replay('session-1');
    expect(state.files[0].restorable).toBe(false);
    expect(publish).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'review.restorePreview' }));
    coordinator.dispose();
  });

  it('uses bounded legacy snapshot rows only without a canonical settlement', async () => {
    const persistence: ChangeStatsPersistence = {
      get: <T>() => undefined as T | undefined,
      update: vi.fn(() => Promise.resolve()),
    };
    const publish = vi.fn();
    let canonical:
      | readonly { path: string; additions: number; deletions: number }[]
      | undefined = [];
    const coordinator = new ReviewCoordinator({
      getWorkspaceRoot: () => 'Z:\\missing-review-workspace',
      snapshots: {
        read: () => ({
          turnId: 'turn-1',
          before: 'before-tree',
          after: 'after-tree',
          files: [{ path: 'legacy.txt', additions: 9, deletions: 4 }],
        }),
      } as unknown as TurnSnapshotStore,
      fileDiff: {
        openDiff: vi.fn<FileDiffOpener['openDiff']>(async () => 'opened-diff'),
      },
      persistence,
      storageDir: 'Z:\\missing-review-storage',
      publish,
      readCanonicalTurnFiles: () => canonical,
      readWorkspaceFiles: async () => ({
        baseline: 'head-baseline',
        files,
      }),
      readBranchDiff: async () => undefined,
    });

    coordinator.handle({
      type: 'review.open',
      sessionId: 'session-1',
      scopeKind: 'turn',
      turnId: 'turn-1',
    });
    await coordinator.replay('session-1');
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'review.state',
        state: expect.objectContaining({ files: [] }),
      }),
    );

    canonical = undefined;
    coordinator.handle({
      type: 'review.open',
      sessionId: 'session-1',
      scopeKind: 'turn',
      turnId: 'turn-1',
    });
    await coordinator.replay('session-1');
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'review.state',
        state: expect.objectContaining({
          files: [expect.objectContaining({ path: 'legacy.txt' })],
        }),
      }),
    );
    coordinator.dispose();
  });

  it('rejects Agent Review for a private turn baseline', async () => {
    const persistence: ChangeStatsPersistence = {
      get: <T>() => undefined as T | undefined,
      update: vi.fn(() => Promise.resolve()),
    };
    const publish = vi.fn();
    const run = vi.fn<ReviewAgentRunner['run']>();
    const snapshots = {
      read: () => ({ turnId: 'turn-1', before: 'before-tree' }),
    } as unknown as TurnSnapshotStore;
    const coordinator = createCoordinator(persistence, publish, undefined, snapshots, {
      run,
    });
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

  it('continues replay and later FIFO work after an unawaited writing settlement failure', async () => {
    let stored: unknown;
    let writes = 0;
    const persistence: ChangeStatsPersistence = {
      get: <T>() => stored as T | undefined,
      update: vi.fn(async (_key, value) => {
        writes += 1;
        if (writes === 1) {
          throw new Error('write failed');
        }
        stored = value;
      }),
    };
    const publish = vi.fn();
    const diagnostics = { record: vi.fn() };
    const snapshots = {
      read: () => ({
        turnId: 'turn-1',
        before: 'before-tree',
        after: 'after-tree',
        files: [{ path: 'old.txt', additions: 1, deletions: 0 }],
      }),
    } as unknown as TurnSnapshotStore;
    const coordinator = createCoordinator(
      persistence,
      publish,
      undefined,
      snapshots,
      undefined,
      diagnostics,
    );
    coordinator.openWritingTurn('session-1', 'turn-1', [
      { path: 'old.txt', additions: 1, deletions: 0 },
    ]);
    publish.mockClear();
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);

    try {
      const failed = coordinator.settleWritingTurn('session-1', 'turn-1', []);
      await expect(coordinator.replay('session-1')).resolves.toBeUndefined();
      await expect(failed).rejects.toThrow('write failed');
      await new Promise<void>((resolve) => setImmediate(resolve));

      expect(stored).toBeUndefined();
      expect(diagnostics.record).toHaveBeenCalledWith({
        level: 'warn',
        name: 'host.review.queue-failed',
      });
      expect(unhandled).not.toHaveBeenCalled();
      expect(publish).toHaveBeenLastCalledWith(
        expect.objectContaining({
          type: 'review.state',
          state: expect.objectContaining({
            lifecycle: 'writing',
            baseline: 'before-tree',
          }),
        }),
      );
      expect(publish).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: 'review.operationResult' }),
      );

      coordinator.settleWritingTurn('session-1', 'turn-1', []);
      await coordinator.replay('session-1');

      expect(persistence.update).toHaveBeenCalledTimes(2);
      expect(stored).toEqual(
        expect.objectContaining({
          version: 1,
          scopes: [expect.objectContaining({ baseline: 'before-tree:after-tree' })],
        }),
      );
      expect(publish).toHaveBeenLastCalledWith(
        expect.objectContaining({
          type: 'review.state',
          state: expect.objectContaining({ lifecycle: 'reviewing' }),
        }),
      );
    } finally {
      process.off('unhandledRejection', unhandled);
      coordinator.dispose();
    }
  });

  it('drops queued writing work and in-flight commits after disposal', async () => {
    let releaseLoad:
      | ((value: { baseline: string; files: readonly (typeof files)[number][] }) => void)
      | undefined;
    const pendingLoad = new Promise<{
      baseline: string;
      files: readonly (typeof files)[number][];
    }>((resolve) => {
      releaseLoad = resolve;
    });
    const readWorkspaceFiles = vi.fn(async () => pendingLoad);
    const persistence: ChangeStatsPersistence = {
      get: <T>() => undefined as T | undefined,
      update: vi.fn(() => Promise.resolve()),
    };
    const publish = vi.fn();
    const coordinator = new ReviewCoordinator({
      getWorkspaceRoot: () => 'Z:\\missing-review-workspace',
      snapshots: {
        read: () => ({
          turnId: 'turn-1',
          before: 'before-tree',
          files: [{ path: 'old.txt', additions: 1, deletions: 0 }],
        }),
      } as unknown as TurnSnapshotStore,
      fileDiff: {
        openDiff: vi.fn<FileDiffOpener['openDiff']>(async () => 'opened-diff'),
      },
      persistence,
      storageDir: 'Z:\\missing-review-storage',
      publish,
      readCanonicalTurnFiles: () => undefined,
      readWorkspaceFiles,
      readBranchDiff: async () => undefined,
    });
    coordinator.openWritingTurn('session-1', 'turn-1', [
      { path: 'old.txt', additions: 1, deletions: 0 },
    ]);
    publish.mockClear();

    coordinator.handle({ type: 'review.open', sessionId: 'session-1', scopeKind: 'workspace' });
    const running = coordinator.replay('session-1');
    const queued = coordinator.settleWritingTurn('session-1', 'turn-1', []);
    await vi.waitFor(() => {
      expect(readWorkspaceFiles).toHaveBeenCalledOnce();
    });
    publish.mockClear();
    coordinator.dispose();
    releaseLoad?.({ baseline: 'head-baseline', files });
    await expect(running).resolves.toBeUndefined();
    await expect(queued).resolves.toBeUndefined();

    expect(readWorkspaceFiles).toHaveBeenCalledOnce();
    expect(persistence.update).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });
});
