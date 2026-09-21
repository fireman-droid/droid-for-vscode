import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { spawn } = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn }));
vi.mock('node:process', async (importOriginal) => {
  const actual = await importOriginal<{ default: NodeJS.Process }>();
  return { ...actual, default: { ...actual.default, platform: 'win32' } };
});

import { resolveDaemonListenerPid, verifyDaemonListeners } from './daemonLifecycle';

function queryProcess() {
  return Object.assign(new EventEmitter(), { stdout: new PassThrough(), kill: vi.fn() });
}

function reply(output: string, code = 0) {
  spawn.mockImplementationOnce(() => {
    const child = queryProcess();
    queueMicrotask(() => {
      child.stdout.end(output);
      child.emit('exit', code);
      child.emit('close', code);
    });
    return child;
  });
}

const listener = (port: number, pid: number | string) =>
  `TCP 127.0.0.1:${port} 0.0.0.0:0 LISTENING ${pid}\r\n`;
const command = (pid: number, commandLine: string | null = 'droid daemon --host 127.0.0.1') =>
  ({ ProcessId: pid, CommandLine: commandLine });

beforeEach(() => { spawn.mockReset(); });
afterEach(() => { vi.useRealTimers(); });

describe('batched daemon discovery', () => {
  it('verifies 45 records with one listener snapshot and one process identity query', async () => {
    const targets = Array.from({ length: 45 }, (_, index) => ({ port: 41000 + index, pid: 8000 + index }));
    reply(targets.map(({ port, pid }) => listener(port, pid)).join(''));
    reply(JSON.stringify(targets.map(({ pid }) => command(pid))));

    const result = await verifyDaemonListeners(targets);

    expect([...result]).toEqual(targets.map(({ port, pid }) => [port, { status: 'verified', pid }]));
    expect(spawn.mock.calls.map(([executable]) => executable)).toEqual(['netstat.exe', 'powershell.exe']);
  });

  it('returns the actual PID and distinguishes missing listeners from unknown identities', async () => {
    reply(listener(41000, 9999) + listener(41002, 8002) + listener(41003, 8003) +
      listener(41004, '') + listener(41005, 8005) +
      'TCP 127.0.0.2:41001 0.0.0.0:0 LISTENING 8001\r\n');
    reply(JSON.stringify([
      command(9999), command(8002, 'editor.exe --workspace project'), command(8003, null),
      command(8005, 'droid --label daemon'),
    ]));

    const result = await verifyDaemonListeners(
      Array.from({ length: 6 }, (_, index) => ({ port: 41000 + index, pid: 8000 + index })),
    );

    expect([...result].sort(([a], [b]) => a - b)).toEqual([
      [41000, { status: 'verified', pid: 9999 }],
      [41001, { status: 'not-listening' }],
      ...[41002, 41003, 41004, 41005].map(port => [port, { status: 'unverified' }]),
    ]);
  });

  it('does not trust listener output when the system query exits unsuccessfully', async () => {
    reply(listener(41000, 8000), 1);
    expect([...await verifyDaemonListeners([{ port: 41000, pid: 8000 }])])
      .toEqual([[41000, { status: 'unverified' }]]);
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it.each(['invalid JSON', '[{"ProcessId":8000,"CommandLine":null}]'])
    ('keeps a listener unverified for unusable process data: %s', async output => {
      reply(listener(41000, 8000));
      reply(output);
      expect([...await verifyDaemonListeners([{ port: 41000, pid: 8000 }])])
        .toEqual([[41000, { status: 'unverified' }]]);
    });

  it('preserves known absence when process identity lookup fails for another port', async () => {
    reply(listener(41000, 8000));
    spawn.mockImplementationOnce(() => {
      const child = queryProcess();
      queueMicrotask(() => child.emit('error', new Error('CIM unavailable')));
      return child;
    });
    expect([...await verifyDaemonListeners([{ port: 41000, pid: 8000 }, { port: 41001, pid: 8001 }])]
      .sort(([a], [b]) => a - b)).toEqual([
      [41000, { status: 'unverified' }], [41001, { status: 'not-listening' }],
    ]);
  });

  it('waits for complete stdout after process exit before parsing a chunked JSON snapshot', async () => {
    reply(listener(41000, 8000));
    const child = queryProcess();
    spawn.mockReturnValueOnce(child);
    const pending = verifyDaemonListeners([{ port: 41000, pid: 8000 }]);
    let settled = false;
    void pending.then(() => { settled = true; });
    await Promise.resolve();
    child.stdout.write('[{"ProcessId":8000,');
    child.emit('exit', 0);
    await Promise.resolve();
    expect(settled).toBe(false);
    child.stdout.end('"CommandLine":"droid daemon"}]');
    child.emit('close', 0);
    expect([...await pending]).toEqual([[41000, { status: 'verified', pid: 8000 }]]);
  });

  it('bounds an unresponsive query and reports unknown instead of a dead daemon', async () => {
    vi.useFakeTimers();
    const child = queryProcess();
    spawn.mockReturnValueOnce(child);
    const pending = verifyDaemonListeners([{ port: 41000, pid: 8000 }]);
    await vi.advanceTimersByTimeAsync(5000);
    expect([...await pending]).toEqual([[41000, { status: 'unverified' }]]);
    expect(child.kill).toHaveBeenCalledOnce();
    expect(spawn).toHaveBeenCalledOnce();
  });
});

describe('single-listener identity compatibility', () => {
  it('still resolves a verified listener using its exact executable identity', async () => {
    reply(listener(41000, 8000));
    reply('"C:\\tools\\droid.exe" daemon --port 41000');
    await expect(resolveDaemonListenerPid(41000)).resolves.toBe(8000);
  });

  it('does not resolve a listening endpoint whose PID is unavailable', async () => {
    reply(listener(41000, ''));
    await expect(resolveDaemonListenerPid(41000)).resolves.toBeNull();
    expect(spawn).toHaveBeenCalledOnce();
  });
});
