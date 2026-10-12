import { createHash, randomUUID } from 'node:crypto';
import { readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { acquireFileTransactionLock } from '../../runtime/storage/fileTransactionLock';

interface Scope { readonly sessionId: string; readonly turnId: string }
interface Owner extends Scope { readonly phase: 'preparing' | 'running' }
export interface WorkspaceTurnLease {
  dispatch(): Promise<void>;
  /** Only call after execution stopped and its final snapshot was attempted. */
  finish(): Promise<void>;
  /** A detached daemon can still write. Keep its durable owner for recovery. */
  detach(): Promise<void>;
}

/** Read the durable owner, which can outlive the displayed/retried turn. */
export async function readPendingWorkspaceTurn(root: string): Promise<Scope | undefined> {
  const owner = await readOwner(await ownerFile(root));
  return owner?.phase === 'running' ? { sessionId: owner.sessionId, turnId: owner.turnId } : undefined;
}

/** Serialize controlled turns across controllers/windows before reading their baseline. */
export async function acquireWorkspaceTurnLease(
  root: string, scope: Scope, signal?: AbortSignal, resumeOnly = false,
): Promise<WorkspaceTurnLease> {
  const resource = await ownerFile(root);
  const lock = await acquireFileTransactionLock(resource, { timeoutMs: Infinity, signal });
  try {
    signal?.throwIfAborted();
    const owner = await readOwner(resource);
    if (resumeOnly && (!owner || owner.sessionId !== scope.sessionId || owner.turnId !== scope.turnId))
      throw new Error('The original workspace capture window has ended. A final snapshot cannot be reconstructed from current files.');
    // The extension may have exited while the daemon kept running. A dead Host
    // process is not evidence that a different turn can safely start writing.
    if (owner?.phase === 'running' && (owner.sessionId !== scope.sessionId || owner.turnId !== scope.turnId))
      throw new Error(`This workspace has an unfinished captured turn. Reopen session ${owner.sessionId} to finish recording it before sending another turn.`);
    // Acquiring the transaction proves any previous preparing owner detached.
    // It had not submitted a request, so its abandoned reservation can be reused.
    let dispatched = owner?.phase === 'running';
    if (!dispatched) await saveOwner(resource, { ...scope, phase: 'preparing' });
    let finishing: Promise<void> | undefined;
    const finish = () => finishing ??= (async () => {
      await unlink(resource);
      lock.release();
    })();
    return {
      async dispatch() {
        await saveOwner(resource, { ...scope, phase: 'running' });
        dispatched = true;
      },
      finish,
      async detach() { if (dispatched) lock.release(); else await finish(); },
    };
  } catch (error) {
    lock.release();
    throw error;
  }
}

/** Complete cleanup if the Host exited after persisting after, before releasing its lease. */
export async function releaseCompletedWorkspaceTurn(root: string, scope: Scope): Promise<void> {
  const resource = await ownerFile(root);
  const matches = (owner: Owner | undefined) => owner?.sessionId === scope.sessionId && owner.turnId === scope.turnId;
  if (!matches(await readOwner(resource))) return;
  const lock = await acquireFileTransactionLock(resource);
  try { if (matches(await readOwner(resource))) await unlink(resource); }
  finally { lock.release(); }
}

async function ownerFile(root: string): Promise<string> {
  const canonical = await realpath(root);
  const key = createHash('sha256').update(process.platform === 'win32' ? canonical.toLowerCase() : canonical).digest('hex');
  return join(homedir(), '.droidvisx', 'workspace-turns', `${key}.json`);
}

async function readOwner(resource: string): Promise<Owner | undefined> {
  try {
    const value: unknown = JSON.parse(await readFile(resource, 'utf8'));
    if (!value || typeof value !== 'object' ||
        typeof (value as Owner).sessionId !== 'string' || typeof (value as Owner).turnId !== 'string' ||
        !['preparing', 'running'].includes((value as Owner).phase))
      throw new Error('The workspace turn owner could not be read.');
    return value as Owner;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return undefined;
  }
}

async function saveOwner(resource: string, owner: Owner): Promise<void> {
  const pending = `${resource}.${randomUUID()}.tmp`;
  try {
    await writeFile(pending, JSON.stringify(owner), { flag: 'wx', mode: 0o600, flush: true });
    await rename(pending, resource);
  } finally {
    await unlink(pending).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; });
  }
}
