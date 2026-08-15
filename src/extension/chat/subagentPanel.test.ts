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
  status: SubagentInvocationRecord['summary']['status'] = 'running',
): SubagentInvocationRecord {
  return {
    summary: { type, description, status },
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
    readTranscript?: ReturnType<typeof vi.fn>;
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
    const fake = fakeController({ subagentControl: () => null });
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

  it('uses daemon snapshots while running, then persisted history when settled', async () => {
    const liveState = {
      transcript: [
        { id: 'u-live', kind: 'user' as const, text: 'investigate' },
        {
          id: 'a-live',
          kind: 'assistant' as const,
          turnId: 'child-turn',
          text: 'First message',
        },
      ],
      historyStatus: 'complete' as const,
      truncated: false,
    };
    const readTranscript = vi.fn().mockResolvedValue({
      state: liveState,
      saturated: false,
    });
    const fake = fakeController({
      subagentControl: () => ({
        sampleActivity: vi.fn(),
        readTranscript,
        interrupt: vi.fn(),
      }),
    });

    handleSubagentOpenTranscript(asCtl(fake), 'session-1', 'use-1');
    await vi.waitFor(() => {
      expect(readTranscript).toHaveBeenCalledWith('child-1', 'd:/work');
    });
    expect(fake.sessionHistory.loadHistory).not.toHaveBeenCalled();
    expect(fake.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'available',
        items: liveState.transcript,
      }),
    );

    fake.transcript.transcript = [
      taskItem('use-1', { status: 'completed' }),
    ];
    handleSubagentOpenTranscript(asCtl(fake), 'session-1', 'use-1');
    await vi.waitFor(() => {
      expect(fake.sessionHistory.loadHistory).toHaveBeenCalledWith({
        cwd: 'd:/work',
        sessionId: 'child-1',
      });
    });
    expect(readTranscript).toHaveBeenCalledOnce();
  });

  it('falls back to persisted history when a live snapshot fails', async () => {
    const readTranscript = vi.fn().mockResolvedValue(null);
    const fake = fakeController({
      subagentControl: () => ({
        sampleActivity: vi.fn(),
        readTranscript,
        interrupt: vi.fn(),
      }),
    });

    handleSubagentOpenTranscript(asCtl(fake), 'session-1', 'use-1');
    await vi.waitFor(() => {
      expect(fake.sessionHistory.loadHistory).toHaveBeenCalledOnce();
    });
    expect(fake.emit).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'available' }),
    );
  });

  it('prefers full history when the public live window saturates', async () => {
    const readTranscript = vi.fn().mockResolvedValue({
      state: {
        transcript: [
          { id: 'live-head', kind: 'user', text: 'partial head' },
        ],
        historyStatus: 'complete',
        truncated: false,
      },
      saturated: true,
    });
    const fake = fakeController({
      subagentControl: () => ({
        sampleActivity: vi.fn(),
        readTranscript,
        interrupt: vi.fn(),
      }),
    });

    handleSubagentOpenTranscript(asCtl(fake), 'session-1', 'use-1');
    await vi.waitFor(() => {
      expect(fake.sessionHistory.loadHistory).toHaveBeenCalledOnce();
    });
    expect(fake.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'available',
        items: [
          expect.objectContaining({ id: 'u1', text: 'investigate' }),
        ],
        truncated: false,
      }),
    );

    fake.emit.mockClear();
    fake.sessionHistory.loadHistory.mockResolvedValue({
      status: 'unavailable',
      reason: 'history-failed',
      message: 'nope',
    });
    handleSubagentOpenTranscript(asCtl(fake), 'session-1', 'use-1');
    await vi.waitFor(() => {
      expect(fake.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'available',
          items: [
            expect.objectContaining({
              id: 'live-head',
              text: 'partial head',
            }),
          ],
          truncated: true,
        }),
      );
    });
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

  it('single-flights concurrent requests and retains one trailing refresh', async () => {
    const fake = fakeController({ subagentControl: () => null });
    let release: (value: unknown) => void = () => undefined;
    fake.sessionHistory.loadHistory.mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve;
      }),
    ).mockResolvedValue({
      status: 'available',
      state: { transcript: [], historyStatus: 'complete', truncated: false },
    });
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
    await vi.waitFor(() => {
      expect(fake.sessionHistory.loadHistory).toHaveBeenCalledTimes(2);
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
    expect(fake.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'subagent.activity',
        stoppable: false,
      }),
    );
  });

  it('single-flights rapid duplicate requests for one row', async () => {
    let release: (value: boolean) => void = () => undefined;
    const interrupt = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          release = resolve;
        }),
    );
    const fake = fakeController({
      subagentControl: () => ({
        sampleActivity: vi.fn(),
        interrupt,
      }),
    });
    const ctl = asCtl(fake);
    handleSubagentStop(ctl, 'session-1', 'turn-1', 'use-1');
    handleSubagentStop(ctl, 'session-1', 'turn-1', 'use-1');
    await vi.waitFor(() => {
      expect(interrupt).toHaveBeenCalledOnce();
    });
    release(true);
    await vi.waitFor(() => {
      expect(fake.recordHost).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'host.subagent.stop',
          attributes: expect.objectContaining({ outcome: 'ok' }),
        }),
      );
    });
  });

  it('settles a stale row instead of interrupting a terminal child', async () => {
    const interrupt = vi.fn();
    const fake = fakeController({
      subagentControl: () => ({
        sampleActivity: vi.fn(),
        interrupt,
      }),
    });
    fake.sessionHistory.loadSubagentInvocations.mockResolvedValue([
      record('child-1', 'explore', 'map the flow', 'completed'),
    ]);
    handleSubagentStop(asCtl(fake), 'session-1', 'turn-1', 'use-1');
    await vi.waitFor(() => {
      expect(fake.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'subagent.update',
          toolUseId: 'use-1',
          subagent: expect.objectContaining({ status: 'completed' }),
        }),
      );
    });
    expect(interrupt).not.toHaveBeenCalled();
  });

  it('does not interrupt through a stale mapping when refresh fails', async () => {
    const interrupt = vi.fn();
    const fake = fakeController({
      subagentControl: () => ({
        sampleActivity: vi.fn(),
        interrupt,
      }),
    });
    fake.sessionHistory.loadSubagentInvocations.mockResolvedValue(null);
    handleSubagentStop(asCtl(fake), 'session-1', 'turn-1', 'use-1');
    await vi.waitFor(() => {
      expect(fake.recordHost).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'host.subagent.stop',
          attributes: expect.objectContaining({
            outcome: 'mapping-failed',
          }),
        }),
      );
    });
    expect(interrupt).not.toHaveBeenCalled();
    expect(fake.emit).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: 'subagent.activity',
        stoppable: false,
      }),
    );
  });

  it('reconciles natural completion after an interrupt race', async () => {
    const interrupt = vi.fn().mockResolvedValue(false);
    const fake = fakeController({
      subagentControl: () => ({
        sampleActivity: vi.fn(),
        interrupt,
      }),
    });
    fake.sessionHistory.loadSubagentInvocations
      .mockResolvedValueOnce([record('child-1')])
      .mockResolvedValueOnce([
        record('child-1', 'explore', 'map the flow', 'completed'),
      ]);
    handleSubagentStop(asCtl(fake), 'session-1', 'turn-1', 'use-1');
    await vi.waitFor(() => {
      expect(fake.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'subagent.update',
          subagent: expect.objectContaining({ status: 'completed' }),
        }),
      );
    });
    expect(
      fake.emit.mock.calls.filter(
        ([message]) =>
          message.type === 'subagent.activity' &&
          message.stoppable === true,
      ),
    ).toHaveLength(0);
  });

  it('reloads the invocation mapping after a session switch', async () => {
    let releaseOld: (
      value: readonly SubagentInvocationRecord[] | null,
    ) => void = () => undefined;
    const oldLoad = new Promise<
      readonly SubagentInvocationRecord[] | null
    >((resolve) => {
      releaseOld = resolve;
    });
    const interrupt = vi.fn().mockResolvedValue(true);
    const fake = fakeController({
      subagentControl: () => ({
        sampleActivity: vi.fn(),
        interrupt,
      }),
    });
    fake.sessionHistory.loadSubagentInvocations
      .mockReturnValueOnce(oldLoad)
      .mockResolvedValueOnce([record('child-new')]);
    const ctl = asCtl(fake);
    handleSubagentStop(ctl, 'session-1', 'turn-1', 'use-1');

    fake.sessionId = 'session-2';
    handleSubagentStop(ctl, 'session-2', 'turn-1', 'use-1');
    await vi.waitFor(() => {
      expect(
        fake.sessionHistory.loadSubagentInvocations,
      ).toHaveBeenCalledTimes(2);
      expect(interrupt).toHaveBeenCalledWith('child-new');
    });
    // The new session did not wait for the stale load to finish.
    releaseOld([record('child-old')]);
    await vi.waitFor(() => {
      expect(interrupt).toHaveBeenCalledOnce();
    });
    expect(interrupt).toHaveBeenCalledWith('child-new');
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

  it('does not sample or expose Stop when the mapping refresh fails', async () => {
    const sampleActivity = vi.fn();
    const fake = fakeController({
      subagentControl: () => ({
        sampleActivity,
        interrupt: vi.fn(),
      }),
    });
    fake.sessionHistory.loadSubagentInvocations.mockResolvedValue(null);
    const ctl = asCtl(fake);
    handleSubagentPanel(ctl, 'session-1', true);
    await vi.waitFor(() => {
      expect(fake.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'subagent.activity',
          stoppable: false,
        }),
      );
    });
    expect(sampleActivity).not.toHaveBeenCalled();
    handleSubagentPanel(ctl, 'session-1', false);
  });

  it('does not resurrect Stop when a sample finishes during interrupt', async () => {
    let releaseSample: (value: string | null) => void = () => undefined;
    let releaseInterrupt: (value: boolean) => void = () => undefined;
    const sampleActivity = vi.fn(
      () =>
        new Promise<string | null>((resolve) => {
          releaseSample = resolve;
        }),
    );
    const interrupt = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          releaseInterrupt = resolve;
        }),
    );
    const fake = fakeController({
      subagentControl: () => ({ sampleActivity, interrupt }),
    });
    const ctl = asCtl(fake);
    handleSubagentPanel(ctl, 'session-1', true);
    await vi.waitFor(() => {
      expect(sampleActivity).toHaveBeenCalledOnce();
    });

    handleSubagentStop(ctl, 'session-1', 'turn-1', 'use-1');
    await vi.waitFor(() => {
      expect(interrupt).toHaveBeenCalledOnce();
    });
    releaseSample('Read');
    await vi.waitFor(() => {
      expect(fake.emit).toHaveBeenLastCalledWith(
        expect.objectContaining({
          type: 'subagent.activity',
          stoppable: false,
        }),
      );
    });
    expect(
      fake.emit.mock.calls.filter(
        ([message]) =>
          message.type === 'subagent.activity' &&
          message.stoppable === true,
      ),
    ).toHaveLength(0);
    releaseInterrupt(true);
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
