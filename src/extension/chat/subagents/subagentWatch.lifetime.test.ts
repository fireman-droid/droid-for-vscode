import { afterEach, describe, expect, it, vi } from 'vitest';
import { createController, createMockRuntime, ready, waitForConnected, type SessionHistoryLoader } from '../controllerTestHarness';
import { armZombieSubagentWatch, tickZombieSubagentWatch } from './subagentWatch';
import type { ChatController } from '../ChatController';
import { createTurnActivityState } from '../turns/turnActivityState';
import { startParentFollowupSync } from './parentFollowupHistory';

const controllers: ChatController[] = [];
afterEach(async () => { for (const ctl of controllers.splice(0)) await ctl.dispose(); vi.useRealTimers(); });

async function harness(terminalStatus: 'completed' | 'cancelled' | 'failed' = 'completed') {
  let running = true;
  let parentRunning = false;
  const summary = { type: 'scout', description: 'Long research', status: 'running' as const };
  const loadInvocations = vi.fn(async () => [{ parentToolUseId: 'task-1', childSessionId: 'child-1',
    summary: { ...summary, status: running ? 'running' as const : terminalStatus } }]);
  const history: SessionHistoryLoader = {
    loadHistory: vi.fn<SessionHistoryLoader['loadHistory']>(async () => ({ status: 'available', state: { historyStatus: 'complete', truncated: false,
      transcript: [{ kind: 'assistant', id: 'answer', turnId: 'auto', text: 'Long research finished' }] } })),
    loadSubagentInvocations: loadInvocations,
  };
  const runtime = Object.assign(createMockRuntime(), {
    readSessionWorkingState: vi.fn(async () => parentRunning ? 'running' as const : 'idle' as const),
    supportsBackgroundTurns: () => true,
  });
  const { controller, messages } = createController(() => runtime, undefined, undefined, undefined, history);
  controllers.push(controller); ready(controller); await waitForConnected(messages);
  vi.useFakeTimers();
  armZombieSubagentWatch(controller, 'session-1', '/workspace', loadInvocations, [
    { turnId: 'launch', toolUseId: 'task-1', type: summary.type, description: summary.description, subagent: summary },
  ]);
  return { controller, messages, history, loadInvocations, settleChild: () => { running = false; }, parent: (value: boolean) => { parentRunning = value; } };
}

describe('background delegation watch lifetime', () => {
  it.each(['completed', 'cancelled', 'failed'] as const)('retains a %s child summary with no output or error text', async status => {
    const h = await harness(status);
    h.settleChild();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(h.messages).toContainEqual(expect.objectContaining({ type: 'subagent.update',
      toolUseId: 'task-1', subagent: expect.objectContaining({ status }) }));
    expect(h.controller.sessionState.runtime?.sendTurn).not.toHaveBeenCalled();
  });

  it('keeps one serialized ledger poll beyond ten minutes and settles the actual child', async () => {
    const h = await harness();
    await vi.advanceTimersByTimeAsync(11 * 60_000);
    expect(h.controller.subagentState.zombieSubagentWatch).not.toBeNull();
    expect(h.loadInvocations).toHaveBeenCalledTimes(132);
    h.settleChild(); await vi.advanceTimersByTimeAsync(5_000);
    expect(h.messages).toContainEqual(expect.objectContaining({ type: 'subagent.update', subagent: expect.objectContaining({ status: 'completed' }) }));
    const reads = h.loadInvocations.mock.calls.length;
    await vi.advanceTimersByTimeAsync(40_000);
    expect(h.loadInvocations).toHaveBeenCalledTimes(reads);
    expect(h.controller.subagentState.zombieSubagentWatch).toBeNull();
  });

  it('retains parent reconciliation while a follow-up runs longer than ten minutes', async () => {
    const h = await harness(); h.settleChild(); h.parent(true);
    await vi.advanceTimersByTimeAsync(11 * 60_000);
    expect(h.controller.subagentState.zombieSubagentWatch).not.toBeNull();
    expect(h.history.loadHistory).not.toHaveBeenCalled();
    h.parent(false); await vi.advanceTimersByTimeAsync(15_000);
    expect(h.controller.recoveryState.transcript.transcript).toContainEqual(expect.objectContaining({ kind: 'assistant', text: 'Long research finished' }));
    expect(h.controller.subagentState.zombieSubagentWatch).toBeNull();
  });

  it('shares an in-flight ledger read across timer ticks and stops on session replacement', async () => {
    const h = await harness();
    let resolve!: (value: Awaited<ReturnType<typeof h.loadInvocations>>) => void;
    h.loadInvocations.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const first = tickZombieSubagentWatch(h.controller, '/workspace', h.loadInvocations);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(h.loadInvocations).toHaveBeenCalledOnce();
    h.controller.sessionState.sessionId = 'other';
    resolve([]); await first;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(h.controller.subagentState.zombieSubagentWatch).toBeNull();
    expect(h.messages.some(message => message.type === 'subagent.update')).toBe(false);
  });

  it('does not overwrite a newly adopted turn when the idle history read finishes late', async () => {
    const h = await harness();
    h.controller.subagentState.zombieSubagentWatch!.rows = [];
    startParentFollowupSync(h.controller, 'session-1');
    let resolve!: (value: Awaited<ReturnType<SessionHistoryLoader['loadHistory']>>) => void;
    vi.mocked(h.history.loadHistory).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.history.loadHistory).toHaveBeenCalledOnce();
    h.controller.turnState.turnGeneration += 1;
    h.controller.turnState.turn = { turnId: 'new-automatic-turn', status: 'streaming', activity: createTurnActivityState() };
    resolve({ status: 'available', state: { historyStatus: 'complete', truncated: false,
      transcript: [{ kind: 'assistant', id: 'stale', turnId: 'old', text: 'Obsolete snapshot' }] } });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.controller.recoveryState.transcript.transcript.some(item => item.kind === 'assistant' && item.text === 'Obsolete snapshot')).toBe(false);
    expect(h.controller.subagentState.zombieSubagentWatch).not.toBeNull();
  });
});
