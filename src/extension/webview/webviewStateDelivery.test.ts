import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatControllerListener, ControllerHostMessage } from '../chat/hostTypes';
import { createWebviewStateDelivery } from './webviewStateDelivery';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function harness() {
  const state = { visible: true, current: true, completed: false, sequence: 0 };
  const snapshot = (): Extract<ControllerHostMessage, { type: 'host.snapshot' }> => ({
    type: 'host.snapshot', sequence: ++state.sequence,
    conversationId: 'conversation', sessionId: 'session', connection: { status: 'connected' },
    turn: { turnId: 'turn', status: state.completed ? 'completed' : 'streaming' },
    sessions: { status: 'idle', items: [] },
    settings: { status: 'loading', value: null },
    context: { status: 'loading', value: null },
    modelCatalog: { status: 'loading', items: [] },
    transcript: [{ id: 'assistant', kind: 'assistant', turnId: 'turn',
      text: state.completed ? 'Terminal finished; here is the answer.' : 'Running terminal.' }],
    historyStatus: 'unavailable', truncated: false,
  });
  const postMessage = vi.fn<(message: ControllerHostMessage) => PromiseLike<boolean>>(
    async () => true,
  );
  const replayTo = vi.fn(async (listener: ChatControllerListener) => { listener(snapshot()); });
  const delivery = createWebviewStateDelivery({
    isCurrent: () => state.current,
    isVisible: () => state.visible,
    postMessage, replayTo,
  });
  const completed = (): ControllerHostMessage => ({
    type: 'turn.state', sequence: ++state.sequence,
    sessionId: 'session', turnId: 'turn', status: 'completed',
  });
  return { state, snapshot, postMessage, replayTo, delivery, completed };
}

async function ready(value: ReturnType<typeof harness>) {
  value.delivery.onReady();
  await vi.advanceTimersByTimeAsync(0);
  value.postMessage.mockClear();
  value.replayTo.mockClear();
}

describe('webview state delivery recovery', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it.each(['false', 'rejection', 'throw'] as const)(
    'recovers a lost terminal state after postMessage %s without replaying deltas',
    async (failure) => {
      const h = harness();
      await ready(h);
      h.state.completed = true;
      h.postMessage.mockImplementationOnce(() => {
        if (failure === 'throw') throw new Error('view unavailable');
        return failure === 'false' ? Promise.resolve(false) : Promise.reject(new Error('view unavailable'));
      });
      const terminal = h.completed();
      h.delivery.post(terminal);
      await vi.advanceTimersByTimeAsync(500);
      expect(h.replayTo).toHaveBeenCalledOnce();
      expect(h.postMessage.mock.calls.filter(([message]) => message.type === 'turn.state'))
        .toEqual([[terminal]]);
      expect(h.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({
        type: 'host.snapshot', turn: { turnId: 'turn', status: 'completed' },
        transcript: [expect.objectContaining({ text: 'Terminal finished; here is the answer.' })],
      }));
    },
  );

  it('restores a missed terminal tool row even when the later completed turn was posted', async () => {
    const h = harness();
    await ready(h);
    h.state.completed = true;
    const terminal: Extract<ControllerHostMessage, { type: 'tool.activity' }> = {
      type: 'tool.activity', sequence: ++h.state.sequence, sessionId: 'session',
      turnId: 'turn', toolUseId: 'execute', toolName: 'Execute', action: 'Run command',
      status: 'completed', progressCount: 0, latestUpdateKind: null,
    };
    h.replayTo.mockImplementationOnce(async (listener) => {
      const snapshot = h.snapshot();
      const { type: _type, sequence: _sequence, sessionId: _sessionId, ...tool } = terminal;
      listener({ ...snapshot, transcript: [{ ...tool, id: 'tool', kind: 'tool' }, ...snapshot.transcript] });
    });
    h.postMessage.mockResolvedValueOnce(false);
    h.delivery.post(terminal);
    h.delivery.post(h.completed());
    await vi.advanceTimersByTimeAsync(500);
    expect(h.replayTo).toHaveBeenCalledOnce();
    expect(h.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({
      type: 'host.snapshot',
      transcript: expect.arrayContaining([expect.objectContaining({ kind: 'tool', status: 'completed' })]),
    }));
    expect(h.postMessage.mock.calls.filter(([message]) => message.type === 'tool.activity')).toEqual([[terminal]]);
  });

  it('resynchronizes hidden updates on return even when postMessage reported true', async () => {
    const h = harness();
    await ready(h);
    h.state.visible = false;
    h.state.completed = true;
    const terminal = h.completed();
    h.delivery.post(terminal);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(h.replayTo).not.toHaveBeenCalled();
    h.state.visible = true;
    h.delivery.onVisible();
    await vi.advanceTimersByTimeAsync(500);
    expect(h.replayTo).toHaveBeenCalledOnce();
    expect(h.postMessage.mock.calls.map(([message]) => message.type)).toEqual(['turn.state', 'host.snapshot']);
  });

  it('does not treat a snapshot posted while hidden as a received snapshot', async () => {
    const h = harness();
    await ready(h);
    h.state.visible = false;
    const posted = deferred<boolean>();
    h.postMessage.mockImplementationOnce(() => posted.promise);
    h.delivery.post(h.snapshot());
    h.state.visible = true;
    h.delivery.onVisible();
    posted.resolve(true);
    await vi.advanceTimersByTimeAsync(500);
    expect(h.replayTo).toHaveBeenCalledOnce();
  });

  it('coalesces replay requests but preserves newer missing state across an older snapshot callback', async () => {
    const h = harness();
    await ready(h);
    h.postMessage.mockResolvedValueOnce(false);
    h.delivery.post(h.completed());
    const posted = deferred<boolean>();
    const replay = deferred<void>();
    h.replayTo.mockImplementationOnce(async (listener) => {
      h.postMessage.mockImplementationOnce(() => posted.promise);
      listener(h.snapshot());
      await replay.promise;
    });
    await vi.advanceTimersByTimeAsync(500);
    expect(h.replayTo).toHaveBeenCalledOnce();
    h.state.visible = false;
    h.delivery.post(h.completed());
    h.state.visible = true;
    h.delivery.onVisible();
    h.delivery.onVisible();
    posted.resolve(true);
    replay.resolve();
    await vi.advanceTimersByTimeAsync(500);
    expect(h.replayTo).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(h.replayTo).toHaveBeenCalledTimes(2);
  });

  it('keeps a healthy view intact when hide/show has no intervening updates', async () => {
    const h = harness();
    await ready(h);
    h.state.visible = false;
    await vi.advanceTimersByTimeAsync(1_000);
    h.state.visible = true;
    h.delivery.onVisible();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(h.replayTo).not.toHaveBeenCalled();
    expect(h.postMessage).not.toHaveBeenCalled();
  });

  it('does not replay a one-shot canvas draft or trigger conversation recovery for it', async () => {
    const h = harness();
    await ready(h);
    h.state.visible = false;
    h.postMessage.mockResolvedValueOnce(false);
    h.delivery.post({ type: 'canvas.feedbackDraft', sequence: ++h.state.sequence, text: 'Selected element' });
    await vi.advanceTimersByTimeAsync(0);
    h.state.visible = true;
    h.delivery.onVisible();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(h.replayTo).not.toHaveBeenCalled();
    expect(h.postMessage).toHaveBeenCalledOnce();
  });

  it('does not send a delayed recovery after view disposal', async () => {
    const h = harness();
    await ready(h);
    h.postMessage.mockResolvedValueOnce(false);
    h.delivery.post(h.completed());
    await vi.advanceTimersByTimeAsync(0);
    h.delivery.dispose();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(h.replayTo).not.toHaveBeenCalled();
  });
});
import { BRIDGE_PROTOCOL_VERSION } from '../../shared/bridgeMessages';

async function confirmed(h: ReturnType<typeof harness>, pageId = 'page') {
  h.delivery.onReady({ type: 'webview.ready', protocolVersion: BRIDGE_PROTOCOL_VERSION, pageId });
  await vi.advanceTimersByTimeAsync(0);
  const snapshot = h.postMessage.mock.calls.at(-1)![0];
  h.delivery.onStateApplied({ type: 'webview.state-applied', pageId,
    sequences: [snapshot.sequence], snapshotSequence: snapshot.sequence });
  h.postMessage.mockClear(); h.replayTo.mockClear();
}

function applied(h: ReturnType<typeof harness>, message: ControllerHostMessage, pageId = 'page') {
  h.delivery.onStateApplied({ type: 'webview.state-applied', pageId,
    sequences: [message.sequence], snapshotSequence: message.type === 'host.snapshot' ? message.sequence : null });
}

function planMessage(h: ReturnType<typeof harness>): Extract<ControllerHostMessage, { type: 'plan.document.state' }> {
  return { type: 'plan.document.state', sequence: ++h.state.sequence, sessionId: 'session',
    turnId: 'turn', requestId: 'plan', status: 'ready', content: 'Edited implementation plan' };
}
function planSnapshot(h: ReturnType<typeof harness>): Extract<ControllerHostMessage, { type: 'host.snapshot' }> {
  return { ...h.snapshot(), interactions: [{ sessionId: 'session', turnId: 'turn',
    request: { requestId: 'plan', kind: 'permission', tools: [], options: [] } }] };
}

describe('page application receipts', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('recovers a silently dropped message even though postMessage returned true', async () => {
    const h = harness(); await confirmed(h);
    h.state.completed = true;
    h.delivery.post(h.completed());
    await vi.advanceTimersByTimeAsync(1999);
    expect(h.replayTo).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(h.replayTo).toHaveBeenCalledOnce();
    const snapshot = h.postMessage.mock.calls.at(-1)![0];
    applied(h, snapshot);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.replayTo).toHaveBeenCalledOnce();
  });

  it('does not let a later receipt conceal a missing middle message or a global sequence gap', async () => {
    const h = harness(); await confirmed(h);
    h.state.sequence += 3; // Other panels may consume globally stamped sequences.
    const missed = h.completed(); h.delivery.post(missed);
    const received = h.completed(); h.delivery.post(received); applied(h, received);
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.replayTo).toHaveBeenCalledOnce();
    applied(h, h.postMessage.mock.calls.at(-1)![0]);
    h.state.sequence += 10;
    const next = h.completed(); h.delivery.post(next); applied(h, next);
    await vi.advanceTimersByTimeAsync(3000);
    expect(h.replayTo).toHaveBeenCalledOnce();
  });

  it('queues a fresh replay when a new page is ready during the previous replay', async () => {
    const h = harness();
    const finish = deferred<void>();
    h.replayTo.mockImplementationOnce(async (listener) => {
      listener(h.snapshot());
      await finish.promise;
    });
    h.delivery.onReady({ type: 'webview.ready', protocolVersion: BRIDGE_PROTOCOL_VERSION, pageId: 'old-page' });
    await vi.advanceTimersByTimeAsync(0);
    h.delivery.onReady({ type: 'webview.ready', protocolVersion: BRIDGE_PROTOCOL_VERSION, pageId: 'page' });
    finish.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.replayTo).toHaveBeenCalledTimes(2);
    applied(h, h.postMessage.mock.calls.at(-1)![0]);
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.replayTo).toHaveBeenCalledTimes(2);
  });

  it('ignores another page and does not accept a fake cumulative snapshot receipt', async () => {
    const h = harness(); await confirmed(h);
    const missed = h.completed(); h.delivery.post(missed);
    const next = h.completed(); h.delivery.post(next);
    applied(h, missed, 'old-page');
    h.delivery.onStateApplied({ type: 'webview.state-applied', pageId: 'page',
      sequences: [next.sequence], snapshotSequence: next.sequence });
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.replayTo).toHaveBeenCalledOnce();
  });

  it('keeps a missed plan after a snapshot receipt and settles it only when the replayed plan is applied', async () => {
    const h = harness(); await confirmed(h);
    h.delivery.post(planMessage(h));
    const ordinarySnapshot = planSnapshot(h);
    h.delivery.post(ordinarySnapshot); applied(h, ordinarySnapshot);
    h.replayTo.mockImplementationOnce(async (listener) => {
      listener(planSnapshot(h));
      listener(planMessage(h));
    });
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.replayTo).toHaveBeenCalledOnce();
    const replayed = h.postMessage.mock.calls.slice(-2).map(([message]) => message);
    expect(replayed.map((message) => message.type)).toEqual(['host.snapshot', 'plan.document.state']);
    applied(h, replayed[0]!);
    await vi.advanceTimersByTimeAsync(1000);
    applied(h, replayed[1]!);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.replayTo).toHaveBeenCalledOnce();
  });

  it('does not discard a missed plan when the snapshot-covered receipt queue overflows', async () => {
    const h = harness(); await confirmed(h);
    h.delivery.post(planMessage(h));
    for (let index = 0; index < 2050; index++) h.delivery.post(h.completed());
    const ordinarySnapshot = planSnapshot(h);
    h.delivery.post(ordinarySnapshot); applied(h, ordinarySnapshot);
    h.replayTo.mockImplementationOnce(async (listener) => {
      listener(planSnapshot(h)); listener(planMessage(h));
    });
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.replayTo).toHaveBeenCalledOnce();
    for (const [message] of h.postMessage.mock.calls.slice(-2)) applied(h, message);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.replayTo).toHaveBeenCalledOnce();
  });

  it('does not treat a contentless plan status receipt as receipt of the missing edited content', async () => {
    const h = harness(); await confirmed(h);
    const edited = planMessage(h); h.delivery.post(edited);
    const closed: ControllerHostMessage = { type: 'plan.document.state', sequence: ++h.state.sequence,
      sessionId: 'session', turnId: 'turn', requestId: 'plan', status: 'closed' };
    h.delivery.post(closed); applied(h, closed);
    h.replayTo.mockImplementationOnce(async (listener) => {
      listener(planSnapshot(h)); listener(planMessage(h));
    });
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.replayTo).toHaveBeenCalledOnce();
    for (const [message] of h.postMessage.mock.calls.slice(-2)) applied(h, message);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.replayTo).toHaveBeenCalledOnce();
  });

  it.each(['closed-interaction', 'settled-snapshot', 'new-session', 'omitted-interactions'] as const)(
    'stops waiting for an obsolete plan after %s', async (transition) => {
      const h = harness(); await confirmed(h);
      h.delivery.post(planMessage(h));
      const message: ControllerHostMessage = transition === 'closed-interaction'
        ? { type: 'interaction.closed', sequence: ++h.state.sequence, sessionId: 'session', turnId: 'turn', requestId: 'plan' }
        : { ...h.snapshot(), sessionId: transition === 'new-session' ? 'another-session' : 'session', ...(transition === 'omitted-interactions' ? {} : { interactions: [] }) };
      h.delivery.post(message); applied(h, message);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(h.replayTo).not.toHaveBeenCalled();
    },
  );

  it('keeps healthy streamed updates free from snapshot replay and stops after three unconfirmed attempts', async () => {
    const h = harness(); await confirmed(h);
    for (let index = 0; index < 60; index++) {
      const message = h.completed(); h.delivery.post(message); applied(h, message);
      await vi.advanceTimersByTimeAsync(50);
    }
    expect(h.replayTo).not.toHaveBeenCalled();
    h.delivery.post(h.completed());
    await vi.advanceTimersByTimeAsync(20_000);
    expect(h.replayTo).toHaveBeenCalledTimes(3);
    h.delivery.dispose();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(h.replayTo).toHaveBeenCalledTimes(3);
  });
});
