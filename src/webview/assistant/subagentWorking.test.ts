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
  it('counts explicit running delegations regardless of live turns', () => {
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
      // A replayed history row the ledger still reports running: the
      // ledger said so, so it counts (the host's replay watch settles
      // dead rows within a poll tick).
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
        toolUseCount: null,
      },
      {
        turnId: 'turn-history',
        toolUseId: 'task-3',
        type: 'worker',
        description: 'Replayed running row',
        toolUseCount: null,
      },
    ]);
  });

  it('counts a statusless delegation under a still-running Task row', () => {
    // Foreground (blocking) Task: the delegation identity arrives
    // with the Task input, but the SDK only reports a lifecycle
    // status with the Task's own tool_result — so for the whole
    // visible run `subagent.status` is undefined while the tool row
    // itself is `running`. That is live work by construction.
    const transcript: SessionTranscriptItem[] = [
      toolRow({
        turnId: 'turn-1',
        toolUseId: 'task-fg',
        status: 'running',
        subagent: {
          type: 'explore',
          description: '看这个文件夹',
        },
      }),
      // Same shape in a non-live turn: still gated out.
      toolRow({
        turnId: 'turn-history',
        toolUseId: 'task-replay',
        status: 'running',
        subagent: { type: 'explore', description: '' },
      }),
    ];
    expect(selectWorkingSubagents(transcript, live(['turn-1']))).toEqual([
      {
        turnId: 'turn-1',
        toolUseId: 'task-fg',
        type: 'explore',
        description: '看这个文件夹',
        toolUseCount: null,
      },
    ]);
  });

  it('drops a statusless delegation once its Task row settled', () => {
    // The tool row reached a terminal state without the ledger ever
    // reporting a subagent status: no live work remains to count.
    const transcript = (['completed', 'failed'] as const).map(
      (status, index) =>
        toolRow({
          turnId: 'turn-1',
          toolUseId: `task-${index}`,
          status,
          subagent: { type: 'worker', description: '' },
        }),
    );
    expect(selectWorkingSubagents(transcript, live(['turn-1']))).toEqual(
      [],
    );
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

  it('raises the badge for replayed rows the ledger reports running', () => {
    // Reload Window: history replay marked the row running and no
    // turn id is live in this fresh connection. The badge must still
    // rise — the ledger is authoritative for explicit statuses.
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
    expect(selectWorkingSubagents(transcript, live([]))).toEqual([
      {
        turnId: 'turn-old',
        toolUseId: 'task-1',
        type: 'worker',
        description: 'Still running per ledger',
        toolUseCount: null,
      },
    ]);
  });

  it('drops a replayed row once subagent.update settles it', () => {
    // The zombie watch polls replayed running rows and pushes their
    // terminal status through subagent.update; the badge must fall
    // with the flip.
    const running = toolRow({
      turnId: 'turn-old',
      toolUseId: 'task-1',
      subagent: { type: 'worker', description: '', status: 'running' },
    });
    expect(selectWorkingSubagents([running], live([]))).toHaveLength(1);
    const settled = toolRow({
      turnId: 'turn-old',
      toolUseId: 'task-1',
      subagent: {
        type: 'worker',
        description: '',
        status: 'completed',
        toolUseCount: 2,
        durationMs: 8_000,
      },
    });
    expect(selectWorkingSubagents([settled], live([]))).toEqual([]);
  });

  it('keeps the liveTurnIds gate for statusless replayed rows', () => {
    // Replay can leave a tool row 'running' with no ledger status
    // (e.g. an interrupted history tail); without a live turn there
    // is no evidence of live work, so no badge.
    const transcript = [
      toolRow({
        turnId: 'turn-history',
        toolUseId: 'task-replay',
        status: 'running',
        subagent: { type: 'explore', description: '' },
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
