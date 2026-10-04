import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { GitCommitMode, GitStatusFile } from '../../shared/protocol/gitCommitFlow';

const execute = promisify(execFile);
const CHANGED = 'Files or the Git index changed since this commit preview. Refresh the file list and review it again.';
export interface GitCommitSnapshotReader {
  head(root: string): Promise<string>;
  identity(root: string): Promise<string>;
  file(root: string, path: string): Promise<string>;
  stagedMatches(root: string, paths: readonly string[]): Promise<boolean>;
}
const git = async (root: string, args: readonly string[]) =>
  (await execute('git', [...args], { cwd: root, windowsHide: true, timeout: 10_000, maxBuffer: 32 * 1024 * 1024, encoding: 'buffer' })).stdout;
const optionalGit = async (root: string, args: readonly string[]) => {
  try { return await git(root, args); }
  catch (error) { if ((error as { code?: unknown }).code === 1) return Buffer.alloc(0); throw error; }
};
export const readGitCommitSnapshot: GitCommitSnapshotReader = {
  async stagedMatches(root, paths) {
    const [diff, untracked] = await Promise.all([
      git(root, ['diff', '--name-only', '-z', '--no-renames', '--no-ext-diff', '--no-textconv', '--']),
      git(root, ['ls-files', '--others', '--exclude-standard', '-z']),
    ]);
    const changed = new Set([...diff.toString().split('\0'), ...untracked.toString().split('\0')]);
    return paths.every(path => !changed.has(path));
  },
  async head(root) {
    const [head, branch] = await Promise.all([
      optionalGit(root, ['rev-parse', '--verify', '--quiet', 'HEAD']),
      optionalGit(root, ['symbolic-ref', '--quiet', 'HEAD']),
    ]);
    return `${head.toString()}\0${branch.toString()}`;
  },
  async identity(root) {
    const [head, branch, index] = await Promise.all([
      optionalGit(root, ['rev-parse', '--verify', '--quiet', 'HEAD']),
      optionalGit(root, ['symbolic-ref', '--quiet', 'HEAD']),
      git(root, ['ls-files', '--stage', '-z']),
    ]);
    return createHash('sha256').update(head).update('\0').update(branch).update('\0').update(index).digest('hex');
  },
  async file(root, path) {
    const absolute = join(root, path);
    let info;
    try { info = await lstat(absolute); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'absent'; throw error; }
    if (info.isSymbolicLink()) return `link:${await readlink(absolute)}`;
    if (!info.isFile()) return 'unsupported';
    const hash = createHash('sha256').update(`${info.mode & 0o777}\0`);
    for await (const bytes of createReadStream(absolute)) hash.update(bytes);
    return hash.digest('hex');
  },
};
interface Snapshot { root: string; head: string; identity: string; files: Map<string, string>; paths: Set<string> }
export function createGitCommitSnapshots(reader: GitCommitSnapshotReader = readGitCommitSnapshot) {
  const saved = new Map<string, Snapshot>();
  const readFiles = async (root: string, paths: readonly string[]) => {
    const result = new Map<string, string>();
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(6, paths.length) }, async () => {
      while (next < paths.length) {
        const path = paths[next++]!;
        result.set(path, await reader.file(root, path));
      }
    }));
    return result;
  };
  const requireSnapshot = (id: string | undefined, root: string, paths: readonly string[]) => {
    const snapshot = id === undefined ? undefined : saved.get(id);
    if (!snapshot || snapshot.root !== resolve(root) || paths.some(path => !snapshot.paths.has(path)))
      throw new Error('This commit preview is no longer available. Refresh the file list.');
    return snapshot;
  };
  return {
    async capture(root: string, files: readonly GitStatusFile[]): Promise<string> {
      const identity = await reader.identity(root);
      const head = await reader.head(root);
      const contents = await readFiles(root, files.map(file => file.path));
      if (await reader.identity(root) !== identity) throw new Error(CHANGED);
      const id = randomUUID();
      saved.set(id, { root: resolve(root), head, identity, files: contents, paths: new Set(contents.keys()) });
      while (saved.size > 16) saved.delete(saved.keys().next().value!);
      return id;
    },
    async verify(id: string | undefined, root: string, paths: readonly string[], mode: GitCommitMode, index = true): Promise<void> {
      const snapshot = requireSnapshot(id, root, paths);
      if (await reader.head(root) !== snapshot.head) throw new Error(CHANGED);
      if (index && await reader.identity(root) !== snapshot.identity) throw new Error(CHANGED);
      if (mode === 'staged') return;
      const files = await readFiles(root, paths);
      if (paths.some(path => files.get(path) === 'unsupported' || files.get(path) !== snapshot.files.get(path)))
        throw new Error(CHANGED);
      if (!index && !await reader.stagedMatches(root, paths)) throw new Error(CHANGED);
    },
    forget(id: string | undefined): void { if (id) saved.delete(id); },
  };
}
