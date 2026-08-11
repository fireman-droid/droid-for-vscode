import { describe, expect, it, vi } from 'vitest';

import {
  acquireSessionLease,
  readLeases,
  releaseSessionLease,
} from './sessionLease';

const FILE = 'C:\\home\\.droidvisx\\sessions-attached.json';

function memoryFile(initial: string | null = null) {
  let contents = initial;
  return {
    readFile: () => contents,
    writeFile: (_file: string, next: string) => {
      contents = next;
    },
    current: () => contents,
  };
}

describe('acquireSessionLease', () => {
  it('acquires a free lease and records pid/ts', () => {
    const file = memoryFile();
    const outcome = acquireSessionLease(FILE, 'session-1', {
      ...file,
      pid: () => 111,
      now: () => 1754956800000,
      isPidAlive: () => true,
    });

    expect(outcome).toEqual({ acquired: true });
    expect(JSON.parse(file.current() ?? '{}')).toEqual({
      'session-1': { pid: 111, ts: 1754956800000 },
    });
  });

  it('refuses when another live process holds the lease', () => {
    const file = memoryFile(
      JSON.stringify({ 'session-1': { pid: 222, ts: 1 } }),
    );
    const outcome = acquireSessionLease(FILE, 'session-1', {
      ...file,
      pid: () => 111,
      isPidAlive: (pid) => pid === 222,
    });

    expect(outcome).toEqual({ acquired: false, heldByPid: 222 });
    expect(JSON.parse(file.current() ?? '{}')['session-1']).toEqual({
      pid: 222,
      ts: 1,
    });
  });

  it('preempts a lease held by a dead process', () => {
    const file = memoryFile(
      JSON.stringify({ 'session-1': { pid: 222, ts: 1 } }),
    );
    const outcome = acquireSessionLease(FILE, 'session-1', {
      ...file,
      pid: () => 111,
      now: () => 2,
      isPidAlive: () => false,
    });

    expect(outcome).toEqual({ acquired: true });
    expect(JSON.parse(file.current() ?? '{}')['session-1']).toEqual({
      pid: 111,
      ts: 2,
    });
  });

  it('refreshes its own existing lease', () => {
    const file = memoryFile(
      JSON.stringify({ 'session-1': { pid: 111, ts: 1 } }),
    );
    const isPidAlive = vi.fn(() => true);
    const outcome = acquireSessionLease(FILE, 'session-1', {
      ...file,
      pid: () => 111,
      now: () => 9,
      isPidAlive,
    });

    expect(outcome).toEqual({ acquired: true });
    expect(isPidAlive).not.toHaveBeenCalled();
    expect(JSON.parse(file.current() ?? '{}')['session-1'].ts).toBe(9);
  });
});

describe('releaseSessionLease', () => {
  it('removes its own lease and keeps others', () => {
    const file = memoryFile(
      JSON.stringify({
        'session-1': { pid: 111, ts: 1 },
        'session-2': { pid: 222, ts: 1 },
      }),
    );
    releaseSessionLease(FILE, 'session-1', {
      ...file,
      pid: () => 111,
      isPidAlive: () => true,
    });

    expect(JSON.parse(file.current() ?? '{}')).toEqual({
      'session-2': { pid: 222, ts: 1 },
    });
  });

  it('does not release a lease held by another live process', () => {
    const file = memoryFile(
      JSON.stringify({ 'session-1': { pid: 222, ts: 1 } }),
    );
    releaseSessionLease(FILE, 'session-1', {
      ...file,
      pid: () => 111,
      isPidAlive: () => true,
    });

    expect(JSON.parse(file.current() ?? '{}')['session-1']).toBeDefined();
  });

  it('sweeps a dead foreign lease on release', () => {
    const file = memoryFile(
      JSON.stringify({ 'session-1': { pid: 222, ts: 1 } }),
    );
    releaseSessionLease(FILE, 'session-1', {
      ...file,
      pid: () => 111,
      isPidAlive: () => false,
    });

    expect(JSON.parse(file.current() ?? '{}')).toEqual({});
  });
});

describe('readLeases', () => {
  it.each([
    ['missing file', null],
    ['corrupt json', '{nope'],
    ['array payload', '[1,2]'],
  ] as const)('reads %s as empty', (_name, contents) => {
    expect(readLeases(FILE, () => contents)).toEqual({});
  });

  it('drops malformed entries and keeps valid ones', () => {
    const leases = readLeases(FILE, () =>
      JSON.stringify({
        good: { pid: 5, ts: 1 },
        'bad-pid': { pid: 'x', ts: 1 },
        'bad-ts': { pid: 5, ts: 'later' },
        'bad-shape': 42,
        ['x'.repeat(201)]: { pid: 5, ts: 1 },
      }),
    );
    expect(leases).toEqual({ good: { pid: 5, ts: 1 } });
  });
});
