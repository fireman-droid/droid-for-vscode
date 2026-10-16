import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, expect, it } from 'vitest';
import { captureWorkspaceTree } from './captureWorkspaceTree';
import type { GitRunResult } from './turnSnapshots';

const execute = promisify(execFile);
const directories: string[] = [];
type Run = Parameters<typeof captureWorkspaceTree>[1];

afterEach(async () => {
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dvx-snapshot-race-'));
  directories.push(root);
  await execute('git', ['init', '--quiet', root], { windowsHide: true });
  await writeFile(join(root, 'keep.ts'), 'keep\r\n');
  await writeFile(join(root, 'transient.ts'), 'temporary\n');
  await execute('git', ['-C', root, 'add', '--', 'keep.ts', 'transient.ts'], { windowsHide: true });
  const originalIndex = await readFile(join(root, '.git/index'));
  const run: Run = (args, maxBytes, input) => new Promise(resolve => {
    const child = execFile('git', [...args], {
      cwd: root, windowsHide: true, encoding: 'buffer', maxBuffer: maxBytes,
      env: { ...process.env, GIT_INDEX_FILE: join(root, '.git/snapshot-index') },
    }, (error, stdout) => resolve({ stdout, code: error ? typeof error.code === 'number' ? error.code : null : 0,
      timedOut: error?.killed === true }));
    child.stdin?.end(input);
  });
  const inspect = async (...args: string[]) => (await execute('git', ['-C', root, ...args], { windowsHide: true })).stdout;
  return { root, run, originalIndex, inspect };
}

it.each(['metadata', 'hash'] as const)('re-enumerates a file removed before %s without losing real deletions or new files', async stage => {
  const { root, run, originalIndex, inspect } = await fixture();
  const before = await captureWorkspaceTree(root, run);
  let removed = false;
  let captures = 0;
  const racingRun: Run = async (args, maxBytes, input) => {
    if (args[0] === 'read-tree') captures++;
    const trigger = stage === 'metadata' ? args[0] === 'read-tree' : args.includes('--stdin-paths');
    if (!removed && trigger) {
      removed = true;
      await rm(join(root, 'transient.ts'));
      await writeFile(join(root, 'created.ts'), 'created during scan\n');
    }
    return run(args, maxBytes, input);
  };
  const after = await captureWorkspaceTree(root, racingRun);
  expect(captures).toBe(2);
  expect(await inspect('ls-tree', '-r', '--name-only', after)).toBe('created.ts\nkeep.ts\n');
  expect(await inspect('diff-tree', '--no-commit-id', '--name-status', '-r', before, after))
    .toBe('A\tcreated.ts\nD\ttransient.ts\n');
  expect(await inspect('show', `${after}:keep.ts`)).toBe('keep\r\n');
  expect(await readFile(join(root, '.git/index'))).toEqual(originalIndex);
}, 20_000);

it('fails after one rescan if files keep disappearing instead of saving an incomplete tree', async () => {
  const { root, run } = await fixture();
  let captures = 0;
  let writes = 0;
  const racingRun: Run = async (args, maxBytes, input) => {
    if (args[0] === 'read-tree') {
      captures++;
      await rm(join(root, captures === 1 ? 'transient.ts' : 'replacement.ts'));
      if (captures === 1) await writeFile(join(root, 'replacement.ts'), 'also temporary\n');
    }
    if (args[0] === 'write-tree') writes++;
    return run(args, maxBytes, input);
  };
  await expect(captureWorkspaceTree(root, racingRun)).rejects.toMatchObject({ code: 'ENOENT' });
  expect(captures).toBe(2);
  expect(writes).toBe(0);
}, 20_000);

it.each([false, true])('does not retry a hash failure with timedOut=%s without evidence of a missing file', async timedOut => {
  const { root, run } = await fixture();
  let captures = 0;
  let writes = 0;
  const failingRun: Run = async (args, maxBytes, input): Promise<GitRunResult> => {
    if (args[0] === 'read-tree') captures++;
    if (args[0] === 'write-tree') writes++;
    if (args.includes('--stdin-paths')) {
      if (timedOut) await rm(join(root, 'transient.ts'));
      return { stdout: Buffer.alloc(0), code: 1, timedOut };
    }
    return run(args, maxBytes, input);
  };
  await expect(captureWorkspaceTree(root, failingRun))
    .rejects.toThrow(timedOut ? 'Workspace snapshot timed out' : 'Workspace snapshot failed');
  expect(captures).toBe(1);
  expect(writes).toBe(0);
}, 20_000);
