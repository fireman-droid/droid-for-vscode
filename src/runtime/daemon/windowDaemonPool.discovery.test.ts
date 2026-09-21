import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WindowDaemonRecord } from './windowDaemonRegistry';
import type { DaemonListenerVerification } from './daemonLifecycle';
import { WindowDaemonPool } from './windowDaemonPool';

const fake = vi.hoisted(() => ({
  records: [] as WindowDaemonRecord[],
  opened: new Map<number, Array<{ id: string; workingState: string }>>(),
  verification: new Map<number, DaemonListenerVerification>(),
  dead: new Set<number>(),
  listRecords: vi.fn(), readOwner: vi.fn(), readRecord: vi.fn(), writeOwner: vi.fn(),
  remove: vi.fn(), verify: vi.fn(), singleVerify: vi.fn(), open: vi.fn(), listOpened: vi.fn(),
  spawn: vi.fn(), stop: vi.fn(), events: vi.fn(),
  verifyDelay: 0, connectDelay: 0, openedDelay: 0,
  activeConnections: 0, maxConnections: 0, activeQueries: 0, maxQueries: 0,
}));

vi.mock('./windowDaemonRegistry', () => ({
  listWindowDaemons: fake.listRecords, readSessionDaemon: fake.readOwner,
  readWindowDaemon: fake.readRecord, writeSessionDaemon: fake.writeOwner,
  writeWindowDaemon: async () => {}, removeWindowDaemon: fake.remove,
  windowDaemonUrl: ({ port }: { port: number }) => `ws://127.0.0.1:${port}`,
}));
vi.mock('./daemonLifecycle', () => ({
  verifyDaemonListeners: fake.verify, resolveDaemonListenerPid: fake.singleVerify,
  startDetachedDaemon: fake.spawn, stopDaemon: fake.stop,
}));
vi.mock('./daemonConnection', () => ({ openDaemonConnection: fake.open }));
vi.mock('../ide/nativeIdeRelay', () => ({ createNativeIdeRelay: vi.fn() }));

const delay = (ms: number) => ms === 0 ? Promise.resolve() : new Promise<void>(resolve => setTimeout(resolve, ms));
const pools: WindowDaemonPool[] = [];

function record(index: number): WindowDaemonRecord {
  return { id: `owner-${index}`, port: 41000 + index, pid: 51000 + index,
    ownerPid: 60000 + index, cwd: `C:/workspace-${index}`, idePort: null,
    rootSessionId: `root-${index}` };
}

function pool(): WindowDaemonPool {
  const value = new WindowDaemonPool({
    prepare: async () => ({ cwd: 'C:/workspace', port: null, detail: null }), record: fake.events,
  });
  pools.push(value);
  return value;
}

beforeEach(() => {
  vi.clearAllMocks();
  fake.records = []; fake.opened.clear(); fake.verification.clear(); fake.dead.clear();
  fake.verifyDelay = 0; fake.connectDelay = 0; fake.openedDelay = 0;
  fake.activeConnections = 0; fake.maxConnections = 0; fake.activeQueries = 0; fake.maxQueries = 0;
  fake.listRecords.mockImplementation(async () => fake.records);
  fake.readOwner.mockResolvedValue(null);
  fake.readRecord.mockImplementation(async (id: string) => fake.records.find(entry => entry.id === id) ?? null);
  fake.writeOwner.mockResolvedValue(undefined); fake.remove.mockResolvedValue(undefined); fake.stop.mockResolvedValue(undefined);
  fake.verify.mockImplementation(async (records: readonly WindowDaemonRecord[]) => {
    await delay(fake.verifyDelay);
    return new Map(records.map(entry => [entry.port,
      fake.verification.get(entry.port) ?? { status: 'verified', pid: entry.pid }]));
  });
  fake.singleVerify.mockImplementation(async (port: number) => {
    await delay(fake.verifyDelay);
    return fake.records.find(entry => entry.port === port)?.pid ?? null;
  });
  fake.listOpened.mockImplementation(async (port: number) => {
    fake.activeQueries++; fake.maxQueries = Math.max(fake.maxQueries, fake.activeQueries);
    try { await delay(fake.openedDelay); return fake.opened.get(port) ?? []; }
    finally { fake.activeQueries--; }
  });
  fake.open.mockImplementation(async ({ url }: { url: string }) => {
    const port = Number(new URL(url).port);
    fake.activeConnections++; fake.maxConnections = Math.max(fake.maxConnections, fake.activeConnections);
    try { await delay(fake.connectDelay); }
    finally { fake.activeConnections--; }
    return { status: () => 'connected', dispose: () => {}, droid: {
      sessions: { listOpened: () => fake.listOpened(port) },
    } };
  });
  fake.spawn.mockImplementation(async () => {
    const port = 46000 + fake.spawn.mock.calls.length;
    return { url: `ws://127.0.0.1:${port}`, port, pid: port + 10000, listenerVerified: true };
  });
  vi.spyOn(process, 'kill').mockImplementation((pid) => {
    if (fake.dead.has(pid)) throw Object.assign(new Error('No such process'), { code: 'ESRCH' });
    return true;
  });
});

afterEach(async () => {
  for (const value of pools.splice(0)) await value.dispose();
  vi.restoreAllMocks();
});

describe('cold daemon owner discovery', () => {
  it('shares one complete 45-daemon scan across concurrent session requests, with at most six probes in flight', async () => {
    fake.records = Array.from({ length: 45 }, (_, index) => record(index));
    fake.connectDelay = 3; fake.openedDelay = 3;
    fake.opened.set(fake.records[42]!.port, [{ id: 'first', workingState: 'idle' }]);
    fake.opened.set(fake.records[44]!.port, [{ id: 'second', workingState: 'idle' }]);
    const value = pool();
    const [first, same, second] = await Promise.all([
      value.forSession('first', true), value.forSession('first', true), value.forSession('second', true),
    ]);
    expect(first).toBe(same);
    expect(first.record.id).toBe('owner-42'); expect(second.record.id).toBe('owner-44');
    expect(fake.listRecords).toHaveBeenCalledOnce(); expect(fake.verify).toHaveBeenCalledOnce();
    expect(fake.verify.mock.calls[0]?.[0]).toHaveLength(45);
    expect(fake.open).toHaveBeenCalledTimes(45); expect(fake.listOpened).toHaveBeenCalledTimes(45);
    expect(fake.maxConnections).toBe(6); expect(fake.maxQueries).toBe(6);
    expect(fake.singleVerify).not.toHaveBeenCalled(); expect(fake.spawn).not.toHaveBeenCalled();
  });

  it('keeps duplicate ownership rejection even when one owner responds first', async () => {
    fake.records = [record(0), record(1), record(2)]; fake.openedDelay = 3;
    fake.opened.set(41000, [{ id: 'chat', workingState: 'idle' }]);
    fake.opened.set(41002, [{ id: 'chat', workingState: 'idle' }]);
    await expect(pool().forSession('chat', true)).rejects.toThrow('multiple daemons');
    expect(fake.spawn).not.toHaveBeenCalled(); expect(fake.writeOwner).not.toHaveBeenCalled();
  });

  it.each(['not-listening', 'unverified'] as const)('does not create a replacement when a live original PID is %s', async status => {
    const original = record(0); fake.records = [original];
    fake.verification.set(original.port, { status });
    await expect(pool().forSession('chat', true)).rejects.toThrow('unavailable');
    expect(fake.spawn).not.toHaveBeenCalled(); expect(fake.open).not.toHaveBeenCalled();
    expect(fake.remove).not.toHaveBeenCalled(); expect(fake.singleVerify).not.toHaveBeenCalled();
  });

  it('rejects a reused port with a different listener identity', async () => {
    const original = record(0); fake.records = [original];
    fake.verification.set(original.port, { status: 'verified', pid: original.pid + 1 });
    await expect(pool().forSession('chat', true)).rejects.toThrow('listener process');
    expect(fake.spawn).not.toHaveBeenCalled(); expect(fake.remove).not.toHaveBeenCalled();
  });

  it('removes only the exact dead record and never stops a discovered process', async () => {
    const dead = record(0), live = record(1); fake.records = [dead, live];
    fake.dead.add(dead.pid); fake.verification.set(dead.port, { status: 'not-listening' });
    fake.opened.set(live.port, [{ id: 'chat', workingState: 'idle' }]);
    expect((await pool().forSession('chat', true)).record.id).toBe(live.id);
    expect(fake.remove).toHaveBeenCalledExactlyOnceWith(dead);
    expect(fake.stop).not.toHaveBeenCalled(); expect(fake.spawn).not.toHaveBeenCalled();
  });

  it('shares discovery between read routing and attachment without sharing their allocation decision', async () => {
    fake.records = [record(0)]; fake.openedDelay = 3;
    const value = pool();
    const [metadata, attached, sameAttachment] = await Promise.all([
      value.forSession('new-chat', false), value.forSession('new-chat', true), value.forSession('new-chat', true),
    ]);
    expect(metadata.record.rootSessionId).toBeUndefined();
    expect(attached.record.rootSessionId).toBe('new-chat'); expect(attached).toBe(sameAttachment);
    expect(metadata.record.id).not.toBe(attached.record.id);
    expect(fake.verify).toHaveBeenCalledOnce(); expect(fake.listOpened).toHaveBeenCalledOnce();
    expect(fake.spawn).toHaveBeenCalledTimes(2);
    expect((await value.forSession('new-chat', true))).toBe(attached);
  });

  it('uses the same bounded discovery for all daemons', async () => {
    fake.records = Array.from({ length: 13 }, (_, index) => record(index)); fake.connectDelay = 3;
    const value = pool();
    const [first, second] = await Promise.all([value.all(), value.all()]);
    expect(first.map(entry => entry.record.id)).toEqual(second.map(entry => entry.record.id));
    expect(first).toHaveLength(14); expect(fake.verify).toHaveBeenCalledOnce();
    // One independent metadata-daemon startup may overlap the six discovery probes.
    expect(fake.maxConnections).toBeLessThanOrEqual(7);
    expect(fake.singleVerify).not.toHaveBeenCalled();
  });

  it('measures 45-daemon batch discovery against the previous serial probe schedule', async () => {
    fake.records = Array.from({ length: 45 }, (_, index) => record(index));
    fake.opened.set(41044, [{ id: 'chat', workingState: 'idle' }]);
    fake.verifyDelay = 80; fake.connectDelay = 25; fake.openedDelay = 15;
    const sequentialStarted = performance.now();
    for (const entry of fake.records) {
      await fake.singleVerify(entry.port);
      const connection = await fake.open({ url: `ws://127.0.0.1:${entry.port}` });
      await connection.droid.sessions.listOpened();
    }
    const sequentialMs = performance.now() - sequentialStarted;
    fake.singleVerify.mockClear(); fake.open.mockClear(); fake.listOpened.mockClear();
    fake.activeConnections = 0; fake.maxConnections = 0; fake.activeQueries = 0; fake.maxQueries = 0;
    const started = performance.now();
    const owner = await pool().forSession('chat', true);
    const batchedMs = performance.now() - started;
    expect(owner.record.id).toBe('owner-44');
    expect(fake.verify).toHaveBeenCalledOnce(); expect(fake.singleVerify).not.toHaveBeenCalled();
    expect(fake.maxConnections).toBe(6); expect(fake.maxQueries).toBe(6);
    expect(batchedMs).toBeLessThan(sequentialMs / 2);
    process.stdout.write(`${JSON.stringify({ kind: 'synthetic-daemon-discovery', records: 45,
      identityDelayMs: 80, connectionDelayMs: 25, openedDelayMs: 15,
      sequentialMs: Math.round(sequentialMs), batchedMs: Math.round(batchedMs),
      maxConnections: fake.maxConnections, maxQueries: fake.maxQueries })}\n`);
  }, 15_000);
});
