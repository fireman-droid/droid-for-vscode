import { describe, expect, it, vi } from 'vitest';

import {
  ensureSharedDaemon as ensureSharedDaemonUnderTest,
  readDaemonDiscovery,
  shutdownSharedDaemon,
  type DaemonDiscoveryDeps,
} from './daemonDiscovery';

const FILE = 'C:\\home\\.droidvisx\\daemon.json';

function ensureSharedDaemon(
  file: string,
  deps: Partial<DaemonDiscoveryDeps> = {},
) {
  return ensureSharedDaemonUnderTest(file, {
    resolveListenerPid: async (port) =>
      port === 45900 ? 5001 : port === 45002 ? 6002 : 4242,
    ...deps,
  });
}

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
    const steps: string[] = [];
    const endpoint = await ensureSharedDaemon(FILE, {
      readFile: () => healthyRecord,
      checkHealth: vi.fn(async () => {
        steps.push('health');
        return 'healthy' as const;
      }),
      isPidAlive: () => true,
      resolveListenerPid: async () => {
        steps.push('identity');
        return 4242;
      },
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
    expect(steps).toEqual(['identity', 'health']);
  });

  it.each([
    ['unresolvable listener', null],
    ['listener owned by another pid', 7331],
  ] as const)(
    'rejects a reused record with a %s before credential-bearing health',
    async (_case, listenerPid) => {
      const checkHealth = vi.fn(async () => 'healthy' as const);
      const startDaemon = vi.fn(async () => ({
        url: 'ws://127.0.0.1:45900',
        pid: 5001,
        port: 45900,
      }));
      const writeFileExclusive = vi.fn(() => true);
      const killProcessTree = vi.fn(async () => undefined);
      let contents: string | null = healthyRecord;

      const endpoint = await ensureSharedDaemon(FILE, {
        readFile: () => contents,
        checkHealth,
        isPidAlive: () => true,
        resolveListenerPid: async (port) =>
          port === 45001 ? listenerPid : 5001,
        deleteFileIfMatches: () => {
          contents = null;
          return true;
        },
        startDaemon,
        writeFileExclusive,
        killProcessTree,
        cliVersion: () => '0.193.0',
      });

      expect(checkHealth).not.toHaveBeenCalled();
      expect(killProcessTree).not.toHaveBeenCalled();
      expect(endpoint).toMatchObject({ pid: 5001, spawned: true });
      expect(writeFileExclusive).toHaveBeenCalledWith(
        FILE,
        expect.stringContaining('"pid":5001'),
      );
    },
  );

  it('flags a version mismatch when reusing a daemon from another CLI version', async () => {
    const endpoint = await ensureSharedDaemon(FILE, {
      readFile: () => healthyRecord,
      checkHealth: async () => 'healthy',
      isPidAlive: () => true,
      cliVersion: () => '0.200.0',
    });
    expect(endpoint.versionMismatch).toBe(true);
  });

  it('publishes only a verified fresh listener without health authentication', async () => {
    const checkHealth = vi.fn(async () => 'healthy' as const);
    const writeFileExclusive = vi.fn(() => true);
    const resolveListenerPid = vi.fn(async () => 7331);

    const endpoint = await ensureSharedDaemon(FILE, {
      readFile: () => null,
      checkHealth,
      resolveListenerPid,
      writeFileExclusive,
      startDaemon: async () => ({
        url: 'ws://127.0.0.1:45900',
        pid: 7001,
        port: 45900,
        listenerVerified: true,
      }),
      cliVersion: () => '0.193.0',
      now: () => 1754956800000,
    });

    expect(checkHealth).not.toHaveBeenCalled();
    expect(resolveListenerPid).not.toHaveBeenCalled();
    expect(endpoint).toMatchObject({ pid: 7001, spawned: true });
    expect(writeFileExclusive).toHaveBeenCalledWith(
      FILE,
      JSON.stringify({
        port: 45900,
        pid: 7001,
        version: '0.193.0',
        startedAt: 1754956800000,
      }),
    );
  });

  it('cleans an unverifiable fresh daemon without publication or authentication', async () => {
    const checkHealth = vi.fn(async () => 'healthy' as const);
    const writeFileExclusive = vi.fn(() => true);
    const killProcessTree = vi.fn(async () => undefined);

    await expect(
      ensureSharedDaemon(FILE, {
        readFile: () => null,
        checkHealth,
        resolveListenerPid: async () => null,
        writeFileExclusive,
        killProcessTree,
        startDaemon: async () => ({
          url: 'ws://127.0.0.1:45900',
          pid: 5001,
          port: 45900,
        }),
      }),
    ).rejects.toThrow('listener identity could not be verified');

    expect(checkHealth).not.toHaveBeenCalled();
    expect(writeFileExclusive).not.toHaveBeenCalled();
    expect(killProcessTree).toHaveBeenCalledExactlyOnceWith(5001);
  });

  it('replaces a stale record: delete, spawn detached, write exclusively', async () => {
    const deleteFile = vi.fn();
    const writeFileExclusive = vi.fn(() => true);
    let contents: string | null = healthyRecord;
    const endpoint = await ensureSharedDaemon(FILE, {
      readFile: () => contents,
      checkHealth: async () => 'unreachable',
      isPidAlive: () => true,
      deleteFile,
      deleteFileIfMatches: (file) => {
        deleteFile(file);
        contents = null;
        return true;
      },
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

  it('adopts a healthy record that replaces the stale record during cleanup', async () => {
    const replacement = JSON.stringify({
      port: 45002,
      pid: 6002,
      version: '0.194.0',
      startedAt: 2,
    });
    const reads = [healthyRecord, replacement];
    const startDaemon = vi.fn();
    const endpoint = await ensureSharedDaemon(FILE, {
      readFile: () => reads.shift() ?? replacement,
      checkHealth: async (url) =>
        url.endsWith(':45002') ? 'healthy' : 'unreachable',
      deleteFileIfMatches: () => false,
      startDaemon,
      cliVersion: () => '0.194.0',
    });

    expect(startDaemon).not.toHaveBeenCalled();
    expect(endpoint).toMatchObject({
      pid: 6002,
      port: 45002,
      spawned: false,
    });
  });

  it('reuses the healthy listener after its wrapper pid exits', async () => {
    const checkHealth = vi.fn(async () => 'healthy' as const);
    const deleteFile = vi.fn();
    const startDaemon = vi.fn();
    const endpoint = await ensureSharedDaemon(FILE, {
      readFile: () => healthyRecord,
      checkHealth,
      isPidAlive: () => false,
      resolveListenerPid: async () => 7331,
      deleteFile,
      startDaemon,
      cliVersion: () => '0.193.0',
    });

    expect(checkHealth).toHaveBeenCalledWith('ws://127.0.0.1:45001');
    expect(deleteFile).not.toHaveBeenCalled();
    expect(startDaemon).not.toHaveBeenCalled();
    expect(endpoint).toMatchObject({ pid: 7331, spawned: false });
  });

  it('trusts a healthy race winner even when its wrapper pid is dead', async () => {
    const reads = [null, healthyRecord];
    const writes = [false];
    const checkHealth = vi.fn(async () => 'healthy' as const);
    const killProcessTree = vi.fn(async () => {});
    const endpoint = await ensureSharedDaemon(FILE, {
      readFile: () => reads.shift() ?? null,
      writeFileExclusive: () => writes.shift() ?? true,
      checkHealth,
      isPidAlive: (pid) => pid !== 4242,
      resolveListenerPid: async () => 7331,
      killProcessTree,
      startDaemon: async () => ({
        url: 'ws://127.0.0.1:45900',
        pid: 5001,
        port: 45900,
      }),
    });

    expect(checkHealth).toHaveBeenCalled();
    expect(killProcessTree).toHaveBeenCalledWith(5001);
    expect(endpoint).toMatchObject({ pid: 7331, spawned: false });
  });

  it('loses the wx race to a healthy winner and reaps its own daemon', async () => {
    // First read: no record; read after losing the race: the winner's.
    const reads = [null, healthyRecord];
    const killProcessTree = vi.fn(async () => {});
    const endpoint = await ensureSharedDaemon(FILE, {
      readFile: () => reads.shift() ?? null,
      writeFileExclusive: () => false,
      checkHealth: async () => 'healthy',
      isPidAlive: () => true,
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
      checkHealth: async () => 'unreachable',
      isPidAlive: () => true,
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

  it('reaps its duplicate when an unhealthy winner is concurrently replaced', async () => {
    const replacement = JSON.stringify({
      port: 45002,
      pid: 6002,
      version: '0.194.0',
      startedAt: 2,
    });
    const reads = [null, healthyRecord, replacement];
    const killProcessTree = vi.fn(async () => {});
    const endpoint = await ensureSharedDaemon(FILE, {
      readFile: () =>
        reads.length > 0 ? (reads.shift() ?? null) : replacement,
      writeFileExclusive: () => false,
      deleteFileIfMatches: () => false,
      checkHealth: async (url) =>
        url.endsWith(':45002') ? 'healthy' : 'unreachable',
      killProcessTree,
      startDaemon: async () => ({
        url: 'ws://127.0.0.1:45900',
        pid: 5001,
        port: 45900,
      }),
      cliVersion: () => '0.194.0',
    });

    expect(killProcessTree).toHaveBeenCalledWith(5001);
    expect(endpoint).toMatchObject({
      pid: 6002,
      port: 45002,
      spawned: false,
    });
  });

  it('uses a healthy third contender after replacement publication loses', async () => {
    const thirdRecord = JSON.stringify({
      port: 45002,
      pid: 6002,
      version: '0.194.0',
      startedAt: 2,
    });
    const reads = [null, healthyRecord, thirdRecord];
    const writes = [false, false];
    const killProcessTree = vi.fn(async () => {});
    const endpoint = await ensureSharedDaemon(FILE, {
      readFile: () => reads.shift() ?? null,
      writeFileExclusive: () => writes.shift() ?? false,
      checkHealth: async (url) =>
        url.endsWith(':45002') ? 'healthy' : 'unreachable',
      isPidAlive: () => true,
      deleteFile: vi.fn(),
      killProcessTree,
      startDaemon: async () => ({
        url: 'ws://127.0.0.1:45900',
        pid: 5001,
        port: 45900,
      }),
      cliVersion: () => '0.194.0',
    });

    expect(killProcessTree).toHaveBeenCalledWith(5001);
    expect(endpoint).toMatchObject({
      pid: 6002,
      port: 45002,
      spawned: false,
    });
  });

  it('reaps its duplicate and fails when no contender is healthy', async () => {
    const reads = [null, healthyRecord, healthyRecord];
    const writes = [false, false];
    const killProcessTree = vi.fn(async () => {});

    await expect(
      ensureSharedDaemon(FILE, {
        readFile: () => reads.shift() ?? null,
        writeFileExclusive: () => writes.shift() ?? false,
        checkHealth: async () => 'unreachable',
        isPidAlive: () => true,
        deleteFile: vi.fn(),
        killProcessTree,
        startDaemon: async () => ({
          url: 'ws://127.0.0.1:45900',
          pid: 5001,
          port: 45900,
        }),
      }),
    ).rejects.toThrow('discovery race did not yield a healthy winner');
    expect(killProcessTree).toHaveBeenCalledWith(5001);
  });

  it('keeps an authenticated-listener record on credential failure', async () => {
    const startDaemon = vi.fn();
    const deleteFile = vi.fn();
    const killProcessTree = vi.fn(async () => {});
    const steps: string[] = [];

    const endpoint = await ensureSharedDaemon(FILE, {
      readFile: () => healthyRecord,
      checkHealth: async () => {
        steps.push('health');
        return 'authentication-failed';
      },
      isPidAlive: () => true,
      resolveListenerPid: async () => {
        steps.push('identity');
        return 4242;
      },
      startDaemon,
      deleteFile,
      killProcessTree,
    });

    expect(endpoint).toMatchObject({ pid: 4242, spawned: false });
    expect(startDaemon).not.toHaveBeenCalled();
    expect(deleteFile).not.toHaveBeenCalled();
    expect(killProcessTree).not.toHaveBeenCalled();
    expect(steps).toEqual(['identity', 'health']);
  });
});

describe('shutdownSharedDaemon', () => {
  it('kills the verified listener pid and removes the file', async () => {
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
        resolveListenerPid: async () => 4242,
        killProcessTree,
        deleteFile,
      }),
    ).resolves.toBe(true);
    expect(killProcessTree).toHaveBeenCalledWith(4242);
    expect(deleteFile).toHaveBeenCalledWith(FILE);
  });

  it('kills the repaired listener after the wrapper exits', async () => {
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
        resolveListenerPid: async () => 7331,
        killProcessTree,
        deleteFile,
      }),
    ).resolves.toBe(true);
    expect(killProcessTree).toHaveBeenCalledWith(7331);
    expect(deleteFile).toHaveBeenCalledWith(FILE);
  });

  it('fails closed when a healthy listener identity is unverifiable', async () => {
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
        resolveListenerPid: async () => null,
        killProcessTree,
        deleteFile,
      }),
    ).resolves.toBe(false);
    expect(killProcessTree).not.toHaveBeenCalled();
    expect(deleteFile).not.toHaveBeenCalled();
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
