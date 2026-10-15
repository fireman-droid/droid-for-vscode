import { open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

/** Explicit snapshots only: guest code never receives a filesystem handle. */
export async function readBtwSnapshots(cwd: string, names: readonly string[]): Promise<Record<string, string>> {
  const root = await realpath(cwd);
  const files: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const name of names) {
    const file = await realpath(path.resolve(root, name));
    const relative = path.relative(root, file);
    if (path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) {
      throw new Error(`Snapshot must be inside the project: ${name}`);
    }
    const handle = await open(file, 'r');
    try {
      if (!(await handle.stat()).isFile()) throw new Error(`Snapshot is not a regular file: ${name}`);
      const buffer = Buffer.alloc(65_537);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      if (bytesRead > 65_536) throw new Error(`Snapshot exceeds 64 KiB: ${name}`);
      if (buffer.subarray(0, bytesRead).includes(0)) throw new Error(`Snapshot is not a text file: ${name}`);
      files[name] = buffer.toString('utf8', 0, bytesRead);
    } finally { await handle.close(); }
  }
  return files;
}

const GIT_QUERIES = {
  status: ['status', '--short', '--untracked-files=normal'],
  diff: ['diff', '--no-ext-diff', '--no-textconv', '--'],
  staged_diff: ['diff', '--cached', '--no-ext-diff', '--no-textconv', '--'],
  log: ['log', '-20', '--no-show-signature', '--format=%h %s', '--'],
} as const;
export type BtwGitQuery = keyof typeof GIT_QUERIES;

export async function queryBtwGit(cwd: string, query: BtwGitQuery, signal?: AbortSignal): Promise<string> {
  const { stdout } = await promisify(execFile)('git', [
    '--no-pager', '--no-optional-locks', '-c', 'core.fsmonitor=false',
    ...GIT_QUERIES[query],
  ], { cwd, encoding: 'utf8', windowsHide: true, timeout: 5_000, maxBuffer: 512_000, signal });
  return stdout.length > 24_000 ? `${stdout.slice(0, 24_000)}\n[Output truncated]` : stdout;
}
