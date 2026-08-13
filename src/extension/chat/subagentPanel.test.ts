import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SessionTranscriptItem } from '../../shared/bridgeMessages';
import type { SubagentInvocationRecord } from '../../runtime/subagentSummary';
import {
  handleSubagentOpenTranscript,
  handleSubagentPanel,
  handleSubagentStop,
  pairInvocationMapping,
  pollTick,
  stopSubagentPanelPoll,
  SUBAGENT_ACTIVITY_POLL_MS,
} from './subagentPanel';
import type { ChatControllerInternals } from './internals';

function taskItem(
  toolUseId: string,
  options: {
    readonly type?: string;
    readonly description?: string;
    readonly status?: 'running' | 'completed';
    /** Omit the delegation status (foreground Task mid-run). */
    readonly statusless?: boolean;
    readonly toolStatus?: 'running' | 'completed';
    readonly turnId?: string;
  } = {},
): SessionTranscriptItem {
  return {
    id: `tool:${toolUseId}`,
    kind: 'tool',
    turnId: options.turnId ?? 'turn-1',
    toolUseId,
    toolName: 'Task',
    action: 'Delegated to a subagent',
    status: options.toolStatus ?? 'completed',
    progressCount: 0,
    latestUpdateKind: null,
    subagent: {
      type: options.type ?? 'explore',
      description: options.description ?? 'map the flow',
      ...(options.statusless === true
        ? {}
        : { status: options.status ?? 'running' }),
    },
  };
}

function record(
  childSessionId: string | null,
  type = 'explore',
  description = 'map the flow',
): SubagentInvocationRecord {
  return {
    summary: { type, description, status: 'running' },
    childSessionId,
  };
}

interface FakeController {
  sessionId: string | null;
  disposed: boolean;
  activeRuntimeCwd: string | null;
  transcript: { transcript: SessionTranscriptItem[] };
  sessionHistory: {
    loadHistory: ReturnType<typeof vi.fn>;
    loadSubagentInvocations: ReturnType<typeof vi.fn>;
  };
  subagentControl: (() => {
    sampleActivity: ReturnType<typeof vi.fn>;
    interrupt: ReturnType<typeof vi.fn>;
  } | null) | null;
  emit: ReturnType<typeof vi.fn>;
  recordHost: ReturnType<typeof vi.fn>;
}

function fakeController(
  overrides: Partial<FakeController> = {},
): FakeController {
  return {
    sessionId: 'session-1',
    disposed: false,
    activeRuntimeCwd: 'd:/work',
    transcript: { transcript: [taskItem('use-1')] },
    sessionHistory: {
      loadHistory: vi.fn().mockResolvedValue({
        status: 'available',
        state: {
          transcript: [
            { id: 'u1', kind: 'user', text: 'investigate' },
          ],
          historyStatus: 'complete',
          truncated: false,
        },
      }),
      loadSubagentInvocations: vi
        .fn()
        .mockResolvedValue([record('child-1')]),
    },
    subagentControl: () => ({
      sampleActivity: vi.fn().mockResolvedValue('Grep'),
      interrupt: vi.fn().mockResolvedValue(true),
    }),
    emit: vi.fn(),
    recordHost: vi.fn(),
    ...overrides,
  };
}

const asCtl = (fake: FakeController): ChatControllerInternals =>
  fake as unknown as ChatControllerInternals;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('pairInvocationMapping', () => {
  it('pairs repeated identical delegations FIFO in transcript order', () => {
    const mapping = pairInvocationMapping(
      [
        taskItem('use-1', { description: 'same job' }),
        taskItem('use-2', { description: 'same job' }),
        taskItem('use-3', { description: 'other job' }),
      ],
      [
        record('child-a', 'explore', 'same job'),
        record('child-b', 'explore', 'same job'),
        record('child-c', 'explore', 'other job'),
      ],
    );
    expect(mapping.get('use-1')).toBe('child-a');
    expect(mapping.get('use-2')).toBe('child-b');
    expect(mapping.get('use-3')).toBe('child-c');
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

describe('handleSubagentOpenTranscript', () => {
  it('serves the child transcript through the history loader', async () => {
    const fake = fakeController();
    handleSubagentOpenTranscript(asCtl(fake), 'session-1', 'use-1');
    await vi.waitFor(() => {
      expect(fake.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'subagent.transcript',
          status: 'available',
          toolUseId: 'use-1',
          title: 'map the flow',
        }),
      );
    });
    expect(fake.sessionHistory.loadHistory).toHaveBeenCalledWith({
      cwd: 'd:/work',
      sessionId: 'child-1',
    });
    // The bridge payload itself never carries the child id.
    const message = fake.emit.mock.calls.at(-1)?.[0] as Record<
      string,
      unknown
    >;
    expect('childSessionId' in message).toBe(false);
  });

  it('fails closed when the ledger cannot name a child session', async () => {
    const fake = fakeController();
    fake.sessionHistory.loadSubagentInvocations.mockResolvedValue([
      record(null),
    ]);
    handleSubagentOpenTranscript(asCtl(fake), 'session-1', 'use-1');
    await vi.waitFor(() => {
      expect(fake.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'subagent.transcript',
          status: 'unavailable',
        }),
      );
    });
    expect(fake.sessionHistory.loadHistory).not.toHaveBeenCalled();
  });

  it('fails closed when the child history fails to load', async () => {
    const fake = fakeController();
    fake.sessionHistory.loadHistory.mockResolvedValue({
      status: 'unavailable',
      reason: 'history-failed',
      message: 'nope',
    });
    handleSubagentOpenTranscript(asCtl(fake), 'session-1', 'use-1');
    await vi.waitFor(() => {
      expect(fake.emit).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'unavailable' }),
      );
    });
  });

  it('single-flights concurrent requests for the same row', async () => {
    const fake = fakeController();
    let release: (value: unknown) => void = () => undefined;
    fake.sessionHistory.loadHistory.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    const ctl = asCtl(fake);
    handleSubagentOpenTranscript(ctl, 'session-1', 'use-1');
    handleSubagentOpenTranscript(ctl, 'session-1', 'use-1');
    await vi.waitFor(() => {
      expect(fake.sessionHistory.loadHistory).toHaveBeenCalledOnce();
    });
    release({
      status: 'available',
      state: { transcript: [], historyStatus: 'complete', truncated: false },
    });
  });

  it('drops requests addressed to another session', () => {
    const fake = fakeController();
    handleSubagentOpenTranscript(asCtl(fake), 'other', 'use-1');
    expect(fake.emit).not.toHaveBeenCalled();
  });
});

describe('handleSubagentStop', () => {
  it('interrupts exactly the resolved child and reports the outcome', async () => {
    const interrupt = vi.fn().mockResolvedValue(true);
    const gateway = {
      sampleActivity: vi.fn(),
      interrupt,
    };
    const fake = fakeController({ subagentControl: () => gateway });
    handleSubagentStop(asCtl(fake), 'session-1', 'turn-1', 'use-1');
    await vi.waitFor(() => {
      expect(interrupt).toHaveBeenCalledWith('child-1');
    });
    await vi.waitFor(() => {
      expect(fake.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'subagent.activity',
          toolUseId: 'use-1',
          action: null,
          stoppable: false,
        }),
      );
    });
  });

  it('does nothing without a control gateway', () => {
    const fake = fakeController({ subagentControl: () => null });
    handleSubagentStop(asCtl(fake), 'session-1', 'turn-1', 'use-1');
    expect(fake.emit).not.toHaveBeenCalled();
  });
});

describe('panel polling', () => {
  it('samples running rows while open and stops when closed', async () => {
    const sampleActivity = vi.fn().mockResolvedValue('Grep');
    const gateway = {
      sampleActivity,
      interrupt: vi.fn(),
    };
    const fake = fakeController({ subagentControl: () => gateway });
    const ctl = asCtl(fake);
    handleSubagentPanel(ctl, 'session-1', true);
    await vi.waitFor(() => {
      expect(fake.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'subagent.activity',
          toolUseId: 'use-1',
          action: 'Grep',
          stoppable: true,
        }),
      );
    });
    // Identical samples do not re-emit.
    fake.emit.mockClear();
    await pollTick(ctl);
    expect(fake.emit).not.toHaveBeenCalled();

    handleSubagentPanel(ctl, 'session-1', false);
    sampleActivity.mockClear();
    await vi.advanceTimersByTimeAsync(SUBAGENT_ACTIVITY_POLL_MS * 2);
    expect(sampleActivity).not.toHaveBeenCalled();
    stopSubagentPanelPoll(ctl);
  });

  it('reports unstoppable rows when no gateway is available', async () => {
    const fake = fakeController({ subagentControl: () => null });
    const ctl = asCtl(fake);
    handleSubagentPanel(ctl, 'session-1', true);
    await vi.waitFor(() => {
      expect(fake.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'subagent.activity',
          action: null,
          stoppable: false,
        }),
      );
    });
    handleSubagentPanel(ctl, 'session-1', false);
  });

  it('polls a statusless delegation under a running Task row', async () => {
    // Foreground (blocking) Task: the SDK reports no lifecycle
    // status until the Task's own tool_result, so the host mirrors
    // the webview fallback and treats the row as live work.
    const sampleActivity = vi.fn().mockResolvedValue('Read');
    const gateway = { sampleActivity, interrupt: vi.fn() };
    const fake = fakeController({
      subagentControl: () => gateway,
      transcript: {
        transcript: [
          taskItem('use-fg', { statusless: true, toolStatus: 'running' }),
        ],
      },
    });
    const ctl = asCtl(fake);
    handleSubagentPanel(ctl, 'session-1', true);
    await vi.waitFor(() => {
      expect(fake.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'subagent.activity',
          toolUseId: 'use-fg',
          action: 'Read',
          stoppable: true,
        }),
      );
    });
    // The ledger invocation row written at spawn resolved the child.
    expect(sampleActivity).toHaveBeenCalledWith('child-1');
    handleSubagentPanel(ctl, 'session-1', false);
  });

  it('never polls settled or terminal-status delegation rows', async () => {
    const sampleActivity = vi.fn();
    const fake = fakeController({
      subagentControl: () => ({ sampleActivity, interrupt: vi.fn() }),
      transcript: {
        transcript: [
          taskItem('use-done', {
            status: 'completed',
            toolStatus: 'completed',
          }),
          taskItem('use-settled', {
            statusless: true,
            toolStatus: 'completed',
          }),
        ],
      },
    });
    const ctl = asCtl(fake);
    handleSubagentPanel(ctl, 'session-1', true);
    await pollTick(ctl);
    expect(sampleActivity).not.toHaveBeenCalled();
    expect(fake.emit).not.toHaveBeenCalled();
    handleSubagentPanel(ctl, 'session-1', false);
  });

  it('stops a foreground statusless delegation through the mapping', async () => {
    const interrupt = vi.fn().mockResolvedValue(true);
    const fake = fakeController({
      subagentControl: () => ({ sampleActivity: vi.fn(), interrupt }),
      transcript: {
        transcript: [
          taskItem('use-fg', { statusless: true, toolStatus: 'running' }),
        ],
      },
    });
    handleSubagentStop(asCtl(fake), 'session-1', 'turn-1', 'use-fg');
    await vi.waitFor(() => {
      expect(interrupt).toHaveBeenCalledWith('child-1');
    });
  });
});

describe('transcript of a running delegation', () => {
  it('serves the mid-run transcript of a foreground statusless row', async () => {
    // A running child's session file exists and loads mid-run; the
    // sheet re-requests it on an interval for the live view.
    const fake = fakeController({
      transcript: {
        transcript: [
          taskItem('use-fg', { statusless: true, toolStatus: 'running' }),
        ],
      },
    });
    handleSubagentOpenTranscript(asCtl(fake), 'session-1', 'use-fg');
    await vi.waitFor(() => {
      expect(fake.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'subagent.transcript',
          status: 'available',
          toolUseId: 'use-fg',
          title: 'map the flow',
        }),
      );
    });
    expect(fake.sessionHistory.loadHistory).toHaveBeenCalledWith({
      cwd: 'd:/work',
      sessionId: 'child-1',
    });
  });
});
