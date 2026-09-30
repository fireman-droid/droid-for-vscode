import { lstat, open, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import * as vscode from 'vscode';
import { isSafeWorkspaceRelativePath } from '../../shared/validation/guards';
import type { OperationRestoreEntry } from './reviewOperationScope';
import { MAX_REVIEW_UNDO_FILES } from '../../shared/protocol/reviewProtocol';
import { withUndoJournal } from './operationUndoJournal';

const MAX_BYTES = 32 * 1024 * 1024;
interface JournalEntry { path: string; before: string; after: string }
interface Journal { version: 3; root: string; entries: JournalEntry[] }

export async function readUndoFile(root: string, path: string) {
  if (!isSafeWorkspaceRelativePath(path)) throw new Error('The undo path is outside the workspace.');
  const canonicalRoot = await realpath(root);
  let target = canonicalRoot;
  for (const part of path.split('/')) {
    target = join(target, part);
    if ((await lstat(target)).isSymbolicLink()) throw new Error('Linked paths require manual restoration.');
  }
  const stat = await lstat(target);
  if (!stat.isFile() || stat.nlink !== 1 || stat.size > MAX_BYTES)
    throw new Error('This file cannot be safely restored automatically.');
  const samePath = (left: string, right: string) => process.platform === 'win32'
    ? left.toLowerCase() === right.toLowerCase() : left === right;
  if (vscode.workspace.textDocuments.some((document) => document.isDirty && document.uri.scheme === 'file' &&
    (samePath(resolve(document.uri.fsPath), resolve(root, path)) || samePath(resolve(document.uri.fsPath), target))))
    throw new Error('The file has unsaved editor changes.');
  const actual = await realpath(target);
  if (!samePath(actual, target) || !isSafeWorkspaceRelativePath(relative(canonicalRoot, actual).replaceAll('\\', '/')))
    throw new Error('The undo path changed.');
  return { root: canonicalRoot, target, bytes: await readFile(target), identity: `${stat.dev}:${stat.ino}` };
}

async function replaceChecked(root: string, path: string, expected: Buffer, next: Buffer, identity?: string): Promise<void> {
  const file = await readUndoFile(root, path);
  if (!file.bytes.equals(expected) || identity !== undefined && file.identity !== identity)
    throw new Error('The file changed since the undo preview.');
  const handle = await open(file.target, 'r+');
  try {
    const stat = await handle.stat();
    if (`${stat.dev}:${stat.ino}` !== file.identity || stat.nlink !== 1 ||
      !(await handle.readFile()).equals(expected)) throw new Error('The file changed before writing.');
    const latest = await readUndoFile(root, path);
    if (latest.identity !== file.identity || !latest.bytes.equals(expected))
      throw new Error('The file changed before writing.');
    let offset = 0;
    while (offset < next.length) {
      const { bytesWritten } = await handle.write(next, offset, next.length - offset, offset);
      if (bytesWritten === 0) throw new Error('The undo write did not make progress.');
      offset += bytesWritten;
    }
    await handle.truncate(next.length);
    await handle.sync();
  } finally { await handle.close(); }
  if (!(await readUndoFile(root, path)).bytes.equals(next))
    throw new Error('The file changed while applying undo.');
}

async function saveJournal(path: string, journal: Journal): Promise<void> {
  const temporary = `${path}.pending`;
  await writeFile(temporary, JSON.stringify(journal), { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, path);
}

export async function recoverOperationUndo(storageDir: string, root: string | undefined): Promise<void> {
  if (root === undefined) return;
  await withUndoJournal(storageDir, root, recoverJournal);
}

async function recoverJournal(path: string, root: string): Promise<void> {
  let text: string;
  try { text = await readFile(path, 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  if (text.length > MAX_BYTES * 3) throw new Error('The recovery journal exceeds the safe limit.');
  const value: unknown = JSON.parse(text);
  if (typeof value !== 'object' || value === null) throw new Error('Invalid undo recovery journal.');
  const journal = value as Journal;
  const canonicalRoot = await realpath(root);
  if (journal.version !== 3 || journal.root !== canonicalRoot || !Array.isArray(journal.entries) ||
    journal.entries.length > MAX_REVIEW_UNDO_FILES || !journal.entries.every((entry) => typeof entry === 'object' && entry !== null &&
      isSafeWorkspaceRelativePath(entry.path) && typeof entry.before === 'string' && typeof entry.after === 'string'))
    throw new Error('An older or different-workspace recovery journal requires manual recovery.');
  for (const entry of journal.entries) {
    const current = (await readUndoFile(root, entry.path)).bytes;
    if (!current.equals(Buffer.from(entry.before, 'base64')) && !current.equals(Buffer.from(entry.after, 'base64')))
      throw new Error(`Recovery stopped because ${entry.path} has newer edits.`);
  }
  for (const entry of [...journal.entries].reverse()) {
    const current = (await readUndoFile(root, entry.path)).bytes;
    const before = Buffer.from(entry.before, 'base64');
    if (current.equals(before)) continue;
    await replaceChecked(root, entry.path, Buffer.from(entry.after, 'base64'), before);
  }
  await rm(path);
}

export async function applyOperationUndo(
  storageDir: string, root: string, entries: readonly OperationRestoreEntry[], currentScope: () => boolean,
): Promise<{ complete: boolean; written: number; reason?: string }> {
  let written = 0;
  try {
    if (!entries.length || entries.some((entry) => entry.status !== 'restorable' || entry.current === null || entry.after === null))
      throw new Error('No complete operation undo plan is available.');
    if (entries.length > MAX_REVIEW_UNDO_FILES)
      throw new Error(`Automatic undo supports up to ${MAX_REVIEW_UNDO_FILES} files at a time. Undo individual files instead.`);
    if (entries.reduce((bytes, entry) => bytes + entry.current!.length + entry.after!.length, 0) > MAX_BYTES)
      throw new Error('The selected undo exceeds the safe size limit.');
    return await withUndoJournal(storageDir, root, async (path, canonicalRoot) => {
      if (!currentScope()) throw new Error('The review target is no longer current.');
      await recoverJournal(path, canonicalRoot);
      const journal: Journal = { version: 3, root: canonicalRoot, entries: [] };
      for (const entry of entries) {
        if (!currentScope()) throw new Error('The review target is no longer current.');
        const file = await readUndoFile(canonicalRoot, entry.path);
        if (!file.bytes.equals(entry.current!) || entry.identity !== undefined && file.identity !== entry.identity)
          throw new Error(`Undo stopped because ${entry.path} changed.`);
        journal.entries.push({ path: entry.path, before: entry.current!.toString('base64'), after: entry.after!.toString('base64') });
        // Write-ahead: a crash or partial write must never lose the original bytes.
        await saveJournal(path, journal);
        if (!currentScope()) throw new Error('The review target is no longer current.');
        await replaceChecked(canonicalRoot, entry.path, entry.current!, entry.after!, entry.identity);
        written += 1;
      }
      await rm(path);
      return { complete: true, written };
    });
  } catch (error) {
    return { complete: false, written, reason: error instanceof Error ? error.message : 'Undo failed.' };
  }
}
