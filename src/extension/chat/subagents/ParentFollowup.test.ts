import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ParentSessionEvent, ParentSessionEventSource } from '../../../runtime/daemon/parentSessionEvents';
import { ParentFollowup } from './ParentFollowup';
import { createController, createMockRuntime, ready, waitForConnected, send, stop, successfulTurn, deferred, type RuntimeEvent, type RuntimeSessionWorkingState } from '../controllerTestHarness';
import type { RuntimeTurnOutcome } from '../../../runtime/turnOutcome';
import { TURN_IDLE_CONFIRM_READS, TURN_IDLE_GRACE_MS, TURN_WATCHDOG_POLL_MS } from '../turns/turnWatchdog';

const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); vi.useRealTimers(); });
async function flush() { for (let index = 0; index < 30; index++) await Promise.resolve(); }

async function harness(stream?: () => AsyncIterable<RuntimeEvent>) {
  const runtime = Object.assign(createMockRuntime(stream), {
    interruptSession: vi.fn(async () => {}),
    readSessionWorkingState: vi.fn<() => Promise<RuntimeSessionWorkingState>>(async () => 'running'),
    readTurnOutcome: vi.fn<(id: string) => Promise<RuntimeTurnOutcome | null>>(async id => ({
      backendTurnId: id, reason: 'completed' as RuntimeTurnOutcome['reason'], resultKind: 'text', completion: successfulTurn(),
    })),
  });
  const { controller, messages } = createController(() => runtime);
  let receive: ((event: ParentSessionEvent) => void) | undefined;
  const source: ParentSessionEventSource = { watchParent: vi.fn((_sessionId, _cwd, listener) => { receive = listener; return () => { receive = undefined; }; }) };
  const followup = new ParentFollowup(controller, source);
  cleanup.push(() => { followup.dispose(); return controller.dispose(); });
  ready(controller); await waitForConnected(messages);
  const emit = (event: ParentSessionEvent) => { expect(receive).toBeDefined(); receive!(event); };
  const start = (turnId = 'automatic-1') => emit({ type: 'turn-start', turnId, automatic: true });
  const event = (event: RuntimeEvent, turnId = 'automatic-1') => emit({ type: 'runtime', turnId, event });
  return { controller, messages, runtime, source, emit, start, event };
}

describe('automatic parent follow-up projection', () => {
  it('adopts a passive turn before its first delta and completes without sending a prompt', async () => {
    const h = await harness(); h.start();
    h.event({ type: 'text-delta', text: 'The child found six events.' });
    expect(h.controller.turnState.turn).toMatchObject({ status: 'streaming', recovery: true, backendTurnId: 'automatic-1' });
    expect(h.messages.at(-1)).toMatchObject({ type: 'assistant.delta', delta: 'The child found six events.' });
    h.event(successfulTurn());
    expect(h.controller.turnState.turn?.status).toBe('completed');
    expect(h.controller.recoveryState.transcript.transcript.filter(item => item.kind === 'assistant')).toEqual([
      expect.objectContaining({ text: 'The child found six events.' }),
    ]);
    expect(h.runtime.sendTurn).not.toHaveBeenCalled();
  });

  it('stops the daemon-side follow-up and preserves its cancellation outcome', async () => {
    const h = await harness(); h.start();
    const id = h.controller.turnState.turn!.turnId;
    stop(h.controller, 'session-1', id); await flush();
    expect(h.runtime.interruptSession).toHaveBeenCalledOnce();
    expect(h.runtime.interrupt).not.toHaveBeenCalled();
    h.event({ type: 'turn-complete', outcome: 'interrupted' });
    expect(h.controller.turnState.turn?.status).toBe('interrupted');
    expect(h.runtime.sendTurn).not.toHaveBeenCalled();
  });

  it('reconciles an overlapping follow-up from history instead of replaying foreground-consumed text', async () => {
    const released = deferred<void>();
    const h = await harness(async function* () { await released.promise; yield successfulTurn(); });
    send(h.controller, 'session-1', 'foreground', 'delegate'); await flush();
    h.emit({ type: 'turn-start', turnId: 'submitted-id', automatic: false });
    h.event({ type: 'text-delta', text: 'duplicate' }, 'submitted-id');
    h.start(); h.event({ type: 'text-delta', text: 'New asynchronous answer' }); h.event(successfulTurn());
    expect(h.messages.some(message => message.type === 'assistant.delta')).toBe(false);
    h.runtime.readSessionWorkingState.mockResolvedValue('idle');
    const load = vi.spyOn(h.controller.sessionHistory, 'loadHistory').mockImplementation(async () => ({
      status: 'available', state: { ...h.controller.recoveryState.transcript, transcript: [
        ...h.controller.recoveryState.transcript.transcript,
        { id: 'persisted-answer', kind: 'assistant', turnId: 'persisted-follow-up', text: 'New asynchronous answer' },
      ] },
    }));
    released.resolve(); await flush();
    expect(h.messages.filter(message => message.type === 'assistant.delta')).toEqual([]);
    expect(load).toHaveBeenCalledOnce();
    expect(h.controller.recoveryState.transcript.transcript.filter(item => item.kind === 'assistant')).toEqual([
      expect.objectContaining({ text: 'New asynchronous answer' }),
    ]);
    expect(h.controller.turnState.turn?.status).toBe('completed');
    expect(h.runtime.sendTurn).toHaveBeenCalledOnce();
  });

  it('hands transport gaps to the existing recovery path without replaying partial deltas', async () => {
    const h = await harness(); h.start();
    h.event({ type: 'text-delta', text: 'Before gap' });
    const recover = vi.spyOn(h.controller.effects, 'reconcileDaemonTurn').mockImplementation(() => {});
    h.emit({ type: 'resync' }); h.emit({ type: 'resync' }); await flush();
    expect(recover).toHaveBeenCalledOnce();
    h.event({ type: 'text-delta', text: 'After gap' }); h.event(successfulTurn());
    expect(h.messages.filter(message => message.type === 'assistant.delta')).toHaveLength(1);
    expect(h.controller.turnState.turn?.transportRecovery?.completion?.outcome).toBe('success');
    expect(h.runtime.sendTurn).not.toHaveBeenCalled();
  });

  it('reconciles two automatic turns queued behind foreground release instead of dropping the first answer', async () => {
    const released = deferred<void>();
    const h = await harness(async function* () { await released.promise; yield successfulTurn(); });
    const recover = vi.spyOn(h.controller.effects, 'reconcileDaemonTurn').mockImplementation(() => {});
    send(h.controller, 'session-1', 'foreground', 'delegate'); await flush();
    h.start(); h.event({ type: 'text-delta', text: 'First follow-up' }); h.event(successfulTurn());
    h.start('automatic-2'); h.event({ type: 'text-delta', text: 'Second follow-up' }, 'automatic-2');
    released.resolve(); await flush();
    expect(recover).toHaveBeenCalledOnce();
    expect(h.messages.some(message => message.type === 'assistant.delta')).toBe(false);
    expect(h.runtime.sendTurn).toHaveBeenCalledOnce();
  });

  it('drops an old observer after the runtime generation changes', async () => {
    const h = await harness(); h.start();
    h.controller.sessionState.runtimeGeneration += 1;
    h.event({ type: 'text-delta', text: 'stale runtime text' });
    expect(h.messages.some(message => message.type === 'assistant.delta')).toBe(false);
  });

  it('settles an automatic turn with a lost terminal notification using its exact durable outcome', async () => {
    const h = await harness();
    vi.useFakeTimers(); h.start(); h.event({ type: 'text-delta', text: 'Background result' });
    const load = vi.spyOn(h.controller.effects, 'loadHistoryTimed').mockImplementation(async () => ({
      status: 'available', state: h.controller.recoveryState.transcript,
    }));
    h.runtime.readSessionWorkingState.mockResolvedValue('idle');
    await vi.advanceTimersByTimeAsync(TURN_IDLE_GRACE_MS + TURN_WATCHDOG_POLL_MS * (TURN_IDLE_CONFIRM_READS - 1));
    await flush();
    expect(h.runtime.readTurnOutcome).toHaveBeenCalledWith('automatic-1');
    expect(load).toHaveBeenCalled();
    expect(h.controller.turnState.turn?.status).toBe('completed');
    expect(h.controller.recoveryState.transcript.transcript.filter(item => item.kind === 'assistant')).toHaveLength(1);
    expect(h.runtime.sendTurn).not.toHaveBeenCalled();
    expect(h.runtime.interruptSession).not.toHaveBeenCalled();
  });

  it('does not reinterpret an idle backend as success without the matching automatic outcome', async () => {
    const h = await harness();
    vi.useFakeTimers(); h.start();
    vi.spyOn(h.controller.effects, 'loadHistoryTimed').mockImplementation(async () => ({
      status: 'available', state: h.controller.recoveryState.transcript,
    }));
    h.runtime.readTurnOutcome.mockResolvedValue(null);
    h.runtime.readSessionWorkingState.mockResolvedValue('idle');
    await vi.advanceTimersByTimeAsync(TURN_IDLE_GRACE_MS + TURN_WATCHDOG_POLL_MS * (TURN_IDLE_CONFIRM_READS - 1));
    await flush();
    expect(h.controller.turnState.turn?.status).toBe('failed');
    expect(h.messages).toContainEqual(expect.objectContaining({ type: 'turn.error', code: 'recovered-turn-outcome-unconfirmed' }));
  });

  it('does not re-adopt a completed turn when an earlier transport-state read returns late', async () => {
    const h = await harness(); h.start();
    const current = h.controller.turnState.turn!.turnId;
    const working = deferred<RuntimeSessionWorkingState>();
    h.runtime.readSessionWorkingState.mockReturnValue(working.promise);
    h.emit({ type: 'resync' }); h.event(successfulTurn());
    working.resolve('running'); await flush();
    expect(h.controller.turnState.turn).toMatchObject({ turnId: current, status: 'completed' });
    expect(h.runtime.sendTurn).not.toHaveBeenCalled();
  });

  it('keeps a healthy or waiting automatic turn live and stops probing when its session is replaced', async () => {
    const h = await harness();
    vi.useFakeTimers(); h.start();
    const recover = vi.spyOn(h.controller.effects, 'reconcileDaemonTurn').mockImplementation(() => {});
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.runtime.readSessionWorkingState).toHaveBeenCalled();
    h.runtime.readSessionWorkingState.mockResolvedValue('waiting-for-user');
    await vi.advanceTimersByTimeAsync(20_000);
    expect(recover).not.toHaveBeenCalled();
    expect(h.controller.turnState.turn?.status).toBe('streaming');
    h.controller.sessionState.sessionId = 'another-session';
    const calls = h.runtime.readSessionWorkingState.mock.calls.length;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(h.runtime.readSessionWorkingState).toHaveBeenCalledTimes(calls);
    expect(recover).not.toHaveBeenCalled();
  });
});
