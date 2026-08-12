import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BtwAnswerEvent } from '../runtime/btw/BtwSidecar';
import type { SessionBtwState } from '../shared/btwProtocol';
import { BtwSideChat, type BtwSideChatSidecar } from './btwSideChat';

class FakeSidecar implements BtwSideChatSidecar {
  readonly asked: string[] = [];
  disposed = false;
  private script: readonly BtwAnswerEvent[][] = [];

  respondWith(...turns: readonly BtwAnswerEvent[][]): void {
    this.script = turns;
  }

  async *ask(text: string): AsyncGenerator<BtwAnswerEvent, void> {
    this.asked.push(text);
    const events = this.script[this.asked.length - 1] ?? [
      { kind: 'done' } as const,
    ];
    for (const event of events) {
      await Promise.resolve();
      yield event;
    }
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

  it('forks lazily, streams one answer, and completes the entry', async () => {
    sidecar.respondWith([
      { kind: 'delta', text: 'Hello' },
      { kind: 'delta', text: ' side' },
      { kind: 'done' },
    ]);
    const card = createCard();
    await card.handleAsk('/repo', 'main-1', 'What is this?');

    expect(factoryCalls).toEqual([
      { cwd: '/repo', mainSessionId: 'main-1' },
    ]);
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
    expect(entries?.map((entry) => entry.answer)).toEqual([
      'first',
      'second',
    ]);
  });

  it('marks the entry with guidance when the sidecar reports an error', async () => {
    sidecar.respondWith([
      { kind: 'error', message: 'Needs permissions.' },
    ]);
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
      expect(
        emitted.some((event) => event.btw.entries.length > 0),
      ).toBe(true);
    });

    card.reset();
    releaseDelta();
    await askPromise;

    expect(slowSidecar.dispose).toHaveBeenCalled();
    // Nothing emitted after the teardown: the card is gone.
    const last = emitted.at(-1);
    expect(
      last?.btw.entries.every((entry) => entry.state === 'streaming'),
    ).toBe(true);
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

  it('drops overlapping asks while one is streaming', async () => {
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

    expect(asks).toBe(1);
  });
});
