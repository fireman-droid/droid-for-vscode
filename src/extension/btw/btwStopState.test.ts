import { describe, expect, it, vi } from 'vitest';
import type { BtwAnswerEvent } from '../../runtime/btw/BtwSidecar';
import { parseSessionBtwMessage, type SessionBtwState } from '../../shared/protocol/btwProtocol';
import { BtwSideChat } from './btwSideChat';

async function runningCard() {
  const states: SessionBtwState[] = [];
  let finish!: (event: BtwAnswerEvent) => void;
  let fail!: (error: Error) => void;
  const end = new Promise<BtwAnswerEvent>((resolve, reject) => { finish = resolve; fail = reject; });
  const interrupt = vi.fn(async () => {});
  const started = vi.fn();
  const card = new BtwSideChat(async () => ({
    async *ask() { started(); yield { kind: 'delta' as const, text: 'Partial answer' }; yield await end; },
    interrupt, dispose: async () => {},
  }), (_, state) => states.push(state));
  const asking = card.handleAsk('/repo', 'main', 'Explain this');
  await vi.waitFor(() => expect(started).toHaveBeenCalled());
  return { card, states, interrupt, finish, fail, asking };
}

describe('side-answer stop feedback', () => {
  it('waits for the terminal stream even after interrupt resolves, suppressing duplicate stops', async () => {
    const run = await runningCard();
    run.card.handleStop('main');
    await Promise.resolve();
    run.card.handleStop('main');
    expect(run.interrupt).toHaveBeenCalledTimes(1);
    expect(run.states.at(-1)).toMatchObject({ stopping: true, entries: [{ state: 'streaming', answer: 'Partial answer' }] });
    run.finish({ kind: 'done' });
    await run.asking;
    expect(run.states.at(-1)?.stopping).toBeUndefined();
    expect(run.states.at(-1)?.entries[0]).toMatchObject({ state: 'done', stopped: true, answer: 'Partial answer' });
  });

  it('exposes a rejected stop and lets the user retry without losing the active answer', async () => {
    const run = await runningCard();
    run.interrupt.mockRejectedValueOnce(new Error('interrupt rejected'));
    run.card.handleStop('main');
    await vi.waitFor(() => expect(run.states.at(-1)?.message).toContain('Try Stop again'));
    expect(run.states.at(-1)?.stopping).toBeUndefined();
    expect(run.states.at(-1)?.entries[0].state).toBe('streaming');
    run.card.handleStop('main');
    expect(run.interrupt).toHaveBeenCalledTimes(2);
    expect(run.states.at(-1)).toMatchObject({ stopping: true, message: null });
    run.finish({ kind: 'done' });
    await run.asking;
    expect(run.states.at(-1)?.entries[0].stopped).toBe(true);
  });

  it.each(['event', 'exception'])('does not report a lost connection as a confirmed stop (%s)', async mode => {
    const run = await runningCard();
    run.card.handleStop('main');
    if (mode === 'event') run.finish({ kind: 'error', message: 'Side chat connection failed.', connectionLost: true });
    else run.fail(new Error('socket closed'));
    await run.asking;
    expect(run.states.at(-1)?.stopping).toBeUndefined();
    expect(run.states.at(-1)?.entries[0]).toMatchObject({ state: 'error', answer: 'Partial answer' });
    expect(run.states.at(-1)?.entries[0].stopped).toBeUndefined();
  });

  it('carries pending and confirmed stop snapshots through the strict shared bridge', async () => {
    const run = await runningCard();
    run.card.handleStop('main');
    const pending = run.states.at(-1)!;
    run.finish({ kind: 'done' });
    await run.asking;
    const done = run.states.at(-1)!;
    const envelope = { type: 'session.btw', sequence: 1, sessionId: 'main' };
    expect(parseSessionBtwMessage({ ...envelope, btw: pending })?.btw).toEqual(pending);
    expect(parseSessionBtwMessage({ ...envelope, btw: done })?.btw).toEqual(done);
    expect(parseSessionBtwMessage({ ...envelope, btw: { ...pending, stopping: 'yes' } })).toBeNull();
    expect(parseSessionBtwMessage({ ...envelope, btw: { ...done, entries: [{ ...done.entries[0], stopped: 'yes' }] } })).toBeNull();
  });
});
