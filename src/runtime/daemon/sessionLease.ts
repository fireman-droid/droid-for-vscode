import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { tryAcquireFileTransactionLock } from '../storage/fileTransactionLock';

/**
 * Cross-window session leases (daemon Phase 3). The daemon does not
 * coordinate replacement operations (rewind/compact/fork) across
 * clients, so windows keep an exclusively locked lease registry:
 *
 *   ~/.droidvisx/sessions-attached.json -> { [sessionId]: { pid, ts } }
 *
 * A lease held by a dead pid is stale and may be preempted. The file
 * never contains credentials or session content.
 */

export interface SessionLeaseEntry {
  readonly pid: number;
  readonly ts: number;
}

export type SessionLeaseOutcome =
  | { readonly acquired: true }
  | { readonly acquired: false; readonly heldByPid: number };

type RegistryLockOutcome<T> =
  | { readonly acquired: true; readonly value: T }
  | { readonly acquired: false; readonly heldByPid: number };

interface RegistryLockOwner extends SessionLeaseEntry {
  readonly token: string;
}

/** Injectable seams for unit tests. */
export interface SessionLeaseDeps {
  readonly readFile: (file: string) => string | null;
  readonly writeFile: (file: string, contents: string) => void;
  readonly isPidAlive: (pid: number) => boolean;
  readonly pid: () => number;
  readonly now: () => number;
  readonly runExclusive: <T>(
    file: string,
    owner: SessionLeaseEntry,
    operation: () => T,
  ) => RegistryLockOutcome<T>;
}

export function defaultLeaseFile(): string {
  return path.join(os.homedir(), '.droidvisx', 'sessions-attached.json');
}

/**
 * Acquires (or refreshes) the lease for a session. Fails when ownership
 * is unavailable or a different, still-alive process holds it; leases
 * from dead processes are silently preempted.
 *
 * The complete read-check-write transaction runs under an exclusive
 * sibling lock file, so two windows cannot both observe a free lease
 * and report ownership.
 */
export function acquireSessionLease(
  file: string,
  sessionId: string,
  deps: Partial<SessionLeaseDeps> = {},
): SessionLeaseOutcome {
  const d = withDefaults(deps);
  const owner = { pid: d.pid(), ts: d.now() };
  const locked = d.runExclusive(file, owner, () => {
    const leases = readLeases(file, d.readFile);
    if (leases === null) {
      return { acquired: false, heldByPid: 0 } as const;
    }
    const existing = leases[sessionId];
    if (
      existing !== undefined &&
      existing.pid !== owner.pid &&
      d.isPidAlive(existing.pid)
    ) {
      return { acquired: false, heldByPid: existing.pid };
    }
    leases[sessionId] = owner;
    writeLeases(file, leases, d);
    return { acquired: true } as const;
  });
  if (!locked.acquired) {
    return locked;
  }
  return locked.value;
}

/** Releases a lease this process holds. Foreign live leases are kept. */
export function releaseSessionLease(
  file: string,
  sessionId: string,
  deps: Partial<SessionLeaseDeps> = {},
): void {
  const d = withDefaults(deps);
  const owner = { pid: d.pid(), ts: d.now() };
  const locked = d.runExclusive(file, owner, () => {
    const leases = readLeases(file, d.readFile);
    if (leases === null) {
      throw new Error('The session lease registry could not be read during release.');
    }
    const existing = leases[sessionId];
    if (existing === undefined) {
      return;
    }
    if (existing.pid !== owner.pid && d.isPidAlive(existing.pid)) {
      return;
    }
    delete leases[sessionId];
    writeLeases(file, leases, d);
  });
  if (!locked.acquired) throw new Error('The session lease registry is busy. Session ownership has not been released.');
}

/**
 * Reads and validates the lease registry. Only a missing file is empty;
 * unavailable or malformed registries are rejected without mutation.
 */
export function readLeases(
  file: string,
  readFile: SessionLeaseDeps['readFile'] = defaultReadFile,
): Record<string, SessionLeaseEntry> | null {
  let raw: string | null;
  try {
    raw = readFile(file);
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? {} : null;
  }
  if (raw === null) {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isPlainRecord(parsed)) {
    return null;
  }
  const leases: Record<string, SessionLeaseEntry> = Object.create(null) as Record<
    string,
    SessionLeaseEntry
  >;
  const sessionIds = Object.keys(parsed);
  if (sessionIds.length !== Reflect.ownKeys(parsed).length) {
    return null;
  }
  for (const sessionId of sessionIds) {
    const value = parsed[sessionId];
    if (sessionId.length === 0 || !isPlainRecord(value)) {
      return null;
    }
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== 2 ||
      !keys.includes('pid') ||
      !keys.includes('ts')
    ) {
      return null;
    }
    const pid = value['pid'];
    const ts = value['ts'];
    if (
      typeof pid !== 'number' ||
      !Number.isSafeInteger(pid) ||
      pid < 1 ||
      typeof ts !== 'number' ||
      !Number.isFinite(ts) ||
      ts < 0
    ) {
      return null;
    }
    leases[sessionId] = { pid, ts };
  }
  return leases;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function writeLeases(
  file: string,
  leases: Record<string, SessionLeaseEntry>,
  d: SessionLeaseDeps,
): void {
  d.writeFile(file, JSON.stringify(leases));
}

function withDefaults(deps: Partial<SessionLeaseDeps>): SessionLeaseDeps {
  const isPidAlive = deps.isPidAlive ?? defaultIsPidAlive;
  return {
    readFile: deps.readFile ?? defaultReadFile,
    writeFile: deps.writeFile ?? defaultWriteFile,
    isPidAlive,
    pid: deps.pid ?? (() => process.pid),
    now: deps.now ?? Date.now,
    runExclusive:
      deps.runExclusive ??
      ((file, owner, operation) =>
        defaultRunExclusive(file, owner, isPidAlive, operation)),
  };
}

const REGISTRY_LOCK_SUFFIX = '.lock';
const REGISTRY_LOCK_ATTEMPTS = 8;
const REGISTRY_LOCK_WAIT_MS = 4;
const REGISTRY_RENAME_RETRY_DELAYS_MS = [10, 20, 40, 80] as const;

function defaultRunExclusive<T>(
  file: string,
  owner: SessionLeaseEntry,
  isPidAlive: (pid: number) => boolean,
  operation: () => T,
): RegistryLockOutcome<T> {
  const deadline = Date.now() + REGISTRY_LOCK_ATTEMPTS * REGISTRY_LOCK_WAIT_MS;
  // Unique bakery claims serialize the entire transaction, including recovery
  // of the reusable legacy .lock name. A stale reader cannot unlink a newer
  // participant's lock while that participant is in the registry transaction.
  const transaction = tryAcquireFileTransactionLock(file, {
    pid: owner.pid, isPidAlive, attempts: REGISTRY_LOCK_ATTEMPTS, waitMs: REGISTRY_LOCK_WAIT_MS,
  });
  if (!transaction.acquired) return transaction;
  try {
    return runRegistryTransaction(file, owner, isPidAlive, operation, deadline);
  } finally {
    transaction.release();
  }
}

function runRegistryTransaction<T>(
  file: string,
  owner: SessionLeaseEntry,
  isPidAlive: (pid: number) => boolean,
  operation: () => T,
  deadline: number,
): RegistryLockOutcome<T> {
  const lockFile = `${file}${REGISTRY_LOCK_SUFFIX}`;
  const lockOwner: RegistryLockOwner = {
    ...owner,
    token: randomUUID(),
  };
  let heldByPid = 0;

  for (let attempt = 0; attempt < REGISTRY_LOCK_ATTEMPTS; attempt++) {
    if (defaultWriteLockExclusive(lockFile, lockOwner)) {
      try {
        return { acquired: true, value: operation() };
      } finally {
        defaultDeleteOwnedLock(lockFile, lockOwner.token);
      }
    }
    const existing = readRegistryLock(lockFile);
    heldByPid = existing?.pid ?? 0;
    if (existing === null || !isPidAlive(existing.pid)) {
      defaultDeleteLock(lockFile);
      continue;
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    waitSynchronously(Math.min(REGISTRY_LOCK_WAIT_MS, remaining));
  }
  return { acquired: false, heldByPid };
}

function defaultWriteLockExclusive(
  file: string,
  owner: RegistryLockOwner,
): boolean {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const contents = JSON.stringify(owner);
  const temporary = `${file}.${owner.token}.tmp`;
  try {
    fs.writeFileSync(temporary, contents, { flag: 'wx' });
    try {
      fs.linkSync(temporary, file);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        return false;
      }
      try {
        fs.writeFileSync(file, contents, { flag: 'wx' });
        return true;
      } catch (fallbackError) {
        if ((fallbackError as NodeJS.ErrnoException).code === 'EEXIST') {
          return false;
        }
        throw fallbackError;
      }
    }
  } finally {
    try {
      fs.unlinkSync(temporary);
    } catch {
      // The temporary file was never created or is already gone.
    }
  }
}

function readRegistryLock(file: string): RegistryLockOwner | null {
  const raw = defaultReadFile(file);
  if (raw === null) {
    return null;
  }
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) {
      return null;
    }
    const owner = value as Record<string, unknown>;
    return typeof owner.pid === 'number' &&
      Number.isInteger(owner.pid) &&
      owner.pid > 0 &&
      typeof owner.ts === 'number' &&
      typeof owner.token === 'string' &&
      owner.token.length > 0 &&
      owner.token.length <= 100
      ? { pid: owner.pid, ts: owner.ts, token: owner.token }
      : null;
  } catch {
    return null;
  }
}

function defaultDeleteOwnedLock(file: string, token: string): void {
  if (readRegistryLock(file)?.token !== token) {
    return;
  }
  defaultDeleteLock(file);
}

function defaultDeleteLock(file: string): void {
  try {
    fs.unlinkSync(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

function waitSynchronously(milliseconds: number): void {
  Atomics.wait(
    new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)),
    0,
    0,
    milliseconds,
  );
}

function defaultReadFile(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

function defaultWriteFile(file: string, contents: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${String(process.pid)}.tmp`;
  try {
    fs.writeFileSync(tmp, contents);
    for (let attempt = 0; ; attempt++) {
      try {
        fs.renameSync(tmp, file);
        return;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        const delay = REGISTRY_RENAME_RETRY_DELAYS_MS[attempt];
        if (
          process.platform !== 'win32' ||
          (code !== 'EPERM' && code !== 'EACCES' && code !== 'EBUSY') ||
          delay === undefined
        ) {
          throw error;
        }
        // Windows readers can briefly deny replacement. Keep the registry lock
        // and its old contents intact until the atomic rename succeeds.
        waitSynchronously(delay);
      }
    }
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      // Already renamed, or unavailable for cleanup after the original error.
    }
  }
}

function defaultIsPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the pid exists but belongs to another user.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}
