import { describe, expect, it } from 'vitest';

import type { SessionTranscriptItem } from '../../shared/bridgeMessages';
import {
  formatElapsed,
  selectWorkingSubagents,
} from './subagentWorking';

function toolRow(
  overrides: Partial<Extract<SessionTranscriptItem, { kind: 'tool' }>> & {
    readonly toolUseId: string;
    readonly turnId: string;
  },
): SessionTranscriptItem {
  return {
    id: `tool:${overrides.turnId}:${overrides.toolUseId}`,
    kind: 'tool',
    toolName: 'Task',
    action: 'Delegated focused work',
    status: 'completed',
    progressCount: 0,
    latestUpdateKind: null,
    ...overrides,
  };
}

const live = (ids: readonly string[]): ReadonlySet<string> => new Set(ids);

describe('selectWorkingSubagents', () => {
  it('counts running delegations of live turns only', () => {
    const transcript: SessionTranscriptItem[] = [
      toolRow({
        turnId: 'turn-1',
        toolUseId: 'task-1',
        subagent: {
          type: 'explore',
          description: 'Survey the auth module',
          status: 'running',
        },
      }),
      toolRow({
        turnId: 'turn-1',
        toolUseId: 'task-2',
        subagent: {
          type: 'worker',
          description: 'Settled already',
          status: 'completed',
          toolUseCount: 3,
          durationMs: 4200,
        },
      }),
      // A running row from a replayed history turn: not live, no badge.
      toolRow({
        turnId: 'turn-history',
        toolUseId: 'task-3',
        subagent: {
          type: 'worker',
          description: 'Replayed running row',
          status: 'running',
        },
      }),
      // Tool row without a delegation never counts.
      toolRow({ turnId: 'turn-1', toolUseId: 'read-1', toolName: 'Read' }),
    ];

    expect(selectWorkingSubagents(transcript, live(['turn-1']))).toEqual([
      {
        turnId: 'turn-1',
        toolUseId: 'task-1',
        type: 'explore',
        description: 'Survey the auth module',
      },
    ]);
  });

  it('keeps counting after the turn ended while delegations still run', () => {
    // The zombie window: the turn reached a terminal state but the
    // background delegation is still running. The turn id stays in
    // the live set, so the badge persists until settlement.
    const transcript = [
      toolRow({
        turnId: 'turn-done',
        toolUseId: 'task-bg',
        subagent: {
          type: 'repo-researcher',
          description: '研究整体项目架构',
          status: 'running',
        },
      }),
    ];
    expect(
      selectWorkingSubagents(transcript, live(['turn-done'])),
    ).toHaveLength(1);
  });

  it('returns nothing for history replay (no live turns)', () => {
    const transcript = [
      toolRow({
        turnId: 'turn-old',
        toolUseId: 'task-1',
        subagent: {
          type: 'worker',
          description: 'Still running per ledger',
          status: 'running',
        },
      }),
    ];
    expect(selectWorkingSubagents(transcript, live([]))).toEqual([]);
  });

  it('ignores pending and terminal delegation statuses', () => {
    const transcript = (
      ['pending', 'completed', 'failed', 'cancelled'] as const
    ).map((status, index) =>
      toolRow({
        turnId: 'turn-1',
        toolUseId: `task-${index}`,
        subagent: { type: 'worker', description: '', status },
      }),
    );
    expect(selectWorkingSubagents(transcript, live(['turn-1']))).toEqual(
      [],
    );
  });

  it('counts multiple concurrent delegations in transcript order', () => {
    const transcript = [1, 2, 3].map((index) =>
      toolRow({
        turnId: 'turn-1',
        toolUseId: `task-${index}`,
        subagent: {
          type: 'repo-researcher',
          description: `slice ${index}`,
          status: 'running',
        },
      }),
    );
    expect(
      selectWorkingSubagents(transcript, live(['turn-1'])).map(
        (row) => row.toolUseId,
      ),
    ).toEqual(['task-1', 'task-2', 'task-3']);
  });
});

describe('formatElapsed', () => {
  it('formats seconds, minutes and hours', () => {
    expect(formatElapsed(0)).toBe('0s');
    expect(formatElapsed(999)).toBe('0s');
    expect(formatElapsed(47_000)).toBe('47s');
    expect(formatElapsed(60_000)).toBe('1m');
    expect(formatElapsed(134_000)).toBe('2m 14s');
    expect(formatElapsed(3_600_000)).toBe('1h');
    expect(formatElapsed(3_720_000)).toBe('1h 2m');
    expect(formatElapsed(-5)).toBe('0s');
  });
});
