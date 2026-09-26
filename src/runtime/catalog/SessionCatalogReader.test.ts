import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { afterEach, describe, expect, it } from 'vitest';
import { SessionCatalogReader } from './SessionCatalogReader';

const readers: SessionCatalogReader[] = [];
const directories: string[] = [];
afterEach(async () => {
  for (const reader of readers.splice(0)) reader.dispose();
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

async function fixture(): Promise<SessionCatalogReader> {
  const directory = await mkdtemp(join(tmpdir(), 'droid-catalog-worker-'));
  directories.push(directory);
  const file = join(directory, 'fixture.cjs');
  await writeFile(file, `
    const { parentPort, threadId } = require('node:worker_threads');
    parentPort.on('message', ({ id, options }) => {
      if (options.cwd === 'exit') process.exit(3);
      if (options.cwd === 'unavailable') { parentPort.postMessage({ id }); return; }
      if (options.cwd === 'slow') { const deadline = performance.now() + 80; while (performance.now() < deadline) {} }
      parentPort.postMessage({ id, rows: [{ id: options.cwd, threadId, modifiedTime: new Date(1) }] });
    });
  `);
  const reader = new SessionCatalogReader(file);
  readers.push(reader);
  return reader;
}

describe('isolated SDK catalog reads', () => {
  it('keeps host work running during a synchronous scan and reuses one worker for concurrent reads', async () => {
    const reader = await fixture();
    let completed = false;
    const slow = reader.list({ cwd: 'slow', limit: 50 }).then(rows => { completed = true; return rows; });
    const fast = reader.list({ cwd: 'other', limit: 50 });
    await setImmediate();
    expect(completed).toBe(false);
    const [first, second] = await Promise.all([slow, fast]);
    expect(first).toMatchObject([{ id: 'slow', modifiedTime: new Date(1) }]);
    expect(second).toMatchObject([{ id: 'other', modifiedTime: new Date(1) }]);
    expect((first[0] as { threadId: number }).threadId).toBe((second[0] as { threadId: number }).threadId);
  });

  it('rejects failed reads, clears a crashed worker, and permits a fresh scan', async () => {
    const reader = await fixture();
    await expect(reader.list({ cwd: 'unavailable', limit: 50 })).rejects.toThrow('could not be read');
    await expect(reader.list({ cwd: 'exit', limit: 50 })).rejects.toThrow('reader stopped');
    await expect(reader.list({ cwd: 'restarted', limit: 50 })).resolves.toMatchObject([{ id: 'restarted' }]);
  });

  it('rejects pending and new requests when the extension disposes', async () => {
    const reader = await fixture();
    const pending = expect(reader.list({ cwd: 'slow', limit: 50 })).rejects.toThrow('reader stopped');
    reader.dispose();
    await pending;
    await expect(reader.list({ cwd: 'later', limit: 50 })).rejects.toThrow('disposed');
  });
});
