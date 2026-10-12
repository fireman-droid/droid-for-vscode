import { lstat, readlink } from 'node:fs/promises';
import { join } from 'node:path';
import { snapshotWorkspaceFiles } from './snapshotWorkspaceFiles';
import type { GitRunResult } from './turnSnapshots';

type Run = (args: readonly string[], maxBytes: number, input?: Buffer) => Promise<GitRunResult>;

/** Build a fresh private index from disk bytes, independent of Git ignore/clean filters. */
export async function captureWorkspaceTree(root: string, run: Run): Promise<string> {
  const checked = async (args: readonly string[], maxBytes = 4096, input?: Buffer) => {
    const result = await run(args, maxBytes, input);
    if (result.timedOut || result.code !== 0)
      throw new Error(result.timedOut ? 'Workspace snapshot timed out.' : `Workspace snapshot failed (${args[0]}).`);
    return result.stdout;
  };
  const paths = await snapshotWorkspaceFiles(root);
  await checked(['read-tree', '--empty']);
  if (paths.length) {
    const entries: string[] = [];
    const files: { path: string; mode: string }[] = [];
    for (const path of paths) {
      const info = await lstat(join(root, path));
      if (info.isSymbolicLink()) {
        const hash = (await checked(['hash-object', '-w', '--stdin'], 4096, Buffer.from(await readlink(join(root, path)))))
          .toString('utf8').trim();
        entries.push(`120000 ${hash}\t${path}\0`);
      } else if (info.isFile()) files.push({ path, mode: info.mode & 0o111 ? '100755' : '100644' });
      else throw new Error('A workspace file changed type while recording its baseline.');
    }
    // hash-object reads every file, never reuses copied index stat entries, and
    // --no-filters preserves binary bytes and CRLF rather than running filters.
    if (files.length) {
      const input = Buffer.from(files.map(({ path }) => JSON.stringify(join(root, path).replaceAll('\\', '/'))).join('\n') + '\n');
      const hashes = (await checked(['hash-object', '-w', '--no-filters', '--stdin-paths'], files.length * 42 + 4096, input))
        .toString('utf8').trim().split(/\r?\n/);
      if (hashes.length !== files.length || hashes.some(hash => !/^[0-9a-f]{40}$/.test(hash)))
        throw new Error('Workspace snapshot returned an incomplete file set.');
      for (const [index, { path, mode }] of files.entries()) {
        entries.push(`${mode} ${hashes[index]!}\t${path}\0`);
      }
    }
    await checked(['update-index', '-z', '--index-info'], 4096, Buffer.from(entries.join('')));
  }
  return (await checked(['write-tree'])).toString('utf8').trim();
}
