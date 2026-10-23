import { isSafeWorkspaceRelativePath } from '../../shared/validation/guards';

type Run = (root: string, args: readonly string[], maxBytes: number, input?: Buffer) => Promise<Buffer>;
interface Read { path: string; limit: number; resolve(value: Buffer | null): void; reject(error: unknown): void }
export class GitObjectTooLargeError extends Error {
  constructor() { super('File exceeds the text preview limit.'); }
}

/** Coalesces reads issued in one event-loop turn without delaying the first file. */
export function createGitTreeReader(run: Run, allowSymlinks = false) {
  const queues = new Map<string, Read[]>();
  const batch = async (root: string, tree: string, reads: Read[]) => {
    const listing = await run(root, ['--literal-pathspecs', 'ls-tree', '-l', '-z', tree, '--', ...reads.map(read => read.path)], 1024 * 1024);
    const entries = new Map<string, { mode: string; type: string; oid: string; size: number }>();
    for (const entry of listing.toString('utf8').split('\0')) {
      if (!entry) continue;
      const match = /^(\d+) (\w+) ([0-9a-f]+) +([0-9]+|-)\t([\s\S]+)$/.exec(entry);
      if (!match) throw new Error('Invalid Git object metadata.');
      entries.set(match[5]!, { mode: match[1]!, type: match[2]!, oid: match[3]!, size: Number(match[4]) });
    }
    const bounded: Array<Read & { oid: string; size: number }> = [];
    for (const read of reads) {
      const entry = entries.get(read.path);
      if (!entry) { read.resolve(null); continue; }
      if (entry.type !== 'blob' || !entry.mode.startsWith('100') && !(allowSymlinks && entry.mode === '120000')) {
        read.reject(new Error('This file type cannot be compared as text.')); continue;
      }
      if (!Number.isSafeInteger(entry.size) || entry.size < 0)
        throw new Error('Invalid Git object metadata.');
      if (entry.size > read.limit) read.reject(new GitObjectTooLargeError());
      else bounded.push({ ...read, oid: entry.oid, size: entry.size });
    }
    for (let index = 0; index < bounded.length;) {
      const chunk: typeof bounded = [];
      let bytes = 0;
      while (index < bounded.length && (!chunk.length || bytes + bounded[index]!.size <= 32 * 1024 * 1024)) {
        const item = bounded[index++]!; chunk.push(item); bytes += item.size;
      }
      const output = await run(root, ['cat-file', '--batch'], bytes + chunk.length * 128,
        Buffer.from(chunk.map(read => `${read.oid}\n`).join('')));
      let offset = 0;
      const values: Buffer[] = [];
      for (const read of chunk) {
        const end = output.indexOf(10, offset);
        if (end < 0) throw new Error('Incomplete Git object response.');
        const [oid, type, size] = output.subarray(offset, end).toString().split(' ');
        const next = end + 1 + read.size;
        if (oid !== read.oid || type !== 'blob' || Number(size) !== read.size || output[next] !== 10)
          throw new Error('Invalid Git object response.');
        values.push(Buffer.from(output.subarray(end + 1, next))); offset = next + 1;
      }
      if (offset !== output.length) throw new Error('Unexpected Git object response.');
      chunk.forEach((read, index) => read.resolve(values[index]!));
    }
  };
  return { read(root: string, tree: string, path: string, limit: number): Promise<Buffer | null> {
    if (!isSafeWorkspaceRelativePath(path)) return Promise.reject(new Error('Invalid review path.'));
    const key = JSON.stringify([root, tree]);
    let queue = queues.get(key);
    if (!queue) {
      queue = []; queues.set(key, queue);
      setImmediate(() => {
        const reads = queues.get(key)!; queues.delete(key);
        for (let index = 0; index < reads.length; index += 8) {
          const chunk = reads.slice(index, index + 8);
          void batch(root, tree, chunk).catch(error => chunk.forEach(read => read.reject(error)));
        }
      });
    }
    return new Promise((resolve, reject) => queue!.push({ path, limit, resolve, reject }));
  } };
}
