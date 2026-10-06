import { open, readFile, realpath, rename, rm } from 'node:fs/promises';
import { isSafeWorkspaceRelativePath } from '../../shared/validation/guards';
import type { OperationRestoreEntry } from './reviewOperationScope';
import { MAX_REVIEW_UNDO_FILES } from '../../shared/protocol/reviewProtocol';
import { withUndoJournal } from './operationUndoJournal';
import { equalUndoBytes, MAX_UNDO_BYTES, readUndoFile, replaceUndoFile } from './operationUndoDisk';
export { readUndoFile } from './operationUndoDisk';

interface JournalEntry { path: string; before: string | null; after: string | null; mode?: number }
interface Journal {
  version: 3 | 4; root: string; entries: JournalEntry[];
  phase?: 'applying' | 'committed'; operationKeys?: string[];
}
export interface OperationUndoOutcome { complete: boolean; written: number; reason?: string; recoveryRequired?: boolean }
const decode = (value: string | null) => value === null ? null : Buffer.from(value, 'base64');
const isKey = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);

async function readJournal(path: string, root: string): Promise<Journal | undefined> {
  let text: string;
  try { text = await readFile(path, 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  if (text.length > MAX_UNDO_BYTES * 3) throw new Error('The recovery journal exceeds the safe limit.');
  const journal = JSON.parse(text) as Journal;
  if (!journal || ![3, 4].includes(journal.version) || journal.root !== await realpath(root) ||
    !Array.isArray(journal.entries) || journal.entries.length > MAX_REVIEW_UNDO_FILES ||
    !journal.entries.every(entry => entry && isSafeWorkspaceRelativePath(entry.path) &&
      (entry.before === null || typeof entry.before === 'string') &&
      (entry.after === null || typeof entry.after === 'string') &&
      (entry.mode === undefined || Number.isSafeInteger(entry.mode) && entry.mode >= 0)) ||
    journal.version === 4 && (!['applying', 'committed'].includes(String(journal.phase)) ||
      !Array.isArray(journal.operationKeys) || !journal.operationKeys.every(isKey)))
    throw new Error('The undo recovery journal requires manual recovery.');
  return journal;
}

async function saveJson(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.pending`;
  const handle = await open(temporary, 'w', 0o600);
  try { await handle.writeFile(JSON.stringify(value), 'utf8'); await handle.sync(); }
  finally { await handle.close(); }
  await rename(temporary, path);
}

async function readReceipts(path: string): Promise<Set<string>> {
  let text: string;
  try { text = await readFile(`${path}.receipts`, 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Set(); throw error; }
  if (text.length > MAX_UNDO_BYTES) throw new Error('The undo receipt store exceeds the safe limit.');
  const keys: unknown = JSON.parse(text);
  if (!Array.isArray(keys) || !keys.every(isKey)) throw new Error('The undo receipt store is invalid.');
  return new Set(keys);
}

async function finishCommit(path: string, journal: Journal): Promise<void> {
  const keys = await readReceipts(path);
  for (const key of journal.operationKeys ?? []) keys.add(key);
  await saveJson(`${path}.receipts`, [...keys]);
  await rm(path);
}

/** Receipts are separate from review preferences and survive reloads and scope eviction. */
export async function readOperationUndoState(storageDir: string, root: string) {
  return withUndoJournal(storageDir, root, async (path, canonicalRoot) => {
    const undone = await readReceipts(path);
    const journal = await readJournal(path, canonicalRoot);
    if (journal?.phase === 'committed') for (const key of journal.operationKeys ?? []) undone.add(key);
    return { undone, ...(journal === undefined ? {} : {
      blocked: 'A previous undo has unfinished recovery. Reload the window; check Droid Logs if recovery is blocked.',
    }) };
  });
}

export async function recoverOperationUndo(storageDir: string, root: string | undefined): Promise<void> {
  if (root !== undefined) await withUndoJournal(storageDir, root, recoverJournal);
}

async function recoverJournal(path: string, root: string): Promise<void> {
  const journal = await readJournal(path, root);
  if (journal === undefined) return;
  if (journal.phase === 'committed') { await finishCommit(path, journal); return; }
  const failures: string[] = [];
  for (const entry of [...journal.entries].reverse()) {
    try {
      const current = (await readUndoFile(root, entry.path)).bytes;
      const before = decode(entry.before);
      if (equalUndoBytes(current, before)) continue;
      if (!equalUndoBytes(current, decode(entry.after))) throw new Error('The file has newer edits.');
      await replaceUndoFile(root, entry.path, decode(entry.after), before, undefined, entry.mode);
    } catch (error) { failures.push(`${entry.path}: ${error instanceof Error ? error.message : String(error)}`); }
  }
  if (failures.length) throw new Error(`Recovery incomplete: ${failures.join('; ')} Original bytes remain in ${path}`);
  await rm(path);
}

export async function applyOperationUndo(
  storageDir: string, root: string, entries: readonly OperationRestoreEntry[], currentScope: () => boolean,
): Promise<OperationUndoOutcome> {
  let written = 0;
  try {
    if (!entries.length || entries.some(entry => entry.status !== 'restorable'))
      throw new Error('No complete operation undo plan is available.');
    if (entries.length > MAX_REVIEW_UNDO_FILES)
      throw new Error(`Automatic undo supports up to ${MAX_REVIEW_UNDO_FILES} files at a time.`);
    if (entries.reduce((bytes, entry) => bytes + (entry.current?.length ?? 0) + (entry.after?.length ?? 0), 0) > MAX_UNDO_BYTES)
      throw new Error('The selected undo exceeds the safe size limit.');
    return await withUndoJournal(storageDir, root, async (path, canonicalRoot): Promise<OperationUndoOutcome> => {
      if (!currentScope()) throw new Error('The review target is no longer current.');
      await recoverJournal(path, canonicalRoot);
      const receipts = await readReceipts(path);
      const operationKeys = entries.flatMap(entry => entry.operationKeys ?? []);
      if (operationKeys.some(key => receipts.has(key))) throw new Error('These operations were already undone. Refresh Review.');
      const journal: Journal = { version: 4, root: canonicalRoot, phase: 'applying', operationKeys, entries: [] };
      for (const entry of entries) {
        const file = await readUndoFile(canonicalRoot, entry.path);
        if (!equalUndoBytes(file.bytes, entry.current) || entry.identity !== undefined && file.identity !== entry.identity)
          throw new Error(`Undo stopped because ${entry.path} changed.`);
        journal.entries.push({ path: entry.path, before: entry.current?.toString('base64') ?? null,
          after: entry.after?.toString('base64') ?? null, mode: file.mode });
      }
      // All original bytes are durable before the first workspace mutation.
      await saveJson(path, journal);
      let committed = false;
      try {
        for (const entry of entries) {
          if (!currentScope()) throw new Error('The review target is no longer current.');
          await replaceUndoFile(canonicalRoot, entry.path, entry.current, entry.after, entry.identity);
          written += 1;
        }
        await saveJson(path, { ...journal, phase: 'committed' });
        committed = true;
        await finishCommit(path, journal);
        return { complete: true, written };
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'Undo failed.';
        if (committed) return { complete: false, written, recoveryRequired: true,
          reason: `${reason} File undo completed; its durable receipt will be finalized on recovery.` };
        try {
          await recoverJournal(path, canonicalRoot);
          return { complete: false, written: 0, reason: `${reason} Changes from this undo attempt were rolled back.` };
        } catch (recoveryError) {
          return { complete: false, written, recoveryRequired: true,
            reason: `${reason} Automatic rollback stopped: ${recoveryError instanceof Error ? recoveryError.message : String(recoveryError)}` };
        }
      }
    });
  } catch (error) {
    return { complete: false, written, reason: error instanceof Error ? error.message : 'Undo failed.' };
  }
}
