import { describe, expect, it, vi } from 'vitest';

import type { SessionHistoryLoader } from '../runtime/history/SessionHistory';
import {
  createCommittedStatsHistoryLoader,
  restoreCommittedHistoryStats,
} from './committedHistoryStats';

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

const committed = {
  turnId: 'live-turn-before-reload',
  hash: 'abc1234',
  paths: ['src/app.ts'],
  stats: [
    { path: 'src/app.ts', additions: 3, deletions: 1 },
  ],
};

describe('committed history stats', () => {
  it('restores counts on the latest synthesized Changes row', () => {
    const restored = restoreCommittedHistoryStats(state, committed);

    expect(restored.transcript).toEqual([
      state.transcript[0],
      {
        ...state.transcript[1],
        files: [
          { path: 'src/app.ts', additions: 3, deletions: 1 },
          {
            path: 'docs/note.md',
            additions: null,
            deletions: null,
          },
        ],
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
    const loader = createCommittedStatsHistoryLoader(base, {
      read: async () => new Map(),
      readCommittedTurn: () => committed,
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
          {},
          {
            files: [
              { path: 'src/app.ts', additions: 3, deletions: 1 },
              {
                path: 'docs/note.md',
                additions: null,
                deletions: null,
              },
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
