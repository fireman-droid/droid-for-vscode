import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { BtwAnalysisRunner } from './btwAnalysisRunner';

let directory: string;
let workerFile: string;
beforeAll(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'btw-worker-'));
  workerFile = path.join(directory, 'worker.cjs');
  await build({ entryPoints: ['src/runtime/btw/btwAnalysisWorker.ts'], outfile: workerFile,
    bundle: true, platform: 'node', format: 'cjs', minify: true });
});
afterAll(async () => { await rm(directory, { recursive: true, force: true }); });

describe('BTW worker lifecycle', () => {
  it('cancels active execution, rejects overlap and remains usable for the next question', async () => {
    const runner = new BtwAnalysisRunner(workerFile);
    const pending = runner.run({ code: 'while (true) {}', language: 'javascript', files: {} });
    expect(await runner.run({ code: 'return 1', language: 'javascript', files: {} }))
      .toMatchObject({ ok: false, error: expect.stringContaining('already running') });
    runner.cancel();
    expect(await pending).toMatchObject({ ok: false, error: 'Analysis cancelled.' });
    expect(await runner.run({ code: 'const value: number = 42; return value', language: 'typescript', files: {} }))
      .toEqual({ ok: true, output: '', value: '42' });
  });

  it('contains excessive guest allocations and supports subsequent execution', async () => {
    const runner = new BtwAnalysisRunner(workerFile);
    expect(await runner.run({ code: 'const xs = []; while (true) xs.push(new Array(100000).fill(1));', language: 'javascript', files: {} }))
      .toMatchObject({ ok: false });
    expect(await runner.run({ code: 'return 1', language: 'javascript', files: {} }))
      .toMatchObject({ ok: true, value: '1' });
  });
});
