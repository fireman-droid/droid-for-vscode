import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  defaultSessionsDirectory,
  readFavorites,
  writeFavorite,
} from './sessionFavorites';

describe('sessionFavorites', () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(
      path.join(os.tmpdir(), 'dvx-favorites-'),
    );
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('reports the default sessions directory under the home folder', () => {
    expect(defaultSessionsDirectory()).toBe(
      path.join(os.homedir(), '.factory', 'sessions'),
    );
  });

  it('treats a missing favorites file as empty and creates it on write', async () => {
    await expect(readFavorites(directory)).resolves.toEqual(new Set());
    await expect(
      writeFavorite(directory, 'session-a', true),
    ).resolves.toBe(true);
    await expect(readFavorites(directory)).resolves.toEqual(
      new Set(['session-a']),
    );
    const raw = await readFile(
      path.join(directory, '.favorites'),
      'utf8',
    );
    expect(JSON.parse(raw)).toEqual(['session-a']);
  });

  it('only adds or removes the toggled id and preserves other entries', async () => {
    await writeFile(
      path.join(directory, '.favorites'),
      JSON.stringify(['cli-owned-1', 'cli-owned-2']),
      'utf8',
    );

    await expect(
      writeFavorite(directory, 'session-b', true),
    ).resolves.toBe(true);
    await expect(readFavorites(directory)).resolves.toEqual(
      new Set(['cli-owned-1', 'cli-owned-2', 'session-b']),
    );

    await expect(
      writeFavorite(directory, 'cli-owned-1', false),
    ).resolves.toBe(true);
    await expect(readFavorites(directory)).resolves.toEqual(
      new Set(['cli-owned-2', 'session-b']),
    );
  });

  it('is idempotent when the requested state already holds', async () => {
    await writeFile(
      path.join(directory, '.favorites'),
      JSON.stringify(['session-a']),
      'utf8',
    );
    await expect(
      writeFavorite(directory, 'session-a', true),
    ).resolves.toBe(true);
    await expect(
      writeFavorite(directory, 'session-b', false),
    ).resolves.toBe(true);
    const raw = await readFile(
      path.join(directory, '.favorites'),
      'utf8',
    );
    expect(JSON.parse(raw)).toEqual(['session-a']);
  });

  it('fails closed on an unexpected file shape without clobbering it', async () => {
    const file = path.join(directory, '.favorites');
    for (const hostile of [
      '{"not":"an array"}',
      '["ok", 42]',
      'not json at all',
    ]) {
      await writeFile(file, hostile, 'utf8');
      await expect(
        writeFavorite(directory, 'session-a', true),
      ).resolves.toBe(false);
      await expect(readFile(file, 'utf8')).resolves.toBe(hostile);
      await expect(readFavorites(directory)).resolves.toEqual(
        new Set(),
      );
    }
  });

  it('rejects an empty session id', async () => {
    await expect(writeFavorite(directory, '', true)).resolves.toBe(
      false,
    );
  });

  it('leaves no temporary files behind after writes', async () => {
    await writeFavorite(directory, 'session-a', true);
    await writeFavorite(directory, 'session-a', false);
    const entries = await readdir(directory);
    expect(entries).toEqual(['.favorites']);
  });
});
