import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, rename, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { acquireFileTransactionLock } from '../../runtime/storage/fileTransactionLock';

const JOURNAL = 'restore-recovery.json';
const rootKey = (root: string) => process.platform === 'win32' ? root.toLowerCase() : root;

/** One workspace owns its journal across recovery, all writes, and removal. */
export async function withUndoJournal<T>(
  storageDir: string, root: string, operation: (path: string, canonicalRoot: string) => Promise<T>,
): Promise<T> {
  const canonicalRoot = await realpath(root);
  const directory = join(storageDir, createHash('sha256').update(rootKey(canonicalRoot)).digest('hex'));
  await mkdir(directory, { recursive: true });
  const path = join(directory, JOURNAL);
  const ownership = await acquireFileTransactionLock(path);
  try {
    await migrateLegacyJournal(join(storageDir, JOURNAL), path, canonicalRoot);
    return await operation(path, canonicalRoot);
  } finally {
    ownership.release();
  }
}

async function migrateLegacyJournal(legacy: string, destination: string, root: string): Promise<void> {
  // Older builds shared one journal. Preserve foreign journals, and move a
  // matching interrupted transaction before allowing any new writes here.
  try { await stat(legacy); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  const ownership = await acquireFileTransactionLock(legacy);
  try {
    let text: string;
    try { text = await readFile(legacy, 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    const journal: unknown = JSON.parse(text);
    if (typeof journal !== 'object' || journal === null || !('root' in journal) || typeof journal.root !== 'string')
      throw new Error('The legacy undo journal requires manual recovery.');
    if (rootKey(journal.root) !== rootKey(root)) return;
    try {
      await stat(destination);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      await rename(legacy, destination);
      return;
    }
    throw new Error('Two interrupted undo journals exist for this workspace. Manual recovery is required.');
  } finally {
    ownership.release();
  }
}
