import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DaemonSessionHandle } from './api';
import { WindowDaemonPool } from './windowDaemonPool';

const fake = vi.hoisted(() => ({
  records: [] as Array<Record<string, unknown>>,
  opened: [] as Array<Record<string, unknown>>,
  messages: [] as Array<Record<string, unknown>>,
  terminals: [] as Array<Record<string, unknown>>,
  spawn: vi.fn(),
  close: vi.fn(),
  wait: vi.fn(async () => {}),
  stop: vi.fn(async () => {}),
  count: 0,
  relays: 0,
}));

vi.mock('../ide/nativeIdeRelay', () => ({
  createNativeIdeRelay: vi.fn(async ({ sessionId }: { sessionId: string }) => ({
    port: 45000 + ++fake.relays,
    sessionId,
    read: () => ({ status: 'connected', message: 'Native handshake complete' }),
    subscribe: () => () => {},
    waitUntilReady: fake.wait,
    dispose: async () => {},
  })),
}));
vi.mock('./daemonLifecycle', () => ({
  startDetachedDaemon: fake.spawn,
  resolveDaemonListenerPid: async (port: number) => port === 43000 ? 43001 : port + 1,
  stopDaemon: fake.stop,
}));
vi.mock('./windowDaemonRegistry', () => ({
  listWindowDaemons: async () => fake.records,
  readSessionDaemon: async () => 'legacy-owner',
  writeSessionDaemon: async () => {},
  writeWindowDaemon: async () => {},
  removeWindowDaemon: async () => {},
  windowDaemonUrl: (record: { port: number }) => `ws://127.0.0.1:${record.port}`,
}));
vi.mock('./daemonConnection', () => ({
  openDaemonConnection: async ({ url }: { url: string }) => ({
    status: () => 'connected',
    dispose: () => {},
    droid: {
      sessions: {
        listOpened: async () => url.endsWith(':43000') ? fake.opened : [],
        getMessages: async () => fake.messages,
      },
      terminals: { list: async () => url.endsWith(':43000') ? fake.terminals : [] },
    },
  }),
}));

function pool() {
  return new WindowDaemonPool({
    prepare: async () => ({ cwd: 'C:/workspace', port: 44000, detail: null }),
    record: () => {},
  });
}

async function original(value: WindowDaemonPool, workingState: string) {
  fake.records = [{
    id: 'legacy-owner', pid: 43001, port: 43000,
    ownerPid: 1, cwd: 'C:/workspace', idePort: 44000,
  }];
  fake.opened = [{ id: 'old-chat', workingState }];
  // Preparing a fresh channel also establishes the current window binding.
  await value.allocate('other-chat', 'C:/workspace');
  const entry = await value.forSession('old-chat', true);
  await value.remember('old-chat', entry, { close: fake.close } as unknown as DaemonSessionHandle);
  return entry;
}

beforeEach(() => {
  vi.clearAllMocks();
  fake.records = [];
  fake.opened = [];
  fake.messages = [];
  fake.terminals = [];
  fake.count = 0;
  fake.relays = 0;
  fake.spawn.mockImplementation(async () => {
    const port = 46000 + 2 * ++fake.count;
    return { port, pid: port + 1, url: `ws://127.0.0.1:${port}`, listenerVerified: true };
  });
});

describe('dedicated chat daemon ownership', () => {
  it('allocates a distinct IDE relay and daemon for each root chat', async () => {
    const value = pool();
    const first = await value.allocate('first-chat', 'C:/first');
    const second = await value.allocate('second-chat', 'C:/second');
    expect(first.record.rootSessionId).toBe('first-chat');
    expect(second.record.rootSessionId).toBe('second-chat');
    expect(first.record.port).not.toBe(second.record.port);
    expect(first.ide?.port).not.toBe(second.ide?.port);
    expect(fake.spawn.mock.calls[0]![0].env.FACTORY_VSCODE_MCP_PORT).toBe(String(first.ide?.port));
    expect(fake.spawn.mock.calls[1]![0].env.FACTORY_VSCODE_MCP_PORT).toBe(String(second.ide?.port));
    await value.dispose();
  });

  it('does not move or close a running chat on a legacy backend', async () => {
    const value = pool();
    const entry = await original(value, 'working');
    expect(await value.rebindIdleAttachment('old-chat', entry)).toBe(entry);
    expect(value.readIde('old-chat').status).toBe('reconnect-required');
    expect(fake.close).not.toHaveBeenCalled();
    expect(fake.spawn).toHaveBeenCalledOnce();
    await value.dispose();
  });

  it('does not delete an empty draft to establish a new IDE connection', async () => {
    const value = pool();
    const entry = await original(value, 'idle');
    expect(await value.rebindIdleAttachment('old-chat', entry)).toBe(entry);
    expect(fake.close).not.toHaveBeenCalled();
    await value.dispose();
  });

  it('rechecks activity before closing an idle legacy worker for migration', async () => {
    const value = pool();
    const entry = await original(value, 'idle');
    fake.messages = [{ role: 'user', content: [{ type: 'text', text: 'retained user prompt' }] }];
    fake.spawn.mockImplementationOnce(async () => {
      fake.opened = [{ id: 'old-chat', workingState: 'working' }];
      return { port: 47000, pid: 47001, url: 'ws://127.0.0.1:47000', listenerVerified: true };
    });
    await expect(value.rebindIdleAttachment('old-chat', entry)).rejects.toThrow('became active');
    expect(fake.close).not.toHaveBeenCalled();
    await value.dispose();
  });

  it.each(['child', 'terminal', 'empty-draft'] as const)('defers automatic migration without closing the source when blocked by %s', async reason => {
    const value = pool();
    await original(value, 'idle');
    fake.messages = reason === 'empty-draft' ? [] : [{ role: 'user', content: [{ type: 'text', text: 'retained prompt' }] }];
    if (reason === 'child') fake.opened.push({ id: 'child', parentSessionId: 'old-chat', workingState: 'working' });
    if (reason === 'terminal') fake.terminals.push({ id: 'managed-terminal' });
    const closing = vi.fn();
    expect(await value.reconnectIdle('old-chat', () => true, closing, true)).toBe(false);
    expect(closing).not.toHaveBeenCalled();
    expect(fake.close).not.toHaveBeenCalled();
    expect(fake.spawn).toHaveBeenCalledOnce();
    expect(value.readIde('old-chat').status).toBe('reconnect-required');
    await value.dispose();
  });

  it.each(['child', 'terminal'] as const)('rechecks a newly started %s after allocating the replacement and preserves the source', async reason => {
    const value = pool();
    await original(value, 'idle');
    fake.messages = [{ role: 'user', content: [{ type: 'text', text: 'retained prompt' }] }];
    fake.spawn.mockImplementationOnce(async () => {
      if (reason === 'child') fake.opened.push({ id: 'child', parentSessionId: 'old-chat', workingState: 'working' });
      else fake.terminals.push({ id: 'managed-terminal' });
      return { port: 47000, pid: 47001, url: 'ws://127.0.0.1:47000', listenerVerified: true };
    });
    const closing = vi.fn();
    expect(await value.reconnectIdle('old-chat', () => true, closing, true)).toBe(false);
    expect(closing).not.toHaveBeenCalled();
    expect(fake.close).not.toHaveBeenCalled();
    expect(fake.stop).toHaveBeenCalledWith({ url: 'ws://127.0.0.1:47000', pid: 47001 });
    expect(value.readIde('old-chat').status).toBe('reconnect-required');
    await value.dispose();
  });
});
