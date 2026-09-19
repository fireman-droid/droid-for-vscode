import { execFile } from 'node:child_process';
import { resolve } from 'node:path';

import {
  type SessionSummary,
  type SessionWorktreeInfo,
} from '../../shared/protocol/sessions';
import {
  MAX_SESSION_CATALOG_ITEMS,
  MAX_WORKTREE_BRANCH_LENGTH,
  MAX_WORKTREE_PATH_LENGTH,
} from '../../shared/protocol/bounds';
import type {
  SessionCatalog,
  SessionCatalogEntry,
} from '../../runtime/catalog/SessionCatalog';
import type { SessionRecoveryPersistence } from '../recovery/SessionRecoveryStore';

/**
 * Host-side registry of daemon worktree sessions (worktree slice A).
 *
 * The registry is load-bearing, not decorative: probe evidence
 * (artifacts/probe-worktree-catalog.mjs) shows worktree sessions list
 * under their worktree cwd, so the workspace's session catalog never
 * returns them. Without this registry a worktree session would vanish
 * from the drawer the moment another session becomes active.
 *
 * Only identity and worktree binding are stored ({branch, path} per
 * session id, keyed by workspace cwd). Titles, message counts, and
 * modified times stay authoritative in the CLI session store and are
 * fetched per worktree path at catalog load time.
 */

export const WORKTREE_SESSIONS_VERSION = 1;
export const WORKTREE_SESSIONS_STORAGE_KEY = 'droidvisx.worktreeSessions';
/** Most worktree sessions remembered per workspace (oldest dropped). */
export const MAX_TRACKED_WORKTREE_SESSIONS = 24;
/** Persisted strings share the Bridge annotation bounds. */
const MAX_STORED_BRANCH_LENGTH = MAX_WORKTREE_BRANCH_LENGTH;
const MAX_STORED_PATH_LENGTH = MAX_WORKTREE_PATH_LENGTH;
const MAX_STORED_ID_LENGTH = 128;
const MAX_STORED_WORKSPACES = 16;

const GIT_TIMEOUT_MS = 5_000;
const MAX_GIT_OUTPUT_BYTES = 64 * 1024;

export interface WorktreeSessionRecord {
  /** Branch checked out in the worktree; '' when recovery failed. */
  readonly branch: string;
  /** Absolute worktree directory the session runs in. */
  readonly path: string;
}

interface StoredState {
  readonly version: typeof WORKTREE_SESSIONS_VERSION;
  readonly workspaces: Readonly<
    Record<string, Readonly<Record<string, WorktreeSessionRecord>>>
  >;
}

export class WorktreeSessionStore {
  /** workspace cwd -> insertion-ordered session id -> record. */
  private readonly workspaces = new Map<string, Map<string, WorktreeSessionRecord>>();
  private loaded = false;

  constructor(
    private readonly persistence: SessionRecoveryPersistence,
    private readonly storageKey = WORKTREE_SESSIONS_STORAGE_KEY,
  ) {}

  /** Idempotent; parses persisted state strictly and drops anything malformed. */
  load(): void {
    if (this.loaded) {
      return;
    }
    this.loaded = true;
    const parsed = parseStoredState(this.persistence.get<unknown>(this.storageKey));
    if (!parsed) {
      return;
    }
    for (const [cwd, sessions] of Object.entries(parsed.workspaces)) {
      const map = new Map<string, WorktreeSessionRecord>();
      for (const [sessionId, record] of Object.entries(sessions)) {
        map.set(sessionId, record);
      }
      if (map.size > 0) {
        this.workspaces.set(cwd, map);
      }
    }
  }

  list(cwd: string): ReadonlyMap<string, WorktreeSessionRecord> {
    this.load();
    return this.workspaces.get(cwd) ?? new Map();
  }

  get(cwd: string, sessionId: string): WorktreeSessionRecord | undefined {
    return this.list(cwd).get(sessionId);
  }

  async record(
    cwd: string,
    sessionId: string,
    record: WorktreeSessionRecord,
  ): Promise<void> {
    this.load();
    if (
      cwd.length === 0 ||
      sessionId.length === 0 ||
      sessionId.length > MAX_STORED_ID_LENGTH ||
      record.path.length === 0 ||
      record.path.length > MAX_STORED_PATH_LENGTH ||
      record.branch.length > MAX_STORED_BRANCH_LENGTH
    ) {
      return;
    }
    let sessions = this.workspaces.get(cwd);
    if (!sessions) {
      sessions = new Map();
      this.workspaces.set(cwd, sessions);
    }
    sessions.delete(sessionId);
    sessions.set(sessionId, record);
    while (sessions.size > MAX_TRACKED_WORKTREE_SESSIONS) {
      const oldest = sessions.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      sessions.delete(oldest);
    }
    while (this.workspaces.size > MAX_STORED_WORKSPACES) {
      const oldest = this.workspaces.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.workspaces.delete(oldest);
    }
    await this.persist();
  }

  async remove(cwd: string, sessionId: string): Promise<void> {
    this.load();
    const sessions = this.workspaces.get(cwd);
    if (!sessions?.delete(sessionId)) {
      return;
    }
    if (sessions.size === 0) {
      this.workspaces.delete(cwd);
    }
    await this.persist();
  }

  private async persist(): Promise<void> {
    const workspaces: Record<string, Record<string, WorktreeSessionRecord>> = {};
    for (const [cwd, sessions] of this.workspaces) {
      workspaces[cwd] = Object.fromEntries(sessions);
    }
    const state: StoredState = {
      version: WORKTREE_SESSIONS_VERSION,
      workspaces,
    };
    try {
      await this.persistence.update(this.storageKey, state);
    } catch {
      // Persistence loss degrades to the pre-slice behavior (worktree
      // rows missing after reload); never break session creation.
    }
  }
}

function parseStoredState(value: unknown): StoredState | null {
  if (!isRecord(value) || value.version !== WORKTREE_SESSIONS_VERSION) {
    return null;
  }
  const rawWorkspaces = value.workspaces;
  if (!isRecord(rawWorkspaces)) {
    return null;
  }
  const workspaces: Record<string, Record<string, WorktreeSessionRecord>> = {};
  for (const [cwd, rawSessions] of Object.entries(rawWorkspaces).slice(
    0,
    MAX_STORED_WORKSPACES,
  )) {
    if (cwd.length === 0 || !isRecord(rawSessions)) {
      continue;
    }
    const sessions: Record<string, WorktreeSessionRecord> = {};
    for (const [sessionId, rawRecord] of Object.entries(rawSessions).slice(
      0,
      MAX_TRACKED_WORKTREE_SESSIONS,
    )) {
      if (
        sessionId.length === 0 ||
        sessionId.length > MAX_STORED_ID_LENGTH ||
        !isRecord(rawRecord) ||
        typeof rawRecord.branch !== 'string' ||
        rawRecord.branch.length > MAX_STORED_BRANCH_LENGTH ||
        typeof rawRecord.path !== 'string' ||
        rawRecord.path.length === 0 ||
        rawRecord.path.length > MAX_STORED_PATH_LENGTH
      ) {
        continue;
      }
      sessions[sessionId] = {
        branch: rawRecord.branch,
        path: rawRecord.path,
      };
    }
    if (Object.keys(sessions).length > 0) {
      workspaces[cwd] = sessions;
    }
  }
  return { version: WORKTREE_SESSIONS_VERSION, workspaces };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export type GitExec = (args: readonly string[], cwd: string) => Promise<string | null>;

/** Never rejects; null means git failed (missing, timeout, non-repo). */
const defaultGitExec: GitExec = (args, cwd) =>
  new Promise((resolve) => {
    execFile(
      'git',
      [...args],
      {
        cwd,
        timeout: GIT_TIMEOUT_MS,
        maxBuffer: MAX_GIT_OUTPUT_BYTES,
        windowsHide: true,
      },
      (error, stdout) => {
        resolve(error === null ? stdout : null);
      },
    );
  });

/**
 * True when `cwd` sits inside a git working tree. Gates the drawer's
 * worktree entry: non-git and bare-repo workspaces must not render it
 * (design §4 fail-closed rows).
 */
export async function isGitWorkspace(
  cwd: string,
  exec: GitExec = defaultGitExec,
): Promise<boolean> {
  const output = await exec(['rev-parse', '--is-inside-work-tree'], cwd);
  return output !== null && output.trim() === 'true';
}

/**
 * Recovers the branch checked out at `worktreePath`. The daemon's
 * public SDK facade drops the InitializeSessionResult.worktree payload
 * (probe: artifacts/probe-worktree-create.mjs, `facadeExposesOnlyCwd`),
 * so git is the authoritative branch source. Returns null when the
 * lookup fails or HEAD is detached.
 */
export async function resolveWorktreeBranch(
  worktreePath: string,
  exec: GitExec = defaultGitExec,
): Promise<string | null> {
  const output = await exec(['rev-parse', '--abbrev-ref', 'HEAD'], worktreePath);
  if (output === null) {
    return null;
  }
  const branch = output.trim();
  return branch.length === 0 || branch === 'HEAD' ? null : branch;
}

/**
 * Everything the ChatController needs for worktree sessions, bundled
 * so the controller wiring stays one optional constructor argument.
 * `enabled` mirrors the activation-time runtime mode: only the daemon
 * has the native create-worktree-and-run channel.
 */
export interface WorktreeSessionsFeature {
  readonly enabled: boolean;
  readonly store: WorktreeSessionStore;
  isGitWorkspace(cwd: string): Promise<boolean>;
  resolveBranch(worktreePath: string): Promise<string | null>;
}

export function createWorktreeSessionsFeature(options: {
  readonly enabled: boolean;
  readonly persistence: SessionRecoveryPersistence;
  readonly exec?: GitExec;
}): WorktreeSessionsFeature {
  const exec = options.exec ?? defaultGitExec;
  return {
    enabled: options.enabled,
    store: new WorktreeSessionStore(options.persistence),
    isGitWorkspace: (cwd) => isGitWorkspace(cwd, exec),
    resolveBranch: (worktreePath) => resolveWorktreeBranch(worktreePath, exec),
  };
}

/**
 * Binds a freshly created worktree session to its worktree directory.
 * `sessionCwd` is the actual cwd the daemon reported for the session
 * (`runtime.getSessionCwd()`). Returns null without recording when the
 * daemon silently fell back to a plain session — probe evidence: a
 * non-git `cwd` yields a session in the workspace itself.
 */
export async function recordCreatedWorktreeSession(options: {
  readonly workspaceCwd: string;
  readonly sessionId: string;
  readonly sessionCwd: string | null;
  readonly feature: WorktreeSessionsFeature;
}): Promise<SessionWorktreeInfo | null> {
  const path = options.sessionCwd;
  if (path === null || path.length === 0) {
    return null;
  }
  if (isSameFsPath(path, options.workspaceCwd)) {
    return null;
  }
  // Git is the authoritative branch source: the SDK facade drops the
  // InitializeSessionResult.worktree payload (probe evidence). '' keeps
  // the row's worktree marker when recovery fails.
  const branch = (await options.feature.resolveBranch(path)) ?? '';
  const info: SessionWorktreeInfo = { branch, path };
  await options.feature.store.record(options.workspaceCwd, options.sessionId, info);
  return info;
}

function isSameFsPath(left: string, right: string): boolean {
  const l = resolve(left);
  const r = resolve(right);
  return process.platform === 'win32' ? l.toLowerCase() === r.toLowerCase() : l === r;
}

/**
 * Appends the workspace's registered worktree sessions to an already
 * projected catalog page. Worktree sessions list under their worktree
 * cwd (probe: artifacts/probe-worktree-catalog.mjs), so the base
 * catalog never contains them; identity comes from the registry while
 * titles and modified times stay authoritative in the CLI store via
 * per-worktree `listSessions`. Unreachable worktrees are skipped
 * fail-soft (stale detection is slice B).
 */
export async function appendWorktreeSessions(options: {
  readonly cwd: string;
  readonly items: readonly SessionSummary[];
  readonly store: WorktreeSessionStore;
  readonly listSessions: SessionCatalog['listSessions'];
  readonly project: (
    entries: readonly SessionCatalogEntry[],
  ) => readonly SessionSummary[];
}): Promise<readonly SessionSummary[]> {
  const records = options.store.list(options.cwd);
  if (records.size === 0) {
    return options.items;
  }
  const known = new Set(options.items.map((item) => item.id));
  const byPath = new Map<string, Map<string, WorktreeSessionRecord>>();
  for (const [sessionId, record] of records) {
    if (known.has(sessionId)) {
      continue;
    }
    let group = byPath.get(record.path);
    if (!group) {
      group = new Map();
      byPath.set(record.path, group);
    }
    group.set(sessionId, record);
  }
  const extras: SessionSummary[] = [];
  for (const [path, group] of byPath) {
    let result;
    try {
      result = await options.listSessions(path);
    } catch {
      continue;
    }
    if (result.status !== 'available') {
      continue;
    }
    const entries = result.sessions.filter((entry) => group.has(entry.id));
    for (const item of options.project(entries)) {
      const record = group.get(item.id);
      if (!record) {
        continue;
      }
      extras.push({
        ...item,
        worktree: { branch: record.branch, path: record.path },
      });
    }
  }
  if (extras.length === 0) {
    return options.items;
  }
  // ISO timestamps order lexicographically; newest first, one page cap.
  return [...options.items, ...extras]
    .sort((a, b) =>
      a.modifiedTime < b.modifiedTime ? 1 : a.modifiedTime > b.modifiedTime ? -1 : 0,
    )
    .slice(0, MAX_SESSION_CATALOG_ITEMS);
}
