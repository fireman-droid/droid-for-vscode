import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

export function isSnapshotWorkspacePath(path: string): boolean {
  return !path.split('/').some(part => ['.git', 'node_modules', '.venv'].includes(part.toLowerCase()));
}

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
      const path = directory ? `${directory}/${entry.name}` : entry.name;
      if (!isSnapshotWorkspacePath(path)) continue;
      if (entry.isDirectory()) pending.push(path);
      else if (entry.isFile() || entry.isSymbolicLink()) paths.push(path);
    }
  }
  return paths;
}
