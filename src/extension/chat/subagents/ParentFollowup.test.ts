import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ParentSessionEvent, ParentSessionEventSource } from '../../../runtime/daemon/parentSessionEvents';
import { ParentFollowup } from './ParentFollowup';
import { createController, createMockRuntime, ready, waitForConnected, send, stop, successfulTurn, deferred, type RuntimeEvent } from '../controllerTestHarness';

const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); vi.useRealTimers(); });
async function flush() { for (let index = 0; index < 30; index++) await Promise.resolve(); }

async function harness(stream?: () => AsyncIterable<RuntimeEvent>) {
  const runtime = Object.assign(createMockRuntime(stream), { interruptSession: vi.fn(async () => {}), readSessionWorkingState: vi.fn(async () => 'running' as const) });
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
    expect(h.controller.turnState.turn).toMatchObject({ status: 'streaming', recovery: true });
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

  it('ignores foreground duplicates and drains an automatic turn that arrived before the foreground loop released', async () => {
    const released = deferred<void>();
    const h = await harness(async function* () { await released.promise; yield successfulTurn(); });
    send(h.controller, 'session-1', 'foreground', 'delegate'); await flush();
    h.emit({ type: 'turn-start', turnId: 'submitted-id', automatic: false });
    h.event({ type: 'text-delta', text: 'duplicate' }, 'submitted-id');
    h.start(); h.event({ type: 'text-delta', text: 'New asynchronous answer' }); h.event(successfulTurn());
    expect(h.messages.some(message => message.type === 'assistant.delta')).toBe(false);
    released.resolve(); await flush();
    expect(h.messages.filter(message => message.type === 'assistant.delta')).toEqual([
      expect.objectContaining({ delta: 'New asynchronous answer' }),
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
});
