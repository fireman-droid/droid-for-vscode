import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';

export interface FileTransactionLock { release(): void }
export type FileTransactionLockOutcome =
  | ({ acquired: true } & FileTransactionLock)
  | { acquired: false; heldByPid: number };

interface Claim { readonly file: string; readonly pid: number; readonly token: string; readonly ticket?: number }
interface ClaimRequest {
  blocker(): number | undefined;
  release(): void;
}

/** Short synchronous admission for the synchronous session-lease API. */
export function tryAcquireFileTransactionLock(resource: string, options: {
  readonly pid?: number;
  readonly isPidAlive?: (pid: number) => boolean;
  readonly attempts?: number;
  readonly waitMs?: number;
} = {}): FileTransactionLockOutcome {
  const request = createRequest(resource, options.pid ?? process.pid, options.isPidAlive ?? isPidAlive);
  let heldByPid = 0;
  try {
    for (let attempt = 0; attempt < (options.attempts ?? 8); attempt++) {
      const blocker = request.blocker();
      if (blocker === undefined) return { acquired: true, release: request.release };
      heldByPid = blocker;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, options.waitMs ?? 4);
    }
  } catch (error) { releaseAfterFailure(request, error); }
  request.release();
  return { acquired: false, heldByPid };
}

/** The returned ownership spans awaits; always release it after the transaction. */
export async function acquireFileTransactionLock(resource: string, options: {
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
} = {}): Promise<FileTransactionLock> {
  options.signal?.throwIfAborted();
  const request = createRequest(resource, process.pid, isPidAlive);
  const deadline = Date.now() + (options.timeoutMs ?? 5_000);
  try {
    while (true) {
      options.signal?.throwIfAborted();
      if (request.blocker() === undefined) return { release: request.release };
      if (Date.now() >= deadline) throw new Error('Another window is still updating this file. Retry shortly.');
      await wait(10, undefined, { signal: options.signal });
    }
  } catch (error) { return releaseAfterFailure(request, error); }
}

function createRequest(resource: string, pid: number, alive: (pid: number) => boolean): ClaimRequest {
  fs.mkdirSync(path.dirname(resource), { recursive: true });
  const directory = fs.realpathSync(path.dirname(resource));
  const basename = path.basename(resource);
  const prefix = `.${process.platform === 'win32' ? basename.toLowerCase() : basename}.transaction-`;
  const token = randomUUID();
  const claim: Claim = { file: path.join(directory, `${prefix}${pid}-${token}.claim`), pid, token };
  let released = false;
  const release = () => {
    if (released) return;
    removeClaim(claim);
    released = true;
  };
  // Lamport bakery admission: announce choosing before reading other tickets.
  // A ticket is immutable, and ready is created only after its entire write.
  // Readers never interpret a partially written number as an earlier ticket.
  const peers = () => readClaims(directory, prefix, (candidate) => candidate === pid || alive(candidate));
  let ticket: number;
  try {
    fs.writeFileSync(claim.file, '', { flag: 'wx' });
    ticket = 1 + Math.max(0, ...peers().map((peer) => peer.ticket ?? 0));
    if (!Number.isSafeInteger(ticket)) throw new Error('The file transaction ticket limit was reached.');
    fs.writeFileSync(`${claim.file}.ticket`, String(ticket), { flag: 'wx' });
    fs.writeFileSync(`${claim.file}.ready`, '', { flag: 'wx' });
  } catch (error) { return releaseAfterFailure({ release }, error); }
  return {
    release,
    blocker() {
      for (const peer of peers()) {
        if (peer.token === token) continue;
        // Wait for choosing participants, then order equal tickets by token.
        // A participant arriving after this scan observes our published ticket
        // and chooses a later one, so it cannot enter beside the current owner.
        if (peer.ticket === undefined || peer.ticket < ticket ||
            peer.ticket === ticket && peer.token < token) return peer.pid;
      }
      return undefined;
    },
  };
}

function readClaims(directory: string, prefix: string, alive: (pid: number) => boolean): Claim[] {
  const claims: Claim[] = [];
  for (const name of fs.readdirSync(directory)) {
    if (!name.startsWith(prefix)) continue;
    const match = /^(\d+)-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.claim$/u.exec(name.slice(prefix.length));
    if (!match) continue;
    const claim: Claim = { file: path.join(directory, name), pid: Number(match[1]), token: match[2]! };
    // Names are unique for the lifetime of an acquisition. Removing a dead
    // claimant cannot remove a replacement owner, even after a delayed read.
    if (!alive(claim.pid)) { removeClaim(claim); continue; }
    if (!fs.existsSync(claim.file)) continue;
    if (!fs.existsSync(`${claim.file}.ready`)) { claims.push(claim); continue; }
    let text: string;
    try { text = fs.readFileSync(`${claim.file}.ticket`, 'utf8'); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      if (fs.existsSync(claim.file)) claims.push(claim);
      continue;
    }
    const ticket = Number(text);
    if (!/^\d+$/u.test(text) || !Number.isSafeInteger(ticket) || ticket < 1)
      throw new Error('A file transaction ticket is invalid.');
    claims.push({ ...claim, ticket });
  }
  return claims;
}

function removeClaim(claim: Claim): void {
  // Remove the announcement last, so interrupted cleanup remains discoverable.
  for (const file of [`${claim.file}.ready`, `${claim.file}.ticket`, claim.file]) {
    try { fs.unlinkSync(file); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
}

function releaseAfterFailure(lock: FileTransactionLock, error: unknown): never {
  try { lock.release(); }
  catch (cleanupError) { throw new AggregateError([error, cleanupError], 'File transaction admission and cleanup failed.'); }
  throw error;
}

function isPidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
}
