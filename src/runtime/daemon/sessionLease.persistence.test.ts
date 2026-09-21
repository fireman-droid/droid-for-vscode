import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { acquireSessionLease, readLeases, releaseSessionLease } from './sessionLease';

vi.mock('node:process', async (importOriginal) => {
  const actual = await importOriginal<{ default: NodeJS.Process }>();
  return { default: { ...actual.default, platform: 'win32' } };
});

describe('session lease registry replacement on Windows', () => {
  let directory: string;
  let file: string;
  const initial = JSON.stringify({ other: { pid: 222, ts: 1 } });
  const owner = { pid: () => 111, now: () => 20, isPidAlive: () => true };

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'droidvisx-lease-write-'));
    file = path.join(directory, 'sessions-attached.json');
    fs.writeFileSync(file, initial);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    const resolved = path.resolve(directory);
    if (
      path.dirname(resolved) !== path.resolve(os.tmpdir()) ||
      !path.basename(resolved).startsWith('droidvisx-lease-write-')
    ) {
      throw new Error('Refusing to remove a directory outside the lease test fixture');
    }
    fs.rmSync(resolved, { recursive: true, force: true });
  });

  it.each(['EPERM', 'EACCES', 'EBUSY'])(
    'acquires after temporary %s while retaining exclusive ownership and prior leases',
    (code) => {
      const rename = fs.renameSync;
      let attempts = 0;
      vi.spyOn(fs, 'renameSync').mockImplementation((source, destination) => {
        attempts++;
        expect(fs.readFileSync(file, 'utf8')).toBe(initial);
        expect(fs.existsSync(`${file}.lock`)).toBe(true);
        if (attempts === 1) {
          expect(acquireSessionLease(file, 'competing', {
            ...owner,
            pid: () => 333,
          })).toEqual({ acquired: false, heldByPid: 111 });
        }
        if (attempts <= 2) {
          throw Object.assign(new Error('Windows sharing violation'), { code });
        }
        rename(source, destination);
      });

      expect(acquireSessionLease(file, 'resumed', owner)).toEqual({ acquired: true });

      expect(attempts).toBe(3);
      expect(readLeases(file)).toEqual({
        other: { pid: 222, ts: 1 },
        resumed: { pid: 111, ts: 20 },
      });
      expect(fs.readdirSync(directory)).toEqual(['sessions-attached.json']);
    },
  );

  it('propagates sustained sharing failure without losing leases or claiming ownership', () => {
    const failure = Object.assign(new Error('Registry remains busy'), { code: 'EPERM' });
    const rename = vi.spyOn(fs, 'renameSync').mockImplementation(() => {
      expect(fs.readFileSync(file, 'utf8')).toBe(initial);
      expect(fs.existsSync(`${file}.lock`)).toBe(true);
      throw failure;
    });

    expect(() => acquireSessionLease(file, 'resumed', owner)).toThrow(failure);

    expect(rename).toHaveBeenCalledTimes(5);
    expect(fs.readFileSync(file, 'utf8')).toBe(initial);
    expect(fs.readdirSync(directory)).toEqual(['sessions-attached.json']);
    rename.mockRestore();
    expect(acquireSessionLease(file, 'resumed', owner)).toEqual({ acquired: true });
  });

  it('does not retry a non-sharing write failure and retains the previous registry', () => {
    const failure = Object.assign(new Error('Disk I/O error'), { code: 'EIO' });
    const rename = vi.spyOn(fs, 'renameSync').mockImplementation(() => { throw failure; });

    expect(() => acquireSessionLease(file, 'resumed', owner)).toThrow(failure);

    expect(rename).toHaveBeenCalledTimes(1);
    expect(fs.readFileSync(file, 'utf8')).toBe(initial);
    expect(fs.readdirSync(directory)).toEqual(['sessions-attached.json']);
  });

  it('releases its lease after a temporary sharing violation while keeping foreign leases', () => {
    expect(acquireSessionLease(file, 'resumed', owner)).toEqual({ acquired: true });
    const rename = fs.renameSync;
    let attempts = 0;
    vi.spyOn(fs, 'renameSync').mockImplementation((source, destination) => {
      if (++attempts === 1) {
        expect(readLeases(file)?.['resumed']).toEqual({ pid: 111, ts: 20 });
        throw Object.assign(new Error('Windows sharing violation'), { code: 'EPERM' });
      }
      rename(source, destination);
    });

    releaseSessionLease(file, 'resumed', owner);

    expect(attempts).toBe(2);
    expect(fs.readFileSync(file, 'utf8')).toBe(initial);
    expect(fs.readdirSync(directory)).toEqual(['sessions-attached.json']);
  });
});
