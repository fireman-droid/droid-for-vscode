import { describe, expect, it } from 'vitest';
import { evaluateBtwScript } from './btwAnalysisSandbox';

const run = (code: string, language: 'javascript' | 'typescript' = 'javascript') =>
  evaluateBtwScript({ code, language, files: { 'sample.ts': 'export const answer = 42;' } });

describe('isolated BTW analysis', () => {
  it('evaluates TypeScript, assertions and Promise microtasks using explicit snapshots', async () => {
    expect(await run(`
      const results: number[] = [];
      await Promise.all([Promise.resolve(2), Promise.resolve(3)]).then(xs => results.push(...xs));
      assert(results.reduce((a, b) => a + b, 0) === 5);
      console.log(files['sample.ts']);
      return results;
    `, 'typescript')).toEqual({ ok: true, output: 'export const answer = 42;\n', value: '[2,3]' });
  });
  it('reports failed checks rather than claiming success', async () => {
    expect(await run('assert(false, "wrong result")')).toMatchObject({ ok: false, error: 'wrong result' });
  });
  it('exposes no host process, filesystem, network, timers or module loader', async () => {
    expect(await run(`
      for (const name of ['process', 'require', 'fetch', 'XMLHttpRequest', 'setTimeout', 'Deno', 'Bun']) {
        assert(typeof globalThis[name] === 'undefined', name);
      }
      let blocked = false;
      try { await import('node:fs'); } catch { blocked = true; }
      assert(blocked);
      assert(Function('return typeof process')() === 'undefined');
    `)).toMatchObject({ ok: true });
  });
  it('rejects writes to file snapshots and isolates globals between runs', async () => {
    expect(await run("files['sample.ts'] = 'modified'")).toMatchObject({ ok: false });
    await run('globalThis.secret = 1');
    expect(await run("assert(typeof secret === 'undefined')")).toMatchObject({ ok: true });
  });
  it('bounds output and refuses promises that never settle', async () => {
    expect(await run("console.log('x'.repeat(16001))")).toMatchObject({ ok: false });
    expect(await run('await new Promise(() => {})')).toMatchObject({ ok: false, error: expect.stringContaining('did not settle') });
  });
  it('interrupts a synchronous infinite loop', async () => {
    expect(await run('while (true) {}')).toMatchObject({ ok: false });
  });
});
