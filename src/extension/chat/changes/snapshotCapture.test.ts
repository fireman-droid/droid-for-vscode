import { describe, expect, it, vi } from 'vitest';
import type { TurnSnapshotRecord, TurnSnapshotScope, TurnSnapshotStore } from '../../changes/turnSnapshots';
import { captureSnapshotBeforeSend } from './snapshotCapture';
import { resolveSettledChangeFiles } from './settleTurnChanges';
import { createController, createMockRuntime, deferred, queueAdd, ready, send,
  successfulTurn, turnStates, waitForConnected } from '../controllerTestHarness';

const previous = { sessionId: 'session', turnId: 'previous' };
const next = { sessionId: 'session', turnId: 'next' };
function fixture() {
  let finish!: (value: string | undefined) => void;
  let fail!: (error: Error) => void;
  const finalCapture = new Promise<string | undefined>((resolve, reject) => { finish = resolve; fail = reject; });
  const record = { turnId: previous.turnId, before: 'before', after: undefined as string | undefined,
    coverage: 'workspace-files-v1' } satisfies TurnSnapshotRecord;
  let pending: TurnSnapshotScope | undefined = previous;
  const store = {
    read: () => record,
    readPendingCapture: vi.fn(async () => pending),
    capture: vi.fn(async (_scope: TurnSnapshotScope, phase: 'before' | 'after') => {
      if (phase === 'before') return 'next-before';
      const after = await finalCapture;
      if (after) { record.after = after; pending = undefined; }
      return after;
    }),
    diff: vi.fn(async () => new Map()),
    dispose: async () => undefined,
  };
  const snapshots = store as unknown as TurnSnapshotStore;
  const host = { turnSnapshots: snapshots, changeStats: { read: vi.fn(async () => new Map()) } };
  const runtime = { readSessionWorkingState: vi.fn(async () => 'unknown' as const) };
  const settle = () => resolveSettledChangeFiles(host, previous.sessionId, previous.turnId, []);
  return { host, runtime, store, record, finish, fail, settle };
}

describe('sending while the previous completed turn records its changes', () => {
  it('dispatches a message queued during a live reply only after its final capture finishes', async () => {
    const f = fixture();
    const firstDone = deferred<void>();
    const secondDone = deferred<void>();
    const runtime = createMockRuntime(async function* (text) {
      yield { type: 'text-delta', text: 'answer' };
      await (text === 'first' ? firstDone.promise : secondDone.promise);
      yield successfulTurn();
    });
    runtime.initialize.mockResolvedValue({ status: 'available', sessionId: 'session',
      sdkVersion: 'test', cliVersion: null, authenticationStatus: 'unknown' });
    runtime.readSessionWorkingState = f.runtime.readSessionWorkingState;
    const { controller, messages } = createController(() => runtime);
    Object.defineProperty(controller, 'turnSnapshots', { value: f.host.turnSnapshots });
    try {
      ready(controller);
      await waitForConnected(messages);
      send(controller, 'session', 'previous', 'first');
      await vi.waitFor(() => expect(runtime.sendTurn).toHaveBeenCalledTimes(1));
      queueAdd(controller, 'session', 'next', 'correction');
      firstDone.resolve();
      await vi.waitFor(() => expect(turnStates(messages).at(-1)).toMatchObject({ turnId: 'next', status: 'submitting' }));
      expect(runtime.sendTurn).toHaveBeenCalledTimes(1);
      f.finish('after');
      await vi.waitFor(() => expect(runtime.sendTurn).toHaveBeenCalledTimes(2));
      expect(runtime.sendTurn.mock.calls.map(([text]) => text)).toEqual(['first', 'correction']);
      expect(messages.some(message => message.type === 'turn.error')).toBe(false);
      expect(f.runtime.readSessionWorkingState).not.toHaveBeenCalled();
    } finally {
      firstDone.resolve(); secondDone.resolve(); f.finish('after');
      await controller.dispose();
    }
  });

  it('waits for the terminal capture instead of treating a stale backend state as a running reply', async () => {
    const f = fixture();
    const settling = f.settle();
    let sent = false;
    const sending = captureSnapshotBeforeSend(f.host, next.sessionId, next.turnId, undefined, f.runtime)
      .then(() => { sent = true; });
    await Promise.resolve();
    await Promise.resolve();
    expect(sent).toBe(false);
    f.finish('after');
    await expect(Promise.all([settling, sending])).resolves.toEqual([[], undefined]);
    expect(f.runtime.readSessionWorkingState).not.toHaveBeenCalled();
    expect(f.store.capture.mock.calls).toEqual([[previous, 'after', undefined], [next, 'before', undefined]]);
  });

  it('does not replace the baseline when the terminal capture fails', async () => {
    const f = fixture();
    const settling = f.settle();
    const sending = captureSnapshotBeforeSend(f.host, next.sessionId, next.turnId, undefined, f.runtime);
    const outcomes = Promise.allSettled([settling, sending]);
    f.fail(new Error('disk unavailable'));
    expect((await outcomes).map(result => result.status)).toEqual(['rejected', 'rejected']);
    expect(f.store.capture.mock.calls.every(([, phase]) => phase === 'after')).toBe(true);
  });

  it('cancels the new send without cancelling the previous turn recording', async () => {
    const f = fixture();
    const settling = f.settle();
    const abort = new AbortController();
    const sending = captureSnapshotBeforeSend(f.host, next.sessionId, next.turnId, abort.signal, f.runtime);
    const rejected = expect(sending).rejects.toMatchObject({ name: 'AbortError' });
    await Promise.resolve();
    abort.abort();
    f.finish('after');
    await settling;
    await rejected;
    expect(f.record.after).toBe('after');
    expect(f.store.capture).toHaveBeenCalledTimes(1);
  });

  it('still blocks an unfinished old turn when there is no local terminal capture', async () => {
    const f = fixture();
    await expect(captureSnapshotBeforeSend(f.host, next.sessionId, next.turnId, undefined, f.runtime))
      .rejects.toThrow('previous reply is still running');
    expect(f.store.capture).not.toHaveBeenCalled();
  });

  it('accepts a completed capture even if the pending-owner read raced its release', async () => {
    const f = fixture();
    f.record.after = 'after';
    f.finish('after');
    await captureSnapshotBeforeSend(f.host, next.sessionId, next.turnId, undefined, f.runtime);
    expect(f.runtime.readSessionWorkingState).not.toHaveBeenCalled();
    expect(f.store.capture).toHaveBeenLastCalledWith(next, 'before', undefined);
  });
});
