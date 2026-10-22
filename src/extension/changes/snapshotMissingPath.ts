import type { GitRunResult } from './turnSnapshots';

type Run = (args: readonly string[], maxBytes: number, input?: Buffer) => Promise<GitRunResult>;

/** Called only after ls-tree proved the exact path absent. Check its ancestors
 * together: absence below a gitlink, symlink or unavailable tree proves nothing. */
export async function snapshotMissingPath(tree: string, path: string, run: Run): Promise<boolean> {
  const parts = path.split('/');
  const parents = parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join('/'));
  const objects = [`${tree}^{tree}`, ...parents.map(parent => `${tree}:${parent}`)];
  const result = await run(['cat-file', '--batch-check'],
    Buffer.byteLength(objects.join('\n')) + objects.length * 128, Buffer.from(objects.join('\n') + '\n'));
  if (result.timedOut || result.code !== 0) return false;
  const lines = result.stdout.toString('utf8').trimEnd().split(/\r?\n/u);
  if (lines.length !== objects.length) return false;
  for (let index = 0; index < lines.length; index++) {
    if (/^[0-9a-f]+ tree \d+$/u.test(lines[index]!)) continue;
    if (index === 0 || lines[index] !== `${objects[index]} missing`) return false;
    // A gitlink can reference a commit not present in this object store. Its
    // missing object must still be distinguished from an absent directory.
    const entry = await run(['--literal-pathspecs', 'ls-tree', '-z', tree, '--', parents[index - 1]!], 4096);
    return !entry.timedOut && entry.code === 0 && entry.stdout.length === 0;
  }
  return true;
}
