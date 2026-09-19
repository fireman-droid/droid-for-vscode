import { describe, expect, it, vi } from 'vitest';

import { resolveSettledChangeFiles } from './settleTurnChanges';
import type { SettleTurnChangesPort } from './settleTurnChangesPort';
import type { TurnSnapshotStore } from '../../changes/turnSnapshots';

const SCOPE = { sessionId: 'session-a', turnId: 'turn-a' };

function fakeCtl(partial: {
  readonly changeStatsRead: (
    paths: readonly string[],
  ) => Promise<
    ReadonlyMap<string, { additions: number | null; deletions: number | null }>
  >;
  readonly snapshots?: Partial<TurnSnapshotStore>;
}): SettleTurnChangesPort {
  return {
    changeStats: {
      read: async (paths: readonly string[]) => partial.changeStatsRead(paths),
    },
    turnSnapshots: partial.snapshots as TurnSnapshotStore | undefined,
  } as SettleTurnChangesPort;
}

describe('resolveSettledChangeFiles', () => {
  it('uses the tree diff as the row set and keeps tool order first', async () => {
    const snapshots: Partial<TurnSnapshotStore> = {
      capture: vi.fn(async () => 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'),
      read: () => ({
        turnId: SCOPE.turnId,
        before: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      }),
      diff: async () =>
        new Map([
          ['src/git.ts', { additions: 4, deletions: 1 }],
          ['src/tool.ts', { additions: 2, deletions: 0 }],
        ]),
    };
    const files = await resolveSettledChangeFiles(
      fakeCtl({
        changeStatsRead: async () => new Map(),
        snapshots,
      }),
      SCOPE.sessionId,
      SCOPE.turnId,
      ['src/tool.ts'],
    );
    expect(files).toEqual([
      { path: 'src/tool.ts', additions: 2, deletions: 0 },
      { path: 'src/git.ts', additions: 4, deletions: 1 },
    ]);
    expect(snapshots.capture).toHaveBeenCalledWith(SCOPE, 'after');
  });

  it('fills gitignored tool paths from memory stats and drops 0/0 rows', async () => {
    const files = await resolveSettledChangeFiles(
      fakeCtl({
        changeStatsRead: async () =>
          new Map([
            ['secret.log', { additions: 5, deletions: 1 }],
            ['rejected.ts', { additions: 0, deletions: 0 }],
          ]),
        snapshots: {
          capture: async () => 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          read: () => ({
            turnId: SCOPE.turnId,
            before: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          }),
          diff: async () => new Map([['src/app.ts', { additions: 1, deletions: 0 }]]),
        },
      }),
      SCOPE.sessionId,
      SCOPE.turnId,
      ['secret.log', 'rejected.ts'],
    );
    expect(files).toEqual([
      { path: 'secret.log', additions: 5, deletions: 1 },
      { path: 'src/app.ts', additions: 1, deletions: 0 },
    ]);
  });

  it('falls back to memory stats when the snapshot is missing and drops 0/0', async () => {
    const files = await resolveSettledChangeFiles(
      fakeCtl({
        changeStatsRead: async () =>
          new Map([
            ['src/ok.ts', { additions: 3, deletions: 1 }],
            ['src/rejected.ts', { additions: 0, deletions: 0 }],
          ]),
      }),
      SCOPE.sessionId,
      SCOPE.turnId,
      ['src/ok.ts', 'src/rejected.ts'],
    );
    expect(files).toEqual([{ path: 'src/ok.ts', additions: 3, deletions: 1 }]);
  });

  it('returns no rows for a snapshot-less turn with no tool paths', async () => {
    await expect(
      resolveSettledChangeFiles(
        fakeCtl({ changeStatsRead: async () => new Map() }),
        SCOPE.sessionId,
        SCOPE.turnId,
        [],
      ),
    ).resolves.toEqual([]);
  });
});
