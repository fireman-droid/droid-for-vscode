import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

// Git's directory staging treats embedded repositories as gitlinks. Enumerate
// regular files instead so a folder containing several projects has real bytes.
export async function snapshotWorkspaceFiles(root: string): Promise<string[]> {
  const paths: string[] = [];
  const pending = [''];
  let entries = 0;
  while (pending.length) {
    const directory = pending.pop()!;
    for (const entry of await readdir(join(root, directory), { withFileTypes: true })) {
      if (++entries > 50_000) throw new Error('Snapshot file enumeration limit reached.');
      if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === '.venv') continue;
      const path = directory ? `${directory}/${entry.name}` : entry.name;
      if (entry.isDirectory()) pending.push(path);
      else if (entry.isFile()) paths.push(path);
    }
  }
  return paths;
}
