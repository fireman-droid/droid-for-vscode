import { describe, expect, it, vi } from 'vitest';

import {
  detachedDaemonSpawnOptions,
  ensurePrivateDaemon,
  privateDaemonSpawnOptions,
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

    expect(endpoint).toEqual({
      url: 'ws://127.0.0.1:45678',
      pid: 4242,
      executable: 'droid',
    });
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

  it('retries once on a fresh port after a lost port race', async () => {
    const spawn = fakeSpawn(88);
    const ports = [40010, 40011];
    const waitForPort = vi.fn((port: number) => {
      if (port === 40010) {
        spawn.exit(1);
        return Promise.reject(new Error('port timeout'));
      }
      return Promise.resolve(undefined);
    });

    const endpoint = await ensurePrivateDaemon(undefined, {
      spawnDaemon: spawn.spawnDaemon,
      pickFreePort: async () => ports.shift() ?? 0,
      waitForPort,
    });

    expect(endpoint).toEqual({
      url: 'ws://127.0.0.1:40011',
      pid: 88,
      executable: 'droid',
    });
    expect(spawn.calls).toHaveLength(2);
    expect(spawn.calls[0]?.args).toContain('40010');
    expect(spawn.calls[1]?.args).toContain('40011');
  });

  it('gives up after a single retry and reports both attempts', async () => {
    const spawn = fakeSpawn(89);
    const ports = [40020, 40021];

    await expect(
      ensurePrivateDaemon(undefined, {
        spawnDaemon: spawn.spawnDaemon,
        pickFreePort: async () => ports.shift() ?? 0,
        waitForPort: (port: number) => {
          spawn.exit(port === 40020 ? 2 : 3);
          return Promise.reject(new Error('port timeout'));
        },
      }),
    ).rejects.toThrow(
      'droid daemon failed to start after a port retry: ' +
        'droid daemon exited before listening (code 3) ' +
        '(first attempt: droid daemon exited before listening (code 2))',
    );
    expect(spawn.calls).toHaveLength(2);
  });

  it('includes the captured stderr tail in start failures', async () => {
    const spawnDaemon = (): DaemonSpawnHandle => ({
      pid: 90,
      stderrTail: () => 'EADDRINUSE: port already bound\n',
      onExit: (listener) => {
        listener(1);
      },
    });

    await expect(
      ensurePrivateDaemon(undefined, {
        spawnDaemon,
        pickFreePort: async () => 40030,
        waitForPort: () => Promise.reject(new Error('port timeout')),
      }),
    ).rejects.toThrow('stderr: EADDRINUSE: port already bound');
  });

  it('reaps a child that never listens before retrying', async () => {
    const spawn = fakeSpawn(91);
    const killProcessTree = vi.fn(async () => undefined);
    const ports = [40040, 40041];

    await ensurePrivateDaemon(undefined, {
      spawnDaemon: spawn.spawnDaemon,
      pickFreePort: async () => ports.shift() ?? 0,
      waitForPort: (port: number) =>
        port === 40040
          ? Promise.reject(new Error('port timeout'))
          : Promise.resolve(undefined),
      killProcessTree,
    });

    expect(killProcessTree).toHaveBeenCalledTimes(1);
    expect(killProcessTree).toHaveBeenCalledWith(91);
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
      executable: 'droid',
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

describe('daemon spawn options', () => {
  it('hides the console and pipes stderr for the private daemon', () => {
    expect(privateDaemonSpawnOptions()).toEqual({
      shell: true,
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
    });
  });

  it('never detaches on Windows so windowsHide stays effective', () => {
    // detached adds DETACHED_PROCESS, which makes Win32 ignore the
    // CREATE_NO_WINDOW flag windowsHide maps to — the daemon would
    // pop a visible console (the v0.2.0 startup window bug).
    expect(detachedDaemonSpawnOptions('win32')).toEqual({
      shell: true,
      detached: false,
      stdio: 'ignore',
      windowsHide: true,
    });
  });

  it('detaches on POSIX where survival needs setsid', () => {
    for (const platform of ['linux', 'darwin'] as const) {
      expect(detachedDaemonSpawnOptions(platform)).toEqual({
        shell: true,
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
    }
  });

  it('defaults to the current platform', () => {
    expect(detachedDaemonSpawnOptions()).toEqual(
      detachedDaemonSpawnOptions(process.platform),
    );
  });
});

describe('stopDaemon', () => {
  const droidCommandLine =
    'C:\\WINDOWS\\system32\\cmd.exe /d /s /c "droid daemon --port 40004 --host 127.0.0.1 --parent-pid 999"';

  it('kills the daemon process tree once identity is confirmed', async () => {
    const killProcessTree = vi.fn(async () => undefined);
    const queryProcessCommandLine = vi.fn(async () => droidCommandLine);

    await stopDaemon(
      { url: 'ws://127.0.0.1:40004', pid: 55 },
      { killProcessTree, queryProcessCommandLine },
    );

    expect(queryProcessCommandLine).toHaveBeenCalledWith(55);
    expect(killProcessTree).toHaveBeenCalledWith(55);
  });

  it('skips the kill when the pid was reused by an unrelated process', async () => {
    const killProcessTree = vi.fn(async () => undefined);

    await stopDaemon(
      { url: 'ws://127.0.0.1:40004', pid: 55 },
      {
        killProcessTree,
        queryProcessCommandLine: async () =>
          'C:\\Program Files\\Video Editor\\editor.exe --project x',
      },
    );

    expect(killProcessTree).not.toHaveBeenCalled();
  });

  it('does not accept unrelated words containing droid and daemon', async () => {
    const killProcessTree = vi.fn(async () => undefined);

    await stopDaemon(
      {
        url: 'ws://127.0.0.1:40004',
        pid: 55,
        executable: 'C:\\tools\\factory-droid.exe',
      },
      {
        killProcessTree,
        queryProcessCommandLine: async () =>
          'C:\\tools\\droidvisx-daemon-monitor.exe --watch',
      },
    );

    expect(killProcessTree).not.toHaveBeenCalled();
  });

  it('matches the exact configured executable basename', async () => {
    const killProcessTree = vi.fn(async () => undefined);

    await stopDaemon(
      {
        url: 'ws://127.0.0.1:40004',
        pid: 55,
        executable: 'C:\\tools\\factory-droid.exe',
      },
      {
        killProcessTree,
        queryProcessCommandLine: async () =>
          '"C:\\tools\\factory-droid.exe" daemon --port 40004',
      },
    );

    expect(killProcessTree).toHaveBeenCalledWith(55);
  });

  it('skips the kill when identity cannot be determined', async () => {
    const killProcessTree = vi.fn(async () => undefined);

    await stopDaemon(
      { url: 'ws://127.0.0.1:40004', pid: 55 },
      { killProcessTree, queryProcessCommandLine: async () => null },
    );

    expect(killProcessTree).not.toHaveBeenCalled();
  });

  it('treats an identity query failure as not-confirmed', async () => {
    const killProcessTree = vi.fn(async () => undefined);

    await expect(
      stopDaemon(
        { url: 'ws://127.0.0.1:40004', pid: 55 },
        {
          killProcessTree,
          queryProcessCommandLine: async () => {
            throw new Error('query failed');
          },
        },
      ),
    ).resolves.toBeUndefined();
    expect(killProcessTree).not.toHaveBeenCalled();
  });

  it('swallows kill failures for already dead daemons', async () => {
    await expect(
      stopDaemon(
        { url: 'ws://127.0.0.1:40005', pid: 56 },
        {
          killProcessTree: async () => {
            throw new Error('no such process');
          },
          queryProcessCommandLine: async () => droidCommandLine,
        },
      ),
    ).resolves.toBeUndefined();
  });
});
