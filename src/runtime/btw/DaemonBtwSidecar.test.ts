import { describe, expect, it } from 'vitest';

import {
  BTW_FORK_TAG,
  BTW_FORK_TITLE,
  BTW_PERMISSION_GUIDANCE,
  type BtwAnswerEvent,
} from './BtwSidecar';
import {
  createDaemonBtwSidecar,
  type DaemonBtwClient,
  type DaemonBtwFork,
  type DaemonBtwStreamEvent,
} from './DaemonBtwSidecar';

/** Hand-pumped stream: the test pushes events, the sidecar pulls. */
class FakeStream {
  private readonly queue: DaemonBtwStreamEvent[] = [];
  private wake: (() => void) | null = null;
  private ended = false;
  private failure: Error | null = null;

  push(event: DaemonBtwStreamEvent): void {
    this.queue.push(event);
    this.wake?.();
    this.wake = null;
  }

  end(): void {
    this.ended = true;
    this.wake?.();
    this.wake = null;
  }

  fail(error: Error): void {
    this.failure = error;
    this.wake?.();
    this.wake = null;
  }

  async *events(): AsyncGenerator<DaemonBtwStreamEvent, void> {
    for (;;) {
      const event = this.queue.shift();
      if (event !== undefined) {
        yield event;
        continue;
      }
      if (this.failure !== null) {
        throw this.failure;
      }
      if (this.ended) {
        return;
      }
      await new Promise<void>((resolve) => {
        this.wake = resolve;
      });
    }
  }
}

class FakeDaemonBtwClient implements DaemonBtwClient {
  readonly calls: string[] = [];
  readonly askedTexts: string[] = [];
  forkParams: {
    title: string;
    tags: readonly { readonly name: string }[];
  } | null = null;
  forkResponse: unknown = { newSessionId: 'fork-1' };
  onPermissionDenied: (() => void) | null = null;
  /** One fresh stream per ask, exposed for the test to drive. */
  streams: FakeStream[] = [];

  async fork(
    mainSessionId: string,
    params: {
      title: string;
      tags: readonly { readonly name: string }[];
    },
  ): Promise<unknown> {
    this.calls.push(`fork:${mainSessionId}`);
    this.forkParams = params;
    return this.forkResponse;
  }

  async attach(
    forkSessionId: string,
    onPermissionDenied: () => void,
  ): Promise<DaemonBtwFork> {
    this.calls.push(`attach:${forkSessionId}`);
    this.onPermissionDenied = onPermissionDenied;
    return {
      stream: (text) => {
        this.askedTexts.push(text);
        const stream = new FakeStream();
        this.streams.push(stream);
        return stream.events();
      },
      interrupt: async () => {
        this.calls.push('interrupt');
      },
      close: async () => {
        this.calls.push('close');
      },
    };
  }
}

async function createFixture(): Promise<{
  client: FakeDaemonBtwClient;
  sidecar: Awaited<ReturnType<typeof createDaemonBtwSidecar>>;
}> {
  const client = new FakeDaemonBtwClient();
  const sidecar = await createDaemonBtwSidecar({
    mainSessionId: 'main-1',
    createClient: async () => client,
  });
  return { client, sidecar };
}

async function collect(
  events: AsyncGenerator<BtwAnswerEvent, void>,
): Promise<BtwAnswerEvent[]> {
  const collected: BtwAnswerEvent[] = [];
  for await (const event of events) {
    collected.push(event);
  }
  return collected;
}

/** Yields until the sidecar's ask loop is parked on the stream. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await Promise.resolve();
  }
}

describe('createDaemonBtwSidecar', () => {
  it('forks with the btw tag and attaches to the fork', async () => {
    const { client, sidecar } = await createFixture();
    expect(sidecar.forkSessionId).toBe('fork-1');
    expect(client.calls).toEqual(['fork:main-1', 'attach:fork-1']);
    expect(client.forkParams).toEqual({
      title: BTW_FORK_TITLE,
      tags: [{ name: BTW_FORK_TAG }],
    });
    expect(client.onPermissionDenied).not.toBeNull();
  });

  it('rejects when the fork response is invalid', async () => {
    const client = new FakeDaemonBtwClient();
    client.forkResponse = {};
    await expect(
      createDaemonBtwSidecar({
        mainSessionId: 'main-1',
        createClient: async () => client,
      }),
    ).rejects.toThrow('invalid fork response');
    expect(client.calls).toEqual(['fork:main-1']);
  });
});

describe('DaemonBtwSidecar.ask', () => {
  it('streams deltas then done on a successful result', async () => {
    const { client, sidecar } = await createFixture();
    const asking = collect(sidecar.ask('What is this error?'));
    await settle();
    const stream = client.streams[0];
    stream.push({ type: 'assistant_text_delta', text: 'ZEBRA' });
    stream.push({ type: 'assistant_text_delta', text: '-77' });
    stream.push({ type: 'result', subtype: 'success' });
    expect(await asking).toEqual([
      { kind: 'delta', text: 'ZEBRA' },
      { kind: 'delta', text: '-77' },
      { kind: 'done' },
    ]);
    expect(client.askedTexts).toEqual(['What is this error?']);
  });

  it('ignores non-answer stream events', async () => {
    const { client, sidecar } = await createFixture();
    const asking = collect(sidecar.ask('q'));
    await settle();
    const stream = client.streams[0];
    stream.push({ type: 'tool_call' });
    stream.push({ type: 'assistant_text_delta', text: '' });
    stream.push({ type: 'assistant_text_delta', text: 'ok' });
    stream.push({ type: 'result', subtype: 'success' });
    expect(await asking).toEqual([
      { kind: 'delta', text: 'ok' },
      { kind: 'done' },
    ]);
  });

  it('errors the entry with guidance after a denied permission', async () => {
    const { client, sidecar } = await createFixture();
    const asking = collect(sidecar.ask('write a file'));
    await settle();
    client.onPermissionDenied?.();
    client.streams[0].push({ type: 'result', subtype: 'success' });
    expect(await asking).toEqual([
      { kind: 'error', message: BTW_PERMISSION_GUIDANCE },
    ]);
  });

  it('resets the permission flag between questions', async () => {
    const { client, sidecar } = await createFixture();
    const first = collect(sidecar.ask('write a file'));
    await settle();
    client.onPermissionDenied?.();
    client.streams[0].push({ type: 'result', subtype: 'success' });
    expect((await first)[0]?.kind).toBe('error');

    const second = collect(sidecar.ask('plain question'));
    await settle();
    client.streams[1].push({ type: 'result', subtype: 'success' });
    expect(await second).toEqual([{ kind: 'done' }]);
  });

  it('maps error results and error events to error entries', async () => {
    const { client, sidecar } = await createFixture();
    const first = collect(sidecar.ask('q'));
    await settle();
    client.streams[0].push({
      type: 'result',
      subtype: 'error_during_execution',
    });
    expect((await first)[0]?.kind).toBe('error');

    const second = collect(sidecar.ask('q2'));
    await settle();
    client.streams[1].push({ type: 'error' });
    expect((await second)[0]?.kind).toBe('error');
  });

  it('maps a stream failure to a connection error entry', async () => {
    const { client, sidecar } = await createFixture();
    const asking = collect(sidecar.ask('q'));
    await settle();
    client.streams[0].fail(new Error('socket gone'));
    expect(await asking).toEqual([
      { kind: 'error', message: 'Side chat connection failed.' },
    ]);
  });

  it('completes the entry when the stream ends without a result', async () => {
    const { client, sidecar } = await createFixture();
    const asking = collect(sidecar.ask('q'));
    await settle();
    const stream = client.streams[0];
    stream.push({ type: 'assistant_text_delta', text: 'partial' });
    stream.end();
    expect(await asking).toEqual([
      { kind: 'delta', text: 'partial' },
      { kind: 'done' },
    ]);
  });

  it('rejects a second question while one is streaming', async () => {
    const { client, sidecar } = await createFixture();
    const asking = collect(sidecar.ask('first'));
    await settle();
    await expect(collect(sidecar.ask('second'))).rejects.toThrow(
      'already streaming',
    );
    client.streams[0].push({ type: 'result', subtype: 'success' });
    await asking;
  });
});

describe('DaemonBtwSidecar.dispose', () => {
  it('closes the fork session once', async () => {
    const { client, sidecar } = await createFixture();
    await sidecar.dispose();
    await sidecar.dispose();
    expect(client.calls.filter((call) => call === 'close')).toHaveLength(
      1,
    );
  });

  it('ends an in-flight ask without a terminal event', async () => {
    const { client, sidecar } = await createFixture();
    const asking = collect(sidecar.ask('q'));
    await settle();
    await sidecar.dispose();
    client.streams[0].end();
    expect(await asking).toEqual([]);
  });

  it('rejects questions after disposal', async () => {
    const { sidecar } = await createFixture();
    await sidecar.dispose();
    await expect(collect(sidecar.ask('q'))).rejects.toThrow('disposed');
  });
});
