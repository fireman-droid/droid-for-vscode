import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it, vi } from 'vitest';
import { createTurnSnapshotStore, type GitRunResult, type TurnSnapshotDependencies } from './turnSnapshots';
import type { ChangeStatsPersistence } from './changeStats';

const exec = promisify(execFile);
it.each([12_000, 61_000])('captures a full workspace after %i ms or reports a bounded failure', async elapsed => {
  const directory = await mkdtemp(join(tmpdir(), 'dvx-capture-deadline-'));
  const root = join(directory, 'workspace');
  await mkdir(root);
  const data = new Map<string, unknown>();
  const persistence: ChangeStatsPersistence = { get: <T>(key: string) => data.get(key) as T | undefined,
    update: async (key, value) => { data.set(key, value); } };
  const scope = { sessionId: 'capture-session', turnId: 'capture-turn' };
  let now = 0;
  let after = false;
  const recordDiagnostic = vi.fn();
  const runGit: TurnSnapshotDependencies['runGit'] = async (args, options): Promise<GitRunResult> => {
    if (after && args.includes('hash-object')) now = elapsed;
    if (options.timeoutMs <= 1) return { stdout: Buffer.alloc(0), code: null, timedOut: true };
    return new Promise(resolve => {
      const child = execFile('git', [...args], { cwd: options.cwd, env: options.env, windowsHide: true,
        encoding: 'buffer', timeout: options.timeoutMs, maxBuffer: options.maxStdoutBytes }, (error, stdout) => {
        resolve({ stdout, code: error ? typeof error.code === 'number' ? error.code : null : 0, timedOut: error?.killed === true });
      });
      child.stdin?.end(options.input);
    });
  };
  const store = createTurnSnapshotStore(() => root, join(directory, 'store'), persistence, { now: () => now, runGit, recordDiagnostic });
  try {
    await exec('git', ['init', '--quiet', root], { windowsHide: true });
    await Promise.all(Array.from({ length: 530 }, (_, index) => writeFile(join(root, `${index}.txt`), `before ${index}\r\n`)));
    await writeFile(join(root, 'binary.bin'), Buffer.from([0, 255, 13, 10]));
    await exec('git', ['-C', root, 'add', '.'], { windowsHide: true });
    const index = await readFile(join(root, '.git/index'));
    expect(await store.capture(scope, 'before')).toMatch(/^[0-9a-f]{40}$/);
    await writeFile(join(root, '529.txt'), 'after\r\n');
    after = true;
    const captured = await store.capture(scope, 'after');
    if (elapsed < 60_000) {
      expect(captured).toMatch(/^[0-9a-f]{40}$/);
      expect(await store.readTreeBytes(scope, '529.txt', 'before')).toEqual(Buffer.from('before 529\r\n'));
      expect(await store.readTreeBytes(scope, '529.txt', 'after')).toEqual(Buffer.from('after\r\n'));
      expect(await store.readTreeBytes(scope, 'binary.bin', 'after')).toEqual(Buffer.from([0, 255, 13, 10]));
      expect((await store.diff(scope)).get('529.txt')).toEqual({ additions: 1, deletions: 1 });
    } else {
      expect(captured).toBeUndefined();
      expect(store.read(scope.sessionId, scope.turnId)?.after).toBeUndefined();
      expect(recordDiagnostic).toHaveBeenCalledWith(expect.objectContaining({ name: 'host.changes.snapshot-failed',
        attributes: expect.objectContaining({ phase: 'after', reason: expect.stringContaining('timed out') }) }));
    }
    expect(await readFile(join(root, '.git/index'))).toEqual(index);
  } finally {
    await store.dispose();
    await rm(directory, { recursive: true, force: true });
  }
}, 30_000);
