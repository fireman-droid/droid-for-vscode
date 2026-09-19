import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BtwAnswerEvent } from '../../runtime/btw/BtwSidecar';
import type { SessionBtwState } from '../../shared/protocol/btwProtocol';
import { BtwSideChat, type BtwSideChatSidecar } from './btwSideChat';

class FakeSidecar implements BtwSideChatSidecar {
  readonly asked: string[] = [];
  disposed = false;
  interrupts = 0;
  /** Set to stall the stream after its deltas until interrupted. */
  holdAfterDeltas = false;
  private release: (() => void) | null = null;
  private script: readonly BtwAnswerEvent[][] = [];

  respondWith(...turns: readonly BtwAnswerEvent[][]): void {
    this.script = turns;
  }

  async *ask(text: string): AsyncGenerator<BtwAnswerEvent, void> {
    this.asked.push(text);
    const events = this.script[this.asked.length - 1] ?? [{ kind: 'done' } as const];
    for (const event of events) {
      if (this.holdAfterDeltas && event.kind !== 'delta' && this.interrupts === 0) {
        await new Promise<void>((resolve) => {
          this.release = resolve;
        });
      }
      await Promise.resolve();
      yield event;
    }
  }

  async interrupt(): Promise<void> {
    this.interrupts += 1;
    this.release?.();
    this.release = null;
  }

  async dispose(): Promise<void> {
    this.disposed = true;
  }
}

describe('BtwSideChat', () => {
  let emitted: { sessionId: string; btw: SessionBtwState }[];
  let sidecar: FakeSidecar;
  let factoryCalls: { cwd: string; mainSessionId: string }[];
  let factoryError: Error | null;

  beforeEach(() => {
    vi.useFakeTimers();
    emitted = [];
    sidecar = new FakeSidecar();
    factoryCalls = [];
    factoryError = null;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function createCard(): BtwSideChat {
    return new BtwSideChat(
      async (cwd, mainSessionId) => {
        factoryCalls.push({ cwd, mainSessionId });
        if (factoryError !== null) {
          throw factoryError;
        }
        return sidecar;
      },
      (sessionId, btw) => {
        emitted.push({ sessionId, btw });
      },
    );
  }

  it('prepares once on open and reuses the fork for the first ask', async () => {
    const card = createCard();
    await card.handlePrepare('/repo', 'main-1');

    expect(factoryCalls).toEqual([{ cwd: '/repo', mainSessionId: 'main-1' }]);
    expect(sidecar.asked).toEqual([]);
    expect(emitted.at(-1)?.btw.status).toBe('ready');

    await card.handleAsk('/repo', 'main-1', 'first');
    expect(factoryCalls).toHaveLength(1);
    expect(sidecar.asked).toEqual(['first']);
  });

  it('serializes a rapid reopen behind stale preparation', async () => {
    let releaseFirst: (sidecar: BtwSideChatSidecar) => void = () => undefined;
    const firstPreparation = new Promise<BtwSideChatSidecar>((resolve) => {
      releaseFirst = resolve;
    });
    const stale = new FakeSidecar();
    const fresh = new FakeSidecar();
    let calls = 0;
    const card = new BtwSideChat(
      () => {
        calls += 1;
        return calls === 1 ? firstPreparation : Promise.resolve(fresh);
      },
      (sessionId, btw) => {
        emitted.push({ sessionId, btw });
      },
    );

    const first = card.handlePrepare('/repo', 'main-1');
    card.reset();
    const reopened = card.handlePrepare('/repo', 'main-1');
    await Promise.resolve();
    expect(calls).toBe(1);

    releaseFirst(stale);
    await first;
    await reopened;

    expect(calls).toBe(2);
    expect(stale.disposed).toBe(true);
    expect(emitted.at(-1)?.btw.status).toBe('ready');
  });

  it('prepares as an ask fallback, streams, and completes', async () => {
    sidecar.respondWith([
      { kind: 'delta', text: 'Hello' },
      { kind: 'delta', text: ' side' },
      { kind: 'done' },
    ]);
    const card = createCard();
    await card.handleAsk('/repo', 'main-1', 'What is this?');

    expect(factoryCalls).toEqual([{ cwd: '/repo', mainSessionId: 'main-1' }]);
    expect(sidecar.asked).toEqual(['What is this?']);
    const statuses = emitted.map((event) => event.btw.status);
    expect(statuses[0]).toBe('forking');
    expect(statuses).toContain('ready');
    const last = emitted.at(-1);
    expect(last?.sessionId).toBe('main-1');
    expect(last?.btw.entries).toEqual([
      {
        id: 'btw-1',
        question: 'What is this?',
        answer: 'Hello side',
        state: 'done',
        message: null,
      },
    ]);
  });

  it('stops a streaming answer and keeps the partial text as done', async () => {
    // The interrupted turn ends with an error-shaped terminal event
    // (cancelled result); a user-initiated stop must not style it as
    // a failure.
    sidecar.respondWith([
      { kind: 'delta', text: 'Partial ' },
      { kind: 'delta', text: 'answer' },
      { kind: 'error', message: 'cancelled' },
    ]);
    sidecar.holdAfterDeltas = true;
    const card = createCard();
    const ask = card.handleAsk('/repo', 'main-1', 'q');
    // Let the deltas land, then stop mid-stream.
    await vi.advanceTimersByTimeAsync(60);
    card.handleStop('main-1');
    await ask;

    expect(sidecar.interrupts).toBe(1);
    expect(emitted.at(-1)?.btw.entries).toEqual([
      {
        id: 'btw-1',
        question: 'q',
        answer: 'Partial answer',
        state: 'done',
        message: null,
      },
    ]);
  });

  it('ignores stop for unbound sessions and idle cards', async () => {
    const card = createCard();
    card.handleStop('main-1');
    await card.handleAsk('/repo', 'main-1', 'q');
    card.handleStop('other-session');
    card.handleStop('main-1');
    expect(sidecar.interrupts).toBe(0);
  });

  it('coalesces streaming deltas instead of emitting per token', async () => {
    sidecar.respondWith([
      { kind: 'delta', text: 'a' },
      { kind: 'delta', text: 'b' },
      { kind: 'delta', text: 'c' },
      { kind: 'done' },
    ]);
    const card = createCard();
    await card.handleAsk('/repo', 'main-1', 'q');

    // forking + ready + question + done are urgent; the three deltas
    // fold into the final done emit because it flushes the timer.
    const streamingEmits = emitted.filter((event) =>
      event.btw.entries.some((entry) => entry.state === 'streaming'),
    );
    expect(streamingEmits.length).toBeLessThanOrEqual(2);
    expect(emitted.at(-1)?.btw.entries[0]?.answer).toBe('abc');
  });

  it('reuses the fork for follow-ups and appends entries', async () => {
    sidecar.respondWith(
      [{ kind: 'delta', text: 'first' }, { kind: 'done' }],
      [{ kind: 'delta', text: 'second' }, { kind: 'done' }],
    );
    const card = createCard();
    await card.handleAsk('/repo', 'main-1', 'one');
    await card.handleAsk('/repo', 'main-1', 'two');

    expect(factoryCalls).toHaveLength(1);
    const entries = emitted.at(-1)?.btw.entries;
    expect(entries?.map((entry) => entry.answer)).toEqual(['first', 'second']);
  });

  it('keeps one pending follow-up and auto-sends the latest after settle', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queuedSidecar: BtwSideChatSidecar = {
      async *ask(text: string) {
        sidecar.asked.push(text);
        if (text === 'one') {
          await gate;
        }
        yield { kind: 'done' } as const;
      },
      dispose: async () => undefined,
    };
    const card = new BtwSideChat(
      async () => queuedSidecar,
      (sessionId, btw) => {
        emitted.push({ sessionId, btw });
      },
    );

    const first = card.handleAsk('/repo', 'main-1', 'one');
    await vi.waitFor(() => {
      expect(sidecar.asked).toEqual(['one']);
    });
    await card.handleAsk('/repo', 'main-1', 'two');
    await card.handleAsk('/repo', 'main-1', 'replacement');
    expect(emitted.at(-1)?.btw.pendingQuestion).toBe('replacement');

    release();
    await first;

    expect(sidecar.asked).toEqual(['one', 'replacement']);
    expect(emitted.at(-1)?.btw.pendingQuestion).toBeNull();
    expect(emitted.at(-1)?.btw.entries.map((entry) => entry.question)).toEqual([
      'one',
      'replacement',
    ]);
  });

  it('auto-sends a pending follow-up after an answer error', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queuedSidecar: BtwSideChatSidecar = {
      async *ask(text: string) {
        sidecar.asked.push(text);
        if (text === 'one') {
          await gate;
          yield { kind: 'error', message: 'failed' } as const;
          return;
        }
        yield { kind: 'done' } as const;
      },
      dispose: async () => undefined,
    };
    const card = new BtwSideChat(
      async () => queuedSidecar,
      (sessionId, btw) => {
        emitted.push({ sessionId, btw });
      },
    );

    const first = card.handleAsk('/repo', 'main-1', 'one');
    await vi.waitFor(() => {
      expect(sidecar.asked).toEqual(['one']);
    });
    await card.handleAsk('/repo', 'main-1', 'two');
    release();
    await first;

    expect(sidecar.asked).toEqual(['one', 'two']);
    expect(emitted.at(-1)?.btw.entries.map((entry) => entry.state)).toEqual([
      'error',
      'done',
    ]);
  });

  it('marks the entry with guidance when the sidecar reports an error', async () => {
    sidecar.respondWith([{ kind: 'error', message: 'Needs permissions.' }]);
    const card = createCard();
    await card.handleAsk('/repo', 'main-1', 'q');

    const entry = emitted.at(-1)?.btw.entries[0];
    expect(entry?.state).toBe('error');
    expect(entry?.message).toBe('Needs permissions.');
    // The card survives one failed entry; a follow-up still works.
    sidecar.respondWith([], [{ kind: 'done' }]);
    await card.handleAsk('/repo', 'main-1', 'again');
    expect(sidecar.asked).toHaveLength(2);
  });

  it('reports a card-level error when the fork cannot start', async () => {
    factoryError = new Error('spawn failed');
    const card = createCard();
    await card.handleAsk('/repo', 'main-1', 'q');

    const last = emitted.at(-1);
    expect(last?.btw.status).toBe('error');
    expect(last?.btw.message).toContain('side chat could not start');
    expect(last?.btw.entries).toEqual([]);
  });

  it('dismiss discards the fork and every entry', async () => {
    sidecar.respondWith([{ kind: 'done' }]);
    const card = createCard();
    await card.handleAsk('/repo', 'main-1', 'q');
    const emitCount = emitted.length;

    card.handleDismiss('main-1');

    expect(sidecar.disposed).toBe(true);
    // Discard is silent: the webview closed the card locally.
    expect(emitted).toHaveLength(emitCount);

    // Reopening after dismiss forks fresh.
    sidecar = new FakeSidecar();
    sidecar.respondWith([{ kind: 'done' }]);
    await card.handleAsk('/repo', 'main-1', 'again');
    expect(factoryCalls).toHaveLength(2);
  });

  it('ignores dismiss for a session it is not bound to', async () => {
    sidecar.respondWith([{ kind: 'done' }]);
    const card = createCard();
    await card.handleAsk('/repo', 'main-1', 'q');

    card.handleDismiss('other-session');

    expect(sidecar.disposed).toBe(false);
  });

  it('reset tears the fork down and stops in-flight streaming', async () => {
    let releaseDelta: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseDelta = resolve;
    });
    const slowSidecar: BtwSideChatSidecar = {
      async *ask() {
        yield { kind: 'delta', text: 'partial' } as const;
        await gate;
        yield { kind: 'done' } as const;
      },
      dispose: vi.fn(async () => undefined),
    };
    const card = new BtwSideChat(
      async () => slowSidecar,
      (sessionId, btw) => {
        emitted.push({ sessionId, btw });
      },
    );
    const askPromise = card.handleAsk('/repo', 'main-1', 'q');
    await vi.waitFor(() => {
      expect(emitted.some((event) => event.btw.entries.length > 0)).toBe(true);
    });

    card.reset();
    releaseDelta();
    await askPromise;

    expect(slowSidecar.dispose).toHaveBeenCalled();
    // Nothing emitted after the teardown: the card is gone.
    const last = emitted.at(-1);
    expect(last?.btw.entries.every((entry) => entry.state === 'streaming')).toBe(true);
  });

  it('clears the pending follow-up on dismiss', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slowSidecar: BtwSideChatSidecar = {
      async *ask(text: string) {
        sidecar.asked.push(text);
        await gate;
        yield { kind: 'done' } as const;
      },
      dispose: async () => {
        release();
      },
    };
    const card = new BtwSideChat(
      async () => slowSidecar,
      (sessionId, btw) => {
        emitted.push({ sessionId, btw });
      },
    );
    const first = card.handleAsk('/repo', 'main-1', 'one');
    await vi.waitFor(() => {
      expect(sidecar.asked).toEqual(['one']);
    });
    await card.handleAsk('/repo', 'main-1', 'two');

    card.handleDismiss('main-1');
    await first;

    expect(sidecar.asked).toEqual(['one']);
  });

  it('clears the pending follow-up when the current answer is stopped', async () => {
    sidecar.respondWith(
      [
        { kind: 'delta', text: 'partial' },
        { kind: 'error', message: 'cancelled' },
      ],
      [{ kind: 'done' }],
    );
    sidecar.holdAfterDeltas = true;
    const card = createCard();
    const first = card.handleAsk('/repo', 'main-1', 'one');
    await vi.advanceTimersByTimeAsync(60);
    await card.handleAsk('/repo', 'main-1', 'two');
    expect(emitted.at(-1)?.btw.pendingQuestion).toBe('two');

    card.handleStop('main-1');
    await first;

    expect(sidecar.asked).toEqual(['one']);
    expect(emitted.at(-1)?.btw.pendingQuestion).toBeNull();
  });

  it('rebinds onto a fresh fork when the main session changed', async () => {
    sidecar.respondWith([{ kind: 'done' }]);
    const card = createCard();
    await card.handleAsk('/repo', 'main-1', 'q');
    const firstSidecar = sidecar;

    sidecar = new FakeSidecar();
    sidecar.respondWith([{ kind: 'done' }]);
    await card.handleAsk('/repo', 'main-2', 'q2');

    expect(firstSidecar.disposed).toBe(true);
    expect(factoryCalls).toEqual([
      { cwd: '/repo', mainSessionId: 'main-1' },
      { cwd: '/repo', mainSessionId: 'main-2' },
    ]);
    expect(emitted.at(-1)?.sessionId).toBe('main-2');
  });

  it('does not start overlapping asks concurrently', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slowSidecar: BtwSideChatSidecar = {
      async *ask() {
        await gate;
        yield { kind: 'done' } as const;
      },
      dispose: async () => undefined,
    };
    let asks = 0;
    const countingSidecar: BtwSideChatSidecar = {
      ask(text: string) {
        asks += 1;
        return slowSidecar.ask(text);
      },
      dispose: async () => undefined,
    };
    const card = new BtwSideChat(
      async () => countingSidecar,
      () => {},
    );
    const first = card.handleAsk('/repo', 'main-1', 'one');
    await Promise.resolve();
    const second = card.handleAsk('/repo', 'main-1', 'two');
    release();
    await Promise.all([first, second]);

    expect(asks).toBe(2);
  });
});
