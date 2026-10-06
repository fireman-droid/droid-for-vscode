import { randomUUID } from 'node:crypto';
import { link, lstat, open, readFile, realpath, rename, rm } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import * as vscode from 'vscode';
import { isSafeWorkspaceRelativePath } from '../../shared/validation/guards';

export const MAX_UNDO_BYTES = 32 * 1024 * 1024;
export const equalUndoBytes = (left: Buffer | null, right: Buffer | null): boolean =>
  left === null || right === null ? left === right : left.equals(right);

export async function readUndoFile(root: string, path: string) {
  if (!isSafeWorkspaceRelativePath(path)) throw new Error('The undo path is outside the workspace.');
  const canonicalRoot = await realpath(root);
  const samePath = (left: string, right: string) => process.platform === 'win32'
    ? left.toLowerCase() === right.toLowerCase() : left === right;
  const target = resolve(canonicalRoot, path);
  if (vscode.workspace.textDocuments.some(document => document.isDirty && document.uri.scheme === 'file' &&
    (samePath(resolve(document.uri.fsPath), resolve(root, path)) || samePath(resolve(document.uri.fsPath), target))))
    throw new Error('The file has unsaved editor changes.');
  let partPath = canonicalRoot;
  for (const part of path.split('/')) {
    partPath = join(partPath, part);
    try {
      if ((await lstat(partPath)).isSymbolicLink()) throw new Error('Linked paths require manual restoration.');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return { root: canonicalRoot, target, bytes: null, identity: undefined, mode: 0o600 };
      throw error;
    }
  }
  const stat = await lstat(target);
  if (!stat.isFile() || stat.nlink !== 1 || stat.size > MAX_UNDO_BYTES)
    throw new Error('This file cannot be safely restored automatically.');
  const actual = await realpath(target);
  if (!samePath(actual, target) || !isSafeWorkspaceRelativePath(relative(canonicalRoot, actual).replaceAll('\\', '/')))
    throw new Error('The undo path changed.');
  return { root: canonicalRoot, target, bytes: await readFile(target), identity: `${stat.dev}:${stat.ino}`, mode: stat.mode };
}

/** Stage complete bytes before replacing a file; never leave a torn in-place write. */
export async function replaceUndoFile(
  root: string, path: string, expected: Buffer | null, next: Buffer | null, identity?: string, mode?: number,
): Promise<void> {
  const file = await readUndoFile(root, path);
  if (!equalUndoBytes(file.bytes, expected) || identity !== undefined && file.identity !== identity)
    throw new Error(`The file changed since the undo preview: ${path}`);
  const temporary = join(dirname(file.target), `.droid-undo-${randomUUID()}.tmp`);
  try {
    if (next !== null) {
      const handle = await open(temporary, 'wx', mode ?? file.mode);
      try { await handle.writeFile(next); await handle.sync(); } finally { await handle.close(); }
    }
    const latest = await readUndoFile(root, path);
    if (latest.identity !== file.identity || !equalUndoBytes(latest.bytes, expected))
      throw new Error(`The file changed before undo could write it: ${path}`);
    if (next === null) await rm(file.target);
    else if (expected === null) {
      // Linking an already complete temporary file is exclusive: never overwrite a new file.
      await link(temporary, file.target);
      await rm(temporary);
    } else await rename(temporary, file.target);
    if (!equalUndoBytes((await readUndoFile(root, path)).bytes, next))
      throw new Error(`The file changed while applying undo: ${path}`);
  } finally { await rm(temporary, { force: true }); }
}
