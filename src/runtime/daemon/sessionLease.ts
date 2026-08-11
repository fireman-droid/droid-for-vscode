import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

/**
 * Cross-window session leases (daemon Phase 3). The daemon does not
 * coordinate replacement operations (rewind/compact/fork) across
 * clients, so windows keep a best-effort lease registry:
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

/** Injectable seams for unit tests. */
export interface SessionLeaseDeps {
  readonly readFile: (file: string) => string | null;
  readonly writeFile: (file: string, contents: string) => void;
  readonly isPidAlive: (pid: number) => boolean;
  readonly pid: () => number;
  readonly now: () => number;
}

export function defaultLeaseFile(): string {
  return path.join(os.homedir(), '.droidvisx', 'sessions-attached.json');
}

/**
 * Acquires (or refreshes) the lease for a session. Fails only when a
 * different, still-alive process holds it; leases from dead processes
 * are silently preempted.
 */
export function acquireSessionLease(
  file: string,
  sessionId: string,
  deps: Partial<SessionLeaseDeps> = {},
): SessionLeaseOutcome {
  const d = withDefaults(deps);
  const leases = readLeases(file, d.readFile);
  const existing = leases[sessionId];
  if (
    existing !== undefined &&
    existing.pid !== d.pid() &&
    d.isPidAlive(existing.pid)
  ) {
    return { acquired: false, heldByPid: existing.pid };
  }
  leases[sessionId] = { pid: d.pid(), ts: d.now() };
  writeLeases(file, leases, d);
  return { acquired: true };
}

/** Releases a lease this process holds. Foreign live leases are kept. */
export function releaseSessionLease(
  file: string,
  sessionId: string,
  deps: Partial<SessionLeaseDeps> = {},
): void {
  const d = withDefaults(deps);
  const leases = readLeases(file, d.readFile);
  const existing = leases[sessionId];
  if (existing === undefined) {
    return;
  }
  if (existing.pid !== d.pid() && d.isPidAlive(existing.pid)) {
    return;
  }
  delete leases[sessionId];
  writeLeases(file, leases, d);
}

/**
 * Reads and validates the lease registry. The file is an external
 * trust boundary; a corrupt or malformed file reads as empty (leases
 * are advisory, so losing them degrades to Phase 2 behavior).
 */
export function readLeases(
  file: string,
  readFile: SessionLeaseDeps['readFile'] = defaultReadFile,
): Record<string, SessionLeaseEntry> {
  const raw = readFile(file);
  if (raw === null) {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return {};
  }
  const leases: Record<string, SessionLeaseEntry> = {};
  for (const [sessionId, value] of Object.entries(parsed)) {
    if (sessionId.length === 0 || sessionId.length > 200) {
      continue;
    }
    if (typeof value !== 'object' || value === null) {
      continue;
    }
    const entry = value as Record<string, unknown>;
    const pid = entry['pid'];
    const ts = entry['ts'];
    if (
      typeof pid !== 'number' ||
      !Number.isInteger(pid) ||
      pid < 1 ||
      typeof ts !== 'number'
    ) {
      continue;
    }
    leases[sessionId] = { pid, ts };
  }
  return leases;
}

function writeLeases(
  file: string,
  leases: Record<string, SessionLeaseEntry>,
  d: SessionLeaseDeps,
): void {
  d.writeFile(file, JSON.stringify(leases));
}

function withDefaults(deps: Partial<SessionLeaseDeps>): SessionLeaseDeps {
  return {
    readFile: deps.readFile ?? defaultReadFile,
    writeFile: deps.writeFile ?? defaultWriteFile,
    isPidAlive: deps.isPidAlive ?? defaultIsPidAlive,
    pid: deps.pid ?? (() => process.pid),
    now: deps.now ?? Date.now,
  };
}

function defaultReadFile(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function defaultWriteFile(file: string, contents: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${String(process.pid)}.tmp`;
  fs.writeFileSync(tmp, contents);
  fs.renameSync(tmp, file);
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
