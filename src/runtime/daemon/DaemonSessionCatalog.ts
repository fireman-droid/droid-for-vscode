import path from 'node:path';
import process from 'node:process';

import type { ConnectedDroid } from '@factory/droid-sdk';

import {
  isSafeSessionIdentifier,
  sanitizeSessionTitle,
} from '../SessionCatalog';

/** Most archived sessions projected for the drawer. */
export const DAEMON_ARCHIVED_LIST_LIMIT = 50;
/**
 * How many rows we ask the daemon for before workspace filtering.
 * The daemon client rejects `limit > 100` with a ZodError before the
 * request leaves the process (same schema cap `probe-get-messages.mjs`
 * hit on `sessions.getMessages`); the previous value of 200 made
 * every `listArchived` call fail silently (field logs: repeated
 * `archived-load-failed`). Archived sessions older than the newest
 * 100 rows stay invisible — an accepted boundary until the facade
 * exposes list pagination.
 */
export const DAEMON_LIST_FETCH_LIMIT = 100;
/** Most sessions returned by one content search. */
export const DAEMON_SEARCH_SESSION_LIMIT = 20;
/** Longest single-line snippet kept per search hit. */
export const DAEMON_SEARCH_SNIPPET_LIMIT = 240;

export interface ArchivedSessionEntry {
  readonly id: string;
  readonly title: string;
  readonly modifiedTime: string;
  readonly archivedTime: string;
}

export interface SessionSearchMatch {
  readonly id: string;
  readonly title: string;
  readonly modifiedTime: string | null;
  readonly snippet: string | null;
}

/**
 * Read-only session operations that only exist on the daemon
 * protocol: archive, unarchive, and cross-session content search.
 * Regular catalog listing stays on `FactorySessionCatalog`; the
 * daemon rows lack `createdTime` and the process path is untouched
 * in Phase 1.
 */
export class DaemonSessionCatalog {
  private readonly droid: ConnectedDroid;

  constructor(droid: ConnectedDroid) {
    this.droid = droid;
  }

  /** Resolves `true` when the daemon confirmed the archive. */
  async archive(sessionId: string): Promise<boolean> {
    const result = await this.droid.sessions.archive(sessionId);
    return result.success;
  }

  /** Resolves `true` when the daemon confirmed the unarchive. */
  async unarchive(sessionId: string): Promise<boolean> {
    const result = await this.droid.sessions.unarchive(sessionId);
    return result.success;
  }

  /**
   * Lists archived sessions belonging to `cwd`. The daemon list RPC
   * has no workspace filter, so rows are filtered client-side by
   * their recorded working directory.
   */
  async listArchived(cwd: string): Promise<ArchivedSessionEntry[]> {
    const rows = await this.droid.sessions.list({
      includeArchived: true,
      limit: DAEMON_LIST_FETCH_LIMIT,
    });
    const entries: ArchivedSessionEntry[] = [];
    for (const row of rows) {
      const archivedTime = projectDate(row.archivedTime);
      if (archivedTime === null) {
        continue;
      }
      const modifiedTime = projectDate(row.modifiedTime);
      if (
        modifiedTime === null ||
        !isSafeSessionIdentifier(row.id) ||
        !belongsToWorkspace(cwd, row.cwd, row.repoRoot)
      ) {
        continue;
      }
      entries.push({
        id: row.id,
        title: sanitizeSessionTitle(row.title ?? ''),
        modifiedTime,
        archivedTime,
      });
      if (entries.length === DAEMON_ARCHIVED_LIST_LIMIT) {
        break;
      }
    }
    return entries;
  }

  /**
   * Working states of every session the daemon currently tracks as
   * open, keyed by session id. Sessions missing from the map are not
   * open on the daemon (their turns cannot be running). The read is
   * an in-memory registry RPC — cheap enough to poll.
   */
  async readOpenedWorkingStates(): Promise<ReadonlyMap<string, string>> {
    const rows = await this.droid.sessions.listOpened();
    const states = new Map<string, string>();
    for (const row of rows) {
      if (isSafeSessionIdentifier(row.id)) {
        states.set(row.id, String(row.workingState));
      }
    }
    return states;
  }

  /**
   * Searches message content across all local sessions. Results are
   * not workspace-filtered; the daemon index is global and hits from
   * other workspaces are still useful to surface.
   */
  async search(query: string): Promise<SessionSearchMatch[]> {
    const result = await this.droid.sessions.search({
      query,
      limitSessions: DAEMON_SEARCH_SESSION_LIMIT,
      limitHitsPerSession: 1,
      contextChars: DAEMON_SEARCH_SNIPPET_LIMIT,
    });
    const matches: SessionSearchMatch[] = [];
    for (const row of result.sessions) {
      if (!isSafeSessionIdentifier(row.id)) {
        continue;
      }
      matches.push({
        id: row.id,
        title: sanitizeSessionTitle(row.title ?? ''),
        modifiedTime: projectDate(row.modifiedTime),
        snippet: projectSnippet(row.hits),
      });
      if (matches.length === DAEMON_SEARCH_SESSION_LIMIT) {
        break;
      }
    }
    return matches;
  }
}

function projectDate(value: unknown): string | null {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    return null;
  }
  return value.toISOString();
}

function projectSnippet(
  hits: readonly { readonly snippets: readonly string[] }[],
): string | null {
  for (const hit of hits) {
    for (const raw of hit.snippets) {
      if (typeof raw !== 'string') {
        continue;
      }
      const snippet = raw
        .replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, DAEMON_SEARCH_SNIPPET_LIMIT)
        .trim();
      if (snippet.length > 0) {
        return snippet;
      }
    }
  }
  return null;
}

function belongsToWorkspace(
  workspaceCwd: string,
  rowCwd: string | undefined,
  rowRepoRoot: string | undefined,
): boolean {
  return (
    sameDirectory(workspaceCwd, rowCwd) ||
    sameDirectory(workspaceCwd, rowRepoRoot)
  );
}

function sameDirectory(left: string, right: string | undefined): boolean {
  if (right === undefined || right.length === 0) {
    return false;
  }
  const a = path.resolve(left);
  const b = path.resolve(right);
  if (process.platform === 'win32') {
    return a.toLowerCase() === b.toLowerCase();
  }
  return a === b;
}
