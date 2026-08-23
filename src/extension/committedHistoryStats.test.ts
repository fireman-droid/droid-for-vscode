import { describe, expect, it, vi } from 'vitest';

import type { SessionHistoryLoader } from '../runtime/history/SessionHistory';
import {
  createTurnStatsHistoryLoader,
  restoreTurnChangeStats,
} from './committedHistoryStats';
import type { TurnSnapshotRecord } from './turnSnapshots';

const state = {
  transcript: [
    {
      id: 'changes:older',
      kind: 'changes' as const,
      turnId: 'history-older',
      files: [
        { path: 'src/old.ts', additions: null, deletions: null },
      ],
    },
    {
      id: 'changes:kept',
      kind: 'changes' as const,
      turnId: 'history-kept',
      files: [
        { path: 'src/kept.ts', additions: 8, deletions: 2 },
      ],
    },
    {
      id: 'changes:latest',
      kind: 'changes' as const,
      turnId: 'history-latest',
      files: [
        { path: 'src/app.ts', additions: null, deletions: null },
        { path: 'docs/note.md', additions: null, deletions: null },
      ],
    },
  ],
  historyStatus: 'complete' as const,
  truncated: false,
};

const records: readonly TurnSnapshotRecord[] = [
  {
    turnId: 'live-older',
    files: [{ path: 'src/old.ts', additions: 1, deletions: 4 }],
  },
  {
    turnId: 'history-kept',
    files: [{ path: 'src/kept.ts', additions: 99, deletions: 99 }],
  },
  {
    turnId: 'live-latest',
    files: [
      { path: 'src/app.ts', additions: 3, deletions: 1 },
      { path: 'docs/note.md', additions: 2, deletions: 0 },
    ],
  },
];

describe('turn history stats', () => {
  it('restores every Changes row by turnId then path overlap, without overwriting known counts', () => {
    const restored = restoreTurnChangeStats(state, records);

    expect(restored.transcript).toEqual([
      {
        ...state.transcript[0],
        files: [{ path: 'src/old.ts', additions: 1, deletions: 4 }],
      },
      state.transcript[1],
      {
        ...state.transcript[2],
        files: [
          { path: 'src/app.ts', additions: 3, deletions: 1 },
          { path: 'docs/note.md', additions: 2, deletions: 0 },
        ],
      },
    ]);
  });

  it('consumes each snapshot record at most once on overlap ties', () => {
    const restored = restoreTurnChangeStats(
      {
        ...state,
        transcript: [
          {
            id: 'changes:a',
            kind: 'changes',
            turnId: 'a',
            files: [{ path: 'src/app.ts', additions: null, deletions: null }],
          },
          {
            id: 'changes:b',
            kind: 'changes',
            turnId: 'b',
            files: [{ path: 'src/app.ts', additions: null, deletions: null }],
          },
        ],
      },
      [
        {
          turnId: 'older',
          files: [{ path: 'src/app.ts', additions: 1, deletions: 0 }],
        },
        {
          turnId: 'newer',
          files: [{ path: 'src/app.ts', additions: 9, deletions: 2 }],
        },
      ],
    );

    expect(restored.transcript).toEqual([
      {
        id: 'changes:a',
        kind: 'changes',
        turnId: 'a',
        files: [{ path: 'src/app.ts', additions: 1, deletions: 0 }],
      },
      {
        id: 'changes:b',
        kind: 'changes',
        turnId: 'b',
        files: [{ path: 'src/app.ts', additions: 9, deletions: 2 }],
      },
    ]);
  });

  it('enriches history loads and preserves optional ledger methods', async () => {
    const loadSubagentSummaries = vi.fn(async () => []);
    const base: SessionHistoryLoader = {
      loadHistory: vi.fn(async () => ({
        status: 'available' as const,
        state,
      })),
      loadSubagentSummaries,
    };
    const loader = createTurnStatsHistoryLoader(base, {
      readTurns: () => records,
    });

    await expect(
      loader.loadHistory({
        cwd: 'C:\\workspace',
        sessionId: 'session-a',
      }),
    ).resolves.toMatchObject({
      status: 'available',
      state: {
        transcript: [
          {
            files: [{ path: 'src/old.ts', additions: 1, deletions: 4 }],
          },
          {},
          {
            files: [
              { path: 'src/app.ts', additions: 3, deletions: 1 },
              { path: 'docs/note.md', additions: 2, deletions: 0 },
            ],
          },
        ],
      },
    });
    await loader.loadSubagentSummaries?.({
      cwd: 'C:\\workspace',
      sessionId: 'session-a',
    });
    expect(loadSubagentSummaries).toHaveBeenCalledOnce();
  });
});
