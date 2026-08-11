import { describe, expect, it, vi } from 'vitest';

import {
  ensureSharedDaemon,
  readDaemonDiscovery,
  shutdownSharedDaemon,
} from './daemonDiscovery';

const FILE = 'C:\\home\\.droidvisx\\daemon.json';

describe('readDaemonDiscovery', () => {
  it('parses a well-formed record', () => {
    const record = readDaemonDiscovery(FILE, () =>
      JSON.stringify({
        port: 45001,
        pid: 4242,
        version: '0.193.0',
        startedAt: 1754956800000,
      }),
    );
    expect(record).toEqual({
      port: 45001,
      pid: 4242,
      version: '0.193.0',
      startedAt: 1754956800000,
    });
  });

  it.each([
    ['missing file', null],
    ['invalid json', '{nope'],
    ['non-object', '"str"'],
    ['port out of range', JSON.stringify({ port: 99999, pid: 1, version: 'v', startedAt: 0 })],
    ['fractional port', JSON.stringify({ port: 45001.5, pid: 1, version: 'v', startedAt: 0 })],
    ['negative pid', JSON.stringify({ port: 45001, pid: -1, version: 'v', startedAt: 0 })],
    ['missing version', JSON.stringify({ port: 45001, pid: 1, startedAt: 0 })],
    ['oversized version', JSON.stringify({ port: 45001, pid: 1, version: 'x'.repeat(101), startedAt: 0 })],
    ['string startedAt', JSON.stringify({ port: 45001, pid: 1, version: 'v', startedAt: 'now' })],
  ] as const)('reads %s as no daemon', (_name, contents) => {
    expect(readDaemonDiscovery(FILE, () => contents)).toBeNull();
  });
});

describe('ensureSharedDaemon', () => {
  const healthyRecord = JSON.stringify({
    port: 45001,
    pid: 4242,
    version: '0.193.0',
    startedAt: 1,
  });

  it('reuses a discovered daemon that passes the health check', async () => {
    const startDaemon = vi.fn();
    const endpoint = await ensureSharedDaemon(FILE, {
      readFile: () => healthyRecord,
      checkHealth: vi.fn(async () => true),
      startDaemon,
      cliVersion: () => '0.193.0',
    });

    expect(endpoint).toEqual({
      url: 'ws://127.0.0.1:45001',
      pid: 4242,
      port: 45001,
      spawned: false,
      versionMismatch: false,
    });
    expect(startDaemon).not.toHaveBeenCalled();
  });

  it('flags a version mismatch when reusing a daemon from another CLI version', async () => {
    const endpoint = await ensureSharedDaemon(FILE, {
      readFile: () => healthyRecord,
      checkHealth: async () => true,
      cliVersion: () => '0.200.0',
    });
    expect(endpoint.versionMismatch).toBe(true);
  });

  it('replaces a stale record: delete, spawn detached, write exclusively', async () => {
    const deleteFile = vi.fn();
    const writeFileExclusive = vi.fn(() => true);
    const endpoint = await ensureSharedDaemon(FILE, {
      readFile: () => healthyRecord,
      checkHealth: async () => false,
      deleteFile,
      writeFileExclusive,
      startDaemon: async () => ({
        url: 'ws://127.0.0.1:45900',
        pid: 5001,
        port: 45900,
      }),
      cliVersion: () => '0.193.0',
      now: () => 1754956800000,
    });

    expect(deleteFile).toHaveBeenCalledWith(FILE);
    expect(writeFileExclusive).toHaveBeenCalledWith(
      FILE,
      JSON.stringify({
        port: 45900,
        pid: 5001,
        version: '0.193.0',
        startedAt: 1754956800000,
      }),
    );
    expect(endpoint).toMatchObject({
      url: 'ws://127.0.0.1:45900',
      pid: 5001,
      spawned: true,
    });
  });

  it('loses the wx race to a healthy winner and reaps its own daemon', async () => {
    // First read: no record; read after losing the race: the winner's.
    const reads = [null, healthyRecord];
    const killProcessTree = vi.fn(async () => {});
    const endpoint = await ensureSharedDaemon(FILE, {
      readFile: () => reads.shift() ?? null,
      writeFileExclusive: () => false,
      checkHealth: async () => true,
      killProcessTree,
      startDaemon: async () => ({
        url: 'ws://127.0.0.1:45900',
        pid: 5001,
        port: 45900,
      }),
      cliVersion: () => '0.193.0',
    });

    expect(killProcessTree).toHaveBeenCalledWith(5001);
    expect(endpoint).toMatchObject({
      url: 'ws://127.0.0.1:45001',
      pid: 4242,
      spawned: false,
    });
  });

  it('keeps its own daemon when the race winner is unhealthy', async () => {
    const reads = [null, healthyRecord];
    const writes = [false, true];
    const deleteFile = vi.fn();
    const killProcessTree = vi.fn(async () => {});
    const endpoint = await ensureSharedDaemon(FILE, {
      readFile: () => reads.shift() ?? null,
      writeFileExclusive: () => writes.shift() ?? true,
      checkHealth: async () => false,
      deleteFile,
      killProcessTree,
      startDaemon: async () => ({
        url: 'ws://127.0.0.1:45900',
        pid: 5001,
        port: 45900,
      }),
    });

    expect(killProcessTree).not.toHaveBeenCalled();
    expect(deleteFile).toHaveBeenCalledWith(FILE);
    expect(endpoint).toMatchObject({ pid: 5001, spawned: true });
  });
});

describe('shutdownSharedDaemon', () => {
  it('kills the recorded pid and removes the file', async () => {
    const killProcessTree = vi.fn(async () => {});
    const deleteFile = vi.fn();
    await expect(
      shutdownSharedDaemon(FILE, {
        readFile: () =>
          JSON.stringify({
            port: 45001,
            pid: 4242,
            version: '0.193.0',
            startedAt: 1,
          }),
        killProcessTree,
        deleteFile,
      }),
    ).resolves.toBe(true);
    expect(killProcessTree).toHaveBeenCalledWith(4242);
    expect(deleteFile).toHaveBeenCalledWith(FILE);
  });

  it('returns false and still clears a malformed file', async () => {
    const killProcessTree = vi.fn(async () => {});
    const deleteFile = vi.fn();
    await expect(
      shutdownSharedDaemon(FILE, {
        readFile: () => '{corrupt',
        killProcessTree,
        deleteFile,
      }),
    ).resolves.toBe(false);
    expect(killProcessTree).not.toHaveBeenCalled();
    expect(deleteFile).toHaveBeenCalledWith(FILE);
  });
});
