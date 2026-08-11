import { describe, expect, it, vi } from 'vitest';

import {
  ensurePrivateDaemon,
  startDetachedDaemon,
  stopDaemon,
  type DaemonSpawnHandle,
} from './daemonLifecycle';

function fakeSpawn(pid: number | undefined): {
  spawnDaemon: (
    droidPath: string,
    args: readonly string[],
  ) => DaemonSpawnHandle;
  calls: { droidPath: string; args: readonly string[] }[];
  exit: (code: number | null) => void;
} {
  const calls: { droidPath: string; args: readonly string[] }[] = [];
  let exitListener: ((code: number | null) => void) | undefined;
  return {
    calls,
    exit: (code) => exitListener?.(code),
    spawnDaemon: (droidPath, args) => {
      calls.push({ droidPath, args });
      return {
        pid,
        onExit: (listener) => {
          exitListener = listener;
        },
      };
    },
  };
}

describe('ensurePrivateDaemon', () => {
  it('spawns a parent-pid guarded daemon on a free port', async () => {
    const spawn = fakeSpawn(4242);
    const waitForPort = vi.fn(async () => undefined);

    const endpoint = await ensurePrivateDaemon(
      { parentPid: 999 },
      {
        spawnDaemon: spawn.spawnDaemon,
        pickFreePort: async () => 45678,
        waitForPort,
      },
    );

    expect(endpoint).toEqual({ url: 'ws://127.0.0.1:45678', pid: 4242 });
    expect(spawn.calls).toEqual([
      {
        droidPath: 'droid',
        args: [
          'daemon',
          '--port',
          '45678',
          '--host',
          '127.0.0.1',
          '--parent-pid',
          '999',
        ],
      },
    ]);
    expect(waitForPort).toHaveBeenCalledWith(45678, '127.0.0.1', 30000);
  });

  it('defaults the parent pid to the current process', async () => {
    const spawn = fakeSpawn(1);

    await ensurePrivateDaemon(undefined, {
      spawnDaemon: spawn.spawnDaemon,
      pickFreePort: async () => 40001,
      waitForPort: async () => undefined,
    });

    expect(spawn.calls[0]?.args).toContain(String(process.pid));
  });

  it('rejects when the daemon process fails to spawn', async () => {
    const spawn = fakeSpawn(undefined);

    await expect(
      ensurePrivateDaemon(undefined, {
        spawnDaemon: spawn.spawnDaemon,
        pickFreePort: async () => 40002,
        waitForPort: async () => undefined,
      }),
    ).rejects.toThrow('failed to spawn');
  });

  it('reports an early exit instead of a bare port timeout', async () => {
    const spawn = fakeSpawn(77);

    await expect(
      ensurePrivateDaemon(undefined, {
        spawnDaemon: spawn.spawnDaemon,
        pickFreePort: async () => 40003,
        waitForPort: () => {
          spawn.exit(3);
          return Promise.reject(new Error('port timeout'));
        },
      }),
    ).rejects.toThrow('exited before listening (code 3)');
  });
});

describe('startDetachedDaemon', () => {
  it('spawns a detached daemon with no parent-pid guard', async () => {
    const spawn = fakeSpawn(6001);

    const endpoint = await startDetachedDaemon(
      {},
      {
        spawnDetachedDaemon: spawn.spawnDaemon,
        pickFreePort: async () => 45900,
        waitForPort: async () => undefined,
      },
    );

    expect(endpoint).toEqual({
      url: 'ws://127.0.0.1:45900',
      pid: 6001,
      port: 45900,
    });
    expect(spawn.calls[0]?.args).toEqual([
      'daemon',
      '--port',
      '45900',
      '--host',
      '127.0.0.1',
    ]);
    expect(spawn.calls[0]?.args).not.toContain('--parent-pid');
  });

  it('rejects when the detached daemon fails to spawn', async () => {
    const spawn = fakeSpawn(undefined);

    await expect(
      startDetachedDaemon(
        {},
        {
          spawnDetachedDaemon: spawn.spawnDaemon,
          pickFreePort: async () => 45901,
          waitForPort: async () => undefined,
        },
      ),
    ).rejects.toThrow('failed to spawn');
  });
});

describe('stopDaemon', () => {
  it('kills the daemon process tree', async () => {
    const killProcessTree = vi.fn(async () => undefined);

    await stopDaemon(
      { url: 'ws://127.0.0.1:40004', pid: 55 },
      { killProcessTree },
    );

    expect(killProcessTree).toHaveBeenCalledWith(55);
  });

  it('swallows kill failures for already dead daemons', async () => {
    await expect(
      stopDaemon(
        { url: 'ws://127.0.0.1:40005', pid: 56 },
        {
          killProcessTree: async () => {
            throw new Error('no such process');
          },
        },
      ),
    ).resolves.toBeUndefined();
  });
});
