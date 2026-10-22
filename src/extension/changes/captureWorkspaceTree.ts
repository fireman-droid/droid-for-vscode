import { lstat, readlink } from 'node:fs/promises';
import { join } from 'node:path';
import { markSnapshotFileSize, snapshotWorkspaceFiles } from './snapshotWorkspaceFiles';
import type { GitRunResult } from './turnSnapshots';

type Run = (args: readonly string[], maxBytes: number, input?: Buffer) => Promise<GitRunResult>;

export interface CachedWorkspaceBlob {
  readonly mtimeNs: bigint;
  readonly ctimeNs: bigint;
  readonly size: bigint;
  readonly mode: string;
  readonly hash: string;
}

export type WorkspaceBlobCache = Map<string, CachedWorkspaceBlob>;

/** Build a fresh private index from disk bytes, independent of Git ignore/clean filters. */
export async function captureWorkspaceTree(
  root: string,
  run: Run,
  cache?: WorkspaceBlobCache,
): Promise<string> {
  try {
    return await captureWorkspaceTreeOnce(root, run, cache);
  } catch (error) {
    if (typeof error !== 'object' || error === null || !('code' in error) || error.code !== 'ENOENT') throw error;
    // A build/watch process can remove a file after enumeration. Re-enumerate
    // and reset the entire private index once; never publish a partial tree.
    return captureWorkspaceTreeOnce(root, run, cache);
  }
}

async function captureWorkspaceTreeOnce(
  root: string,
  run: Run,
  cache?: WorkspaceBlobCache,
): Promise<string> {
  const checked = async (args: readonly string[], maxBytes = 4096, input?: Buffer, paths?: readonly string[]) => {
    const result = await run(args, maxBytes, input);
    if (result.timedOut || result.code !== 0) {
      // Git does not expose a filesystem error code. Only a confirmed missing
      // input permits a retry; read/permission errors and timeouts stay fatal.
      if (!result.timedOut && paths) await Promise.all(paths.map(path => lstat(join(root, path))));
      throw new Error(result.timedOut ? `Workspace snapshot timed out (${args[0]}).` : `Workspace snapshot failed (${args[0]}).`);
    }
    return result.stdout;
  };
  const paths = await snapshotWorkspaceFiles(root);
  await checked(['read-tree', '--empty']);
  if (paths.length) {
    const entries: string[] = [];
    const seen = new Set<string>();
    const files: {
      path: string;
      mode: string;
      mtimeNs: bigint;
      ctimeNs: bigint;
      size: bigint;
    }[] = [];
    for (let offset = 0; offset < paths.length; offset += 64) {
      const batch = paths.slice(offset, offset + 64);
      const metadata = await Promise.all(batch.map(path => lstat(join(root, path), { bigint: true })));
      for (const [index, path] of batch.entries()) {
        const info = metadata[index]!;
        if (info.isSymbolicLink()) {
          markSnapshotFileSize(root, path, 0);
          const hash = (await checked(['hash-object', '-w', '--stdin'], 4096, Buffer.from(await readlink(join(root, path)))))
            .toString('utf8').trim();
          entries.push(`120000 ${hash}\t${path}\0`);
        } else if (info.isFile()) {
          if (!markSnapshotFileSize(root, path, Number(info.size))) {
            cache?.delete(path);
            continue;
          }
          seen.add(path);
          const mode = info.mode & 0o111n ? '100755' : '100644';
          const cached = cache?.get(path);
          if (
            cached !== undefined &&
            cached.mtimeNs === info.mtimeNs &&
            cached.ctimeNs === info.ctimeNs &&
            cached.size === info.size &&
            cached.mode === mode
          ) {
            entries.push(`${mode} ${cached.hash}\t${path}\0`);
          } else {
            files.push({
              path,
              mode,
              mtimeNs: info.mtimeNs,
              ctimeNs: info.ctimeNs,
              size: info.size,
            });
          }
        } else {
          throw new Error('A workspace file changed type while recording its baseline.');
        }
      }
    }
    if (cache !== undefined) {
      for (const cachedPath of cache.keys()) {
        if (!seen.has(cachedPath)) cache.delete(cachedPath);
      }
    }
    // hash-object reads every dirty file without running clean filters, while
    // unchanged files reuse verified stat->blob entries from this store.
    for (let offset = 0; offset < files.length; offset += 512) {
      const batch = files.slice(offset, offset + 512);
      const input = Buffer.from(batch.map(({ path }) => JSON.stringify(join(root, path).replaceAll('\\', '/'))).join('\n') + '\n');
      const hashes = (await checked(['hash-object', '-w', '--no-filters', '--stdin-paths'], batch.length * 42 + 4096, input,
        batch.map(({ path }) => path)))
        .toString('utf8').trim().split(/\r?\n/);
      if (hashes.length !== batch.length || hashes.some(hash => !/^[0-9a-f]{40}$/.test(hash)))
        throw new Error('Workspace snapshot returned an incomplete file set.');
      for (const [index, file] of batch.entries()) {
        const hash = hashes[index]!;
        entries.push(`${file.mode} ${hash}\t${file.path}\0`);
        cache?.set(file.path, {
          mtimeNs: file.mtimeNs,
          ctimeNs: file.ctimeNs,
          size: file.size,
          mode: file.mode,
          hash,
        });
      }
    }
    if (entries.length) {
      await checked(['update-index', '-z', '--index-info'], 4096, Buffer.from(entries.join('')));
    }
  } else {
    cache?.clear();
  }
  return (await checked(['write-tree'])).toString('utf8').trim();
}
