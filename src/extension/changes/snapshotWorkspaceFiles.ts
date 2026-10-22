import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

export const MAX_SNAPSHOT_FILE_BYTES = 2 * 1024 * 1024;

const SNAPSHOT_IGNORED_DIRECTORIES = new Set([
  '.git',
  'node_modules',
  '.venv',
  'venv',
  '.pnpm-store',
  '.yarn',
  'artifacts',
  'dist',
  'out',
  'build',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.turbo',
  '.parcel-cache',
  '.cache',
  'coverage',
  'target',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.ruff_cache',
  '.gradle',
]);

const excludedLargeFilesByRoot = new Map<string, Set<string>>();

export function markSnapshotFileSize(root: string, path: string, size: number): boolean {
  if (size <= MAX_SNAPSHOT_FILE_BYTES) {
    excludedLargeFilesByRoot.get(root)?.delete(path);
    return true;
  }
  let excluded = excludedLargeFilesByRoot.get(root);
  if (excluded === undefined) {
    excluded = new Set();
    excludedLargeFilesByRoot.set(root, excluded);
  }
  excluded.add(path);
  return false;
}

export function clearSnapshotExcludedFiles(root?: string): void {
  if (root === undefined) excludedLargeFilesByRoot.clear();
  else excludedLargeFilesByRoot.delete(root);
}

export function isSnapshotWorkspacePath(path: string, root?: string): boolean {
  if (path.split('/').some(part => SNAPSHOT_IGNORED_DIRECTORIES.has(part.toLowerCase()))) {
    return false;
  }
  if (root !== undefined && excludedLargeFilesByRoot.get(root)?.has(path)) {
    return false;
  }
  return true;
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
