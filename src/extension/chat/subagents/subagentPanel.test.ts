import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type SessionTranscriptItem } from '../../../shared/protocol/transcript';
import type { SubagentInvocationRecord } from '../../../runtime/subagents/subagentSummary';
import {
  handleSubagentPanel,
  pairInvocationMapping,
  pollTick,
  stopSubagentPanelPoll,
} from './subagentPanel';
import type { SubagentPanelPort } from './subagentPanelPort';
import type { SubagentActivityItem } from '../../../shared/protocol/subagentProtocol';

function taskItem(
  toolUseId: string,
  options: {
    readonly description?: string;
    readonly statusless?: boolean;
    readonly toolStatus?: 'running' | 'completed';
  } = {},
): SessionTranscriptItem {
  return {
    id: `tool:${toolUseId}`,
    kind: 'tool',
    turnId: 'turn-1',
    toolUseId,
    toolName: 'Task',
    action: 'Delegated to a subagent',
    status: options.toolStatus ?? 'completed',
    progressCount: 0,
    latestUpdateKind: null,
    subagent: {
      type: 'explore',
      description: options.description ?? 'map the flow',
      ...(options.statusless ? {} : { status: 'running' as const }),
    },
  };
}

function record(
  childSessionId: string | null,
  description = 'map the flow',
): SubagentInvocationRecord {
  return {
    summary: {
      type: 'explore',
      description,
      status: 'running',
    },
    childSessionId,
  };
}

function fakeController(transcript: SessionTranscriptItem[] = [taskItem('use-1')]) {
  const activities: SubagentActivityItem[] = [
    { action: 'Read workspace files', target: 'src/app.ts' },
    { action: 'Searched workspace content', target: 'src' },
  ];
  let listener:
    | ((
        turnId: string,
        toolUseId: string,
        items: readonly SubagentActivityItem[],
      ) => void)
    | undefined;
  const syncParent = vi.fn(async () => {
    listener?.('turn-1', 'use-1', activities);
  });
  const unsubscribe = vi.fn();
  const fake = {
    sessionState: {
      sessionId: 'session-1',
      disposed: false,
      activeRuntimeCwd: 'd:/work',
    },
    recoveryState: { transcript: { transcript } },
    subagentState: {
      subagentTranscripts: {
        syncParent,
        subscribeParent: vi.fn(
          (_sessionId: string, callback: NonNullable<typeof listener>) => {
            listener = callback;
            callback('turn-1', 'use-1', activities);
            return unsubscribe;
          },
        ),
      },
    },
    sessionHistory: {
      loadSubagentInvocations: vi.fn().mockResolvedValue([record('child-1')]),
    },
    emit: vi.fn(),
    recordHost: vi.fn(),
  };
  return {
    fake,
    ctl: fake as unknown as SubagentPanelPort,
    syncParent,
    unsubscribe,
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('pairInvocationMapping', () => {
  it('pairs repeated identical delegations FIFO in transcript order', () => {
    const mapping = pairInvocationMapping(
      [
        taskItem('use-1', { description: 'same job' }),
        taskItem('use-2', { description: 'same job' }),
      ],
      [record('child-a', 'same job'), record('child-b', 'same job')],
    );
    expect(mapping.get('use-1')).toBe('child-a');
    expect(mapping.get('use-2')).toBe('child-b');
  });

  it('maps rows without a ledger entry to null', () => {
    const mapping = pairInvocationMapping(
      [taskItem('use-1'), taskItem('use-2')],
      [record('child-a')],
    );
    expect(mapping.get('use-1')).toBe('child-a');
    expect(mapping.get('use-2')).toBeNull();
  });
});

describe('inline Subagent activity polling', () => {
  it('publishes only the bounded activity trail for the chat card', async () => {
    const { fake, ctl, syncParent, unsubscribe } = fakeController();
    handleSubagentPanel(ctl, 'session-1', true);
    await vi.waitFor(() => {
      expect(syncParent).toHaveBeenCalledWith(
        'session-1',
        'd:/work',
        fake.recoveryState.transcript.transcript,
        [record('child-1')],
      );
    });
    expect(fake.emit).toHaveBeenCalledWith({
      type: 'subagent.activity',
      sessionId: 'session-1',
      turnId: 'turn-1',
      toolUseId: 'use-1',
      activities: [
        { action: 'Read workspace files', target: 'src/app.ts' },
        { action: 'Searched workspace content', target: 'src' },
      ],
    });
    const message = fake.emit.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(message).not.toHaveProperty('stoppable');
    expect(message).not.toHaveProperty('childSessionId');
    stopSubagentPanelPoll(ctl);
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('does not emit the same semantic trail twice', async () => {
    const { fake, ctl } = fakeController();
    handleSubagentPanel(ctl, 'session-1', true);
    await vi.waitFor(() => expect(fake.emit).toHaveBeenCalledOnce());
    await pollTick(ctl);
    expect(fake.emit).toHaveBeenCalledOnce();
    stopSubagentPanelPoll(ctl);
  });

  it('treats a statusless delegation under a running Task as live', async () => {
    const { fake, ctl } = fakeController([
      taskItem('use-1', {
        statusless: true,
        toolStatus: 'running',
      }),
    ]);
    handleSubagentPanel(ctl, 'session-1', true);
    await pollTick(ctl);
    await vi.waitFor(() => expect(fake.emit).toHaveBeenCalled());
    stopSubagentPanelPoll(ctl);
  });
});
