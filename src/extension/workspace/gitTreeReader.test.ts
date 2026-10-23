import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { createGitTreeReader } from './gitTreeReader';
import { reviewGit } from '../review/reviewGitComparison';

const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });
it('reads a batch with bounded Git processes and exact bytes for Unicode, spaces, brackets, and missing paths', async () => {
  const root = await mkdtemp(join(tmpdir(), 'droid-git-batch-')); directories.push(root);
  await reviewGit(root, ['init', '--quiet']); await mkdir(join(root, '目录'));
  const paths = ['目录/汉字 [x].ts', ...Array.from({ length: 5 }, (_, index) => `file ${index}.ts`)];
  const bytes = Buffer.from('before\r\n\0binary bytes without trailing newline');
  await Promise.all(paths.map(path => writeFile(join(root, path), bytes)));
  await reviewGit(root, ['add', '.']); const tree = (await reviewGit(root, ['write-tree'])).toString().trim();
  const run = vi.fn(reviewGit); const reader = createGitTreeReader(run);
  const results = await Promise.all([...paths, 'missing.ts'].map(path => reader.read(root, tree, path, 1024)));
  results.slice(0, -1).forEach(result => expect(result).toEqual(bytes)); expect(results.at(-1)).toBeNull();
  expect(run).toHaveBeenCalledTimes(2); // One listing with sizes, one bounded blob batch.
  run.mockClear();
  await expect(reader.read(root, tree, paths[0]!, 2)).rejects.toThrow('preview limit');
  expect(run.mock.calls.some(([, args]) => args.includes('--batch'))).toBe(false);
  await expect(reader.read(root, 'missing-tree', paths[0]!, 1024)).rejects.toThrow();
});

it.each(['BAD', '-'])('does not treat an unreadable blob size (%s) as a missing/new file', async (size) => {
  const run = vi.fn(async () => Buffer.from(`100644 blob ${'a'.repeat(40)} ${size}\tfile.ts\0`));
  await expect(createGitTreeReader(run).read('/workspace', 'tree', 'file.ts', 1024)).rejects.toThrow('Invalid Git object metadata');
  expect(run).toHaveBeenCalledOnce();
});
