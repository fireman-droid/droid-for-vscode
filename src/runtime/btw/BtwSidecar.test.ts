import { describe, expect, it } from 'vitest';

import {
  BTW_FORK_TAG,
  BTW_FORK_TITLE,
  BTW_PERMISSION_GUIDANCE,
  createBtwSidecar,
  type BtwAnswerEvent,
  type BtwSidecarClient,
} from './BtwSidecar';

type NotificationCallback = (
  notification: Record<string, unknown>,
) => void;

class FakeBtwClient implements BtwSidecarClient {
  readonly calls: string[] = [];

  readonly loadedSessionIds: string[] = [];

  readonly askedTexts: string[] = [];

  forkParams: {
    title?: string;
    tags?: { name: string }[];
  } | null = null;

  forkResponse: unknown = {
    result: { newSessionId: 'fork-1' },
  };

  permissionHandler: (() => { outcome: 'cancel' }) | null = null;

  private notificationCallbacks = new Set<NotificationCallback>();

  private errorCallbacks = new Set<(error: Error) => void>();

  async loadSession(params: { sessionId: string }): Promise<unknown> {
    this.calls.push(`loadSession:${params.sessionId}`);
    this.loadedSessionIds.push(params.sessionId);
    return {};
  }

  async forkSession(params: {
    title?: string;
    tags?: { name: string }[];
  }): Promise<unknown> {
    this.calls.push('forkSession');
    this.forkParams = params;
    return this.forkResponse;
  }

  async addUserMessage(params: { text: string }): Promise<unknown> {
    this.calls.push('addUserMessage');
    this.askedTexts.push(params.text);
    return {};
  }

  onNotification(callback: NotificationCallback): () => void {
    this.notificationCallbacks.add(callback);
    return () => this.notificationCallbacks.delete(callback);
  }

  onError(callback: (error: Error) => void): () => void {
    this.errorCallbacks.add(callback);
    return () => this.errorCallbacks.delete(callback);
  }

  setPermissionHandler(
    handler: () => { outcome: 'cancel' },
  ): void {
    this.permissionHandler = handler;
  }

  async closeSession(): Promise<unknown> {
    this.calls.push('closeSession');
    return {};
  }

  async close(): Promise<void> {
    this.calls.push('close');
  }

  emit(sessionId: string, notification: Record<string, unknown>): void {
    for (const callback of this.notificationCallbacks) {
      callback({ params: { sessionId, notification } });
    }
  }

  emitError(): void {
    for (const callback of this.errorCallbacks) {
      callback(new Error('boom'));
    }
  }
}

async function createFixture(): Promise<{
  client: FakeBtwClient;
  sidecar: Awaited<ReturnType<typeof createBtwSidecar>>;
}> {
  const client = new FakeBtwClient();
  const sidecar = await createBtwSidecar({
    cwd: 'C:/workspace',
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

describe('createBtwSidecar', () => {
  it('loads the main session, forks with the btw tag, loads the fork', async () => {
    const { client, sidecar } = await createFixture();
    expect(sidecar.forkSessionId).toBe('fork-1');
    expect(client.calls).toEqual([
      'loadSession:main-1',
      'forkSession',
      'loadSession:fork-1',
    ]);
    expect(client.forkParams).toEqual({
      title: BTW_FORK_TITLE,
      tags: [{ name: BTW_FORK_TAG }],
    });
    expect(client.permissionHandler).not.toBeNull();
  });

  it('closes the client when the fork response is invalid', async () => {
    const client = new FakeBtwClient();
    client.forkResponse = { result: {} };
    await expect(
      createBtwSidecar({
        cwd: 'C:/workspace',
        mainSessionId: 'main-1',
        createClient: async () => client,
      }),
    ).rejects.toThrow('invalid fork response');
    expect(client.calls).toContain('close');
  });
});

describe('BtwSidecar.ask', () => {
  it('streams deltas then done', async () => {
    const { client, sidecar } = await createFixture();
    const asking = collect(sidecar.ask('What is this error?'));
    await Promise.resolve();
    client.emit('fork-1', {
      type: 'assistant_text_delta',
      textDelta: 'ZEBRA',
    });
    client.emit('fork-1', {
      type: 'assistant_text_delta',
      textDelta: '-42',
    });
    client.emit('fork-1', {
      type: 'agent_turn_completed',
      reason: 'completed',
    });
    expect(await asking).toEqual([
      { kind: 'delta', text: 'ZEBRA' },
      { kind: 'delta', text: '-42' },
      { kind: 'done' },
    ]);
    expect(client.askedTexts).toEqual(['What is this error?']);
  });

  it('ignores other-session and non-answer notifications', async () => {
    const { client, sidecar } = await createFixture();
    const asking = collect(sidecar.ask('q'));
    await Promise.resolve();
    client.emit('other-session', {
      type: 'assistant_text_delta',
      textDelta: 'leak',
    });
    client.emit('fork-1', { type: 'tool_call' });
    client.emit('fork-1', { type: 'assistant_text_delta', textDelta: 'ok' });
    client.emit('fork-1', { type: 'agent_turn_completed' });
    expect(await asking).toEqual([
      { kind: 'delta', text: 'ok' },
      { kind: 'done' },
    ]);
  });

  it('errors the entry with guidance after a denied permission', async () => {
    const { client, sidecar } = await createFixture();
    const asking = collect(sidecar.ask('write a file'));
    await Promise.resolve();
    expect(client.permissionHandler?.()).toEqual({ outcome: 'cancel' });
    client.emit('fork-1', { type: 'agent_turn_completed' });
    expect(await asking).toEqual([
      { kind: 'error', message: BTW_PERMISSION_GUIDANCE },
    ]);
  });

  it('resets the permission flag between questions', async () => {
    const { client, sidecar } = await createFixture();
    const first = collect(sidecar.ask('write a file'));
    await Promise.resolve();
    client.permissionHandler?.();
    client.emit('fork-1', { type: 'agent_turn_completed' });
    expect((await first)[0]?.kind).toBe('error');

    const second = collect(sidecar.ask('plain question'));
    await Promise.resolve();
    client.emit('fork-1', { type: 'agent_turn_completed' });
    expect(await second).toEqual([{ kind: 'done' }]);
  });

  it('maps error notifications and client errors to error events', async () => {
    const { client, sidecar } = await createFixture();
    const first = collect(sidecar.ask('q'));
    await Promise.resolve();
    client.emit('fork-1', { type: 'error' });
    expect((await first)[0]?.kind).toBe('error');

    const second = collect(sidecar.ask('q2'));
    await Promise.resolve();
    client.emitError();
    expect(await second).toEqual([
      { kind: 'error', message: 'Side chat connection failed.' },
    ]);
  });

  it('rejects a second question while one is streaming', async () => {
    const { client, sidecar } = await createFixture();
    const asking = collect(sidecar.ask('first'));
    await Promise.resolve();
    await expect(collect(sidecar.ask('second'))).rejects.toThrow(
      'already streaming',
    );
    client.emit('fork-1', { type: 'agent_turn_completed' });
    await asking;
  });
});

describe('BtwSidecar.dispose', () => {
  it('closes the fork session and the transport once', async () => {
    const { client, sidecar } = await createFixture();
    await sidecar.dispose();
    await sidecar.dispose();
    expect(
      client.calls.filter((call) => call === 'closeSession'),
    ).toHaveLength(1);
    expect(client.calls.filter((call) => call === 'close')).toHaveLength(
      1,
    );
  });

  it('ends an in-flight ask without a terminal event', async () => {
    const { sidecar } = await createFixture();
    const asking = collect(sidecar.ask('q'));
    await Promise.resolve();
    await sidecar.dispose();
    expect(await asking).toEqual([]);
  });

  it('rejects questions after disposal', async () => {
    const { sidecar } = await createFixture();
    await sidecar.dispose();
    await expect(collect(sidecar.ask('q'))).rejects.toThrow('disposed');
  });
});
