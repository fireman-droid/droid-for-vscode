import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SessionTranscriptItem } from '../../shared/bridgeMessages';
import type { SubagentInvocationRecord } from '../../runtime/subagentSummary';
import {
  handleSubagentPanel,
  pairInvocationMapping,
  pollTick,
  stopSubagentPanelPoll,
} from './subagentPanel';
import type { ChatControllerInternals } from './internals';

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

function fakeController(
  transcript: SessionTranscriptItem[] = [taskItem('use-1')],
) {
  const sampleActivity = vi.fn(async () => 'Reading files');
  const fake = {
    sessionId: 'session-1',
    disposed: false,
    activeRuntimeCwd: 'd:/work',
    transcript: { transcript },
    sessionHistory: {
      loadSubagentInvocations: vi
        .fn()
        .mockResolvedValue([record('child-1')]),
    },
    subagentControl: () => ({ sampleActivity }),
    emit: vi.fn(),
    recordHost: vi.fn(),
  };
  return {
    fake,
    ctl: fake as unknown as ChatControllerInternals,
    sampleActivity,
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
  it('publishes only the latest bounded action for the chat card', async () => {
    const { fake, ctl, sampleActivity } = fakeController();
    handleSubagentPanel(ctl, 'session-1', true);
    await vi.waitFor(() => {
      expect(sampleActivity).toHaveBeenCalledWith('child-1');
    });
    expect(fake.emit).toHaveBeenCalledWith({
      type: 'subagent.activity',
      sessionId: 'session-1',
      turnId: 'turn-1',
      toolUseId: 'use-1',
      action: 'Reading files',
    });
    const message = fake.emit.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(message).not.toHaveProperty('stoppable');
    expect(message).not.toHaveProperty('childSessionId');
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
