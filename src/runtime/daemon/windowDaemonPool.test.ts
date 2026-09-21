import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DaemonNotification, DaemonSessionHandle } from './api';
import { WindowDaemonPool } from './windowDaemonPool';
import { createRoutedDaemon } from './routedDaemon';

const fake = vi.hoisted(() => ({
  records: [] as Array<Record<string, unknown>>,
  opened: [] as Array<Record<string, unknown>>,
  openedByUrl: new Map<string, Array<Record<string, unknown>>>(),
  messages: [] as Array<Record<string, unknown>>,
  terminals: [] as Array<Record<string, unknown>>,
  spawn: vi.fn(),
  close: vi.fn(),
  detach: vi.fn(async () => {}),
  resume: vi.fn(),
  stream: vi.fn(),
  wait: vi.fn(async () => {}),
  resetRoot: vi.fn(),
  stop: vi.fn(async () => {}),
  count: 0,
  relays: 0,
  failedRelay: 0,
}));

vi.mock('../ide/nativeIdeRelay', () => ({
  createNativeIdeRelay: vi.fn(async ({ sessionId }: { sessionId: string }) => {
    const index = ++fake.relays;
    return {
      port: 45000 + index,
      sessionId,
      read: () => ({ status: 'connected', message: 'Native handshake complete' }),
      subscribe: () => () => {},
      waitUntilReady: fake.wait,
      requiresSessionRestart: () => index === fake.failedRelay,
      resetForSessionRestart: fake.resetRoot,
      dispose: async () => {},
    };
  }),
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
        listOpened: async () => url.endsWith(':43000') ? fake.opened : fake.openedByUrl.get(url) ?? [],
        getMessages: async () => fake.messages,
        resume: fake.resume,
      },
      terminals: { list: async () => url.endsWith(':43000') ? fake.terminals : [] },
      notifications: { subscribe: () => () => {}, subscribeTerminal: () => () => {} },
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
  fake.openedByUrl.clear();
  fake.messages = [];
  fake.terminals = [];
  fake.count = 0;
  fake.relays = 0;
  fake.failedRelay = 0;
  fake.wait.mockImplementation(async () => {});
  fake.close.mockImplementation(async () => {});
  fake.stream.mockImplementation(async function* () { yield { type: 'assistant', text: 'continued' }; });
  fake.resume.mockImplementation(async (id: string) => ({
    id, close: fake.close, detach: fake.detach, stream: fake.stream,
    ensureLoaded: async () => {},
  }));
  fake.spawn.mockImplementation(async () => {
    const port = 46000 + 2 * ++fake.count;
    return { port, pid: port + 1, url: `ws://127.0.0.1:${port}`, listenerVerified: true };
  });
});

describe('dedicated chat daemon ownership', () => {
  it.each(['disconnected', 'error'] as const)('repairs a %s IDE on the same owner and waits for its replacement before continuing', async status => {
    const value = pool();
    const routed = createRoutedDaemon(value);
    const source = await value.allocate('root-chat');
    await value.remember('root-chat', source);
    const sourceUrl = `ws://127.0.0.1:${source.record.port}`;
    fake.openedByUrl.set(sourceUrl, [{ id: 'root-chat', workingState: 'idle' }]);
    fake.messages = [{ role: 'user', content: [{ type: 'text', text: 'retained prompt' }] }];
    fake.close.mockImplementation(async () => { fake.openedByUrl.set(sourceUrl, []); });
    vi.spyOn(source.ide!, 'requiresSessionRestart').mockReturnValue(true);
    vi.spyOn(source.ide!, 'read').mockReturnValue({ status, message: 'IDE transport lost' });
    expect(value.needsReconnect('root-chat')).toBe(false);
    let ready!: () => void;
    fake.wait.mockImplementation(() => new Promise<void>(resolve => { ready = resolve; }));
    let restored = false;
    const pending = routed.sessions.resume('root-chat').then(handle => { restored = true; return handle; });
    await vi.waitFor(() => expect(fake.wait).toHaveBeenCalledOnce());
    expect(restored).toBe(false);
    expect(fake.close).toHaveBeenCalledOnce();
    expect(fake.stream).not.toHaveBeenCalled();
    expect(fake.resume.mock.calls.map(call => call[0])).toEqual(['root-chat', 'root-chat']);
    expect((await value.forSession('root-chat')).record.id).not.toBe(source.record.id);
    ready();
    const handle = await pending;
    fake.wait.mockImplementation(async () => {});
    const messages = handle.stream('continue once');
    await messages.next();
    await messages.next();
    expect(fake.stream).toHaveBeenCalledExactlyOnceWith('continue once', { includePartialMessages: false });
    routed.disconnect();
    await value.dispose();
  });

  it('keeps a running root on its original worker despite a disconnected IDE', async () => {
    const value = pool();
    const routed = createRoutedDaemon(value);
    const source = await value.allocate('root-chat');
    await value.remember('root-chat', source);
    fake.openedByUrl.set(`ws://127.0.0.1:${source.record.port}`, [{ id: 'root-chat', workingState: 'working' }]);
    vi.spyOn(source.ide!, 'requiresSessionRestart').mockReturnValue(true);
    await routed.sessions.resume('root-chat');
    expect(fake.close).not.toHaveBeenCalled();
    expect(fake.wait).not.toHaveBeenCalled();
    expect(await value.forSession('root-chat')).toBe(source);
    routed.disconnect();
    await value.dispose();
  });

  it.each([false, true])('reports a failed replacement handshake without sending, already failed before wait=%s', async failedBeforeWait => {
    const value = pool();
    const routed = createRoutedDaemon(value);
    const source = await value.allocate('root-chat');
    await value.remember('root-chat', source);
    const sourceUrl = `ws://127.0.0.1:${source.record.port}`;
    fake.openedByUrl.set(sourceUrl, [{ id: 'root-chat', workingState: 'idle' }]);
    fake.messages = [{ role: 'user', content: [{ type: 'text', text: 'retained prompt' }] }];
    fake.close.mockImplementation(async () => { fake.openedByUrl.set(sourceUrl, []); });
    vi.spyOn(source.ide!, 'requiresSessionRestart').mockReturnValue(true);
    if (failedBeforeWait) fake.failedRelay = 2;
    fake.wait.mockRejectedValueOnce(new Error('Handshake failed'));
    await expect(routed.sessions.resume('root-chat')).rejects.toThrow('Handshake failed');
    expect(fake.detach).toHaveBeenCalledOnce();
    expect(fake.stream).not.toHaveBeenCalled();
    routed.disconnect();
    await value.dispose();
  });

  it('waits for an idle worker reload without needlessly moving its healthy relay', async () => {
    const value = pool();
    const routed = createRoutedDaemon(value);
    const source = await value.allocate('root-chat');
    await value.remember('root-chat', source);
    vi.spyOn(source.ide!, 'read').mockReturnValue({ status: 'disconnected', message: 'Idle worker released' });
    await routed.sessions.resume('root-chat');
    expect(fake.close).not.toHaveBeenCalled();
    expect(fake.spawn).toHaveBeenCalledOnce();
    expect(fake.wait).toHaveBeenCalledOnce();
    routed.disconnect();
    await value.dispose();
  });

  it('releases root IDE identity only for inactivity on the current owning root session', async () => {
    const value = pool();
    const first = await value.allocate('first-chat');
    const second = await value.allocate('second-chat');
    await value.remember('first-chat', first);
    type Inactive = Extract<DaemonNotification['notification'], { type: 'session_inactivity' }>;
    // The SDK exposes this notification type but does not export its enum value.
    const inactive: Inactive = { type: 'session_inactivity' as Inactive['type'],
      message: 'Idle', timestamp: Date.now(), timeoutSeconds: 1800 };
    expect(value.observeSession('first-chat', second, inactive)).toBe(false);
    value.observeSession('child-chat', first, inactive);
    expect(fake.resetRoot).not.toHaveBeenCalled();
    value.observeSession('first-chat', first, inactive);
    expect(fake.resetRoot).toHaveBeenCalledOnce();
    expect(await value.forSession('first-chat')).toBe(first);
    expect(fake.close).not.toHaveBeenCalled();
    expect(fake.spawn).toHaveBeenCalledTimes(2);
    await value.dispose();
  });

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
