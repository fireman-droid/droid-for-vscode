import type { SessionTokenUsageState } from './tokenUsage';
import {
  MISSION_SESSION_ROLES,
  MISSION_STATES,
  SESSION_CATALOG_STATUSES,
  SESSION_HISTORY_STATUSES,
} from './bounds';

export type SessionCatalogStatus = (typeof SESSION_CATALOG_STATUSES)[number];

export type SessionHistoryStatus = (typeof SESSION_HISTORY_STATUSES)[number];

export type MissionState = (typeof MISSION_STATES)[number];

export type MissionSessionRole = (typeof MISSION_SESSION_ROLES)[number];

/**
 * Read-only mission identity of the active session, projected once
 * per history load from `loadSession()` (`mission.state`,
 * `decompSessionType`). Display only: the public SDK exposes no
 * mission control surface (no pause/resume/start RPC).
 */
export interface SessionMissionSummary {
  readonly state: MissionState | null;
  readonly role: MissionSessionRole | null;
}

export interface SessionsRefreshMessage {
  readonly type: 'sessions.refresh';
}

export interface SessionSelectMessage {
  readonly type: 'session.select';
  readonly sessionId: string;
}

export interface SessionNewMessage {
  readonly type: 'session.new';
}

/**
 * Creates a new session inside a daemon-managed git worktree
 * (`sessions.create({ worktree: true })`). Carries no branch name:
 * probe evidence (artifacts/probe-worktree-create.mjs) shows the
 * daemon owns branch and directory naming (`<currentBranch>-wt`, an
 * 8-char session-id suffix on collision) and its RPC accepts none.
 * Only actionable when the host snapshot advertised
 * `worktreeCreateAvailable`; the host re-checks and answers with a
 * session diagnostic otherwise (fail closed).
 */
export interface WorktreeCreateSessionMessage {
  readonly type: 'worktree.createSession';
}

/** Renames the currently active session. */
export interface SessionRenameMessage {
  readonly type: 'session.rename';
  readonly sessionId: string;
  readonly title: string;
}

/**
 * Marks or unmarks a catalog session as favorite. Favorites persist
 * through the droid CLI's private `.favorites` file (there is no
 * official write API); the readback loop is the public
 * `listSessions()` `isFavorite` flag.
 */
export interface SessionFavoriteMessage {
  readonly type: 'session.favorite';
  readonly sessionId: string;
  readonly favorite: boolean;
}

/**
 * Archives a non-active catalog session through the local droid
 * daemon (`daemon.archive_session`). Archived sessions leave the
 * regular catalog and appear in the drawer's Archived section.
 */
export interface SessionArchiveMessage {
  readonly type: 'session.archive';
  readonly sessionId: string;
}

/**
 * Restores an archived session through the local droid daemon
 * (`daemon.unarchive_session`) so it reappears in the catalog.
 */
export interface SessionUnarchiveMessage {
  readonly type: 'session.unarchive';
  readonly sessionId: string;
}

/**
 * Asks the host for the archived sessions of the current workspace.
 * The host answers with a `session.archived` state message.
 */
export interface SessionsArchivedRefreshMessage {
  readonly type: 'sessions.archivedRefresh';
}

/**
 * Searches message content across local sessions through the daemon
 * (`daemon.search_sessions`). Results return via a
 * `session.searchResults` state message.
 */
export interface SessionSearchMessage {
  readonly type: 'session.search';
  readonly query: string;
}

/**
 * Compacts the active session's context: Droid summarizes older
 * messages into a continuation session and the host adopts it.
 */
export interface SessionCompactMessage {
  readonly type: 'session.compact';
  readonly sessionId: string;
}

/**
 * Forks the active session: Droid copies the conversation into a new
 * session that the host adopts, leaving the original untouched.
 */
export interface SessionForkMessage {
  readonly type: 'session.fork';
  readonly sessionId: string;
}

export interface SessionSummary {
  readonly id: string;
  readonly title: string;
  readonly messageCount: number;
  readonly modifiedTime: string;
  readonly active: boolean;
  /** True when the CLI's `.favorites` file lists this session. */
  readonly isFavorite: boolean;
  /**
   * Present when the session catalog marks this session as part of a
   * mission decomposition (`decompSessionType`).
   */
  readonly missionRole?: MissionSessionRole;
  /**
   * Present when the session runs in a daemon-managed git worktree.
   * `branch` may be '' when git branch recovery failed; the row then
   * shows the worktree marker without a branch name.
   */
  readonly worktree?: SessionWorktreeInfo;
  /**
   * True when a turn of this session is still running on the daemon
   * (detached from this window, driven by another window, or by the
   * CLI). Hosts omit the flag instead of sending false; the drawer
   * row shows a quiet spinner while it is true. Updates stream via
   * `session.running`.
   */
  readonly running?: boolean;
}

/** Worktree binding of a catalog session (host-recovered from git). */
export interface SessionWorktreeInfo {
  readonly branch: string;
  readonly path: string;
}

export interface SessionCatalogState {
  readonly status: SessionCatalogStatus;
  readonly items: readonly SessionSummary[];
  readonly message?: string;
}

/** One archived session as reported by the daemon list. */
export interface ArchivedSessionSummary {
  readonly id: string;
  readonly title: string;
  readonly modifiedTime: string;
  readonly archivedTime: string;
}

export type SessionArchivedState =
  | {
      readonly status: 'loading';
      readonly items: readonly ArchivedSessionSummary[];
    }
  | {
      readonly status: 'ready';
      readonly items: readonly ArchivedSessionSummary[];
    }
  | {
      readonly status: 'error';
      readonly items: readonly ArchivedSessionSummary[];
      readonly message: string;
    };

/** One session matched by a cross-session content search. */
export interface SessionSearchHit {
  readonly id: string;
  readonly title: string;
  readonly modifiedTime: string | null;
  readonly snippet: string | null;
}

export type SessionSearchState =
  | {
      readonly status: 'ready';
      readonly query: string;
      readonly items: readonly SessionSearchHit[];
    }
  | {
      readonly status: 'error';
      readonly query: string;
      readonly items: readonly [];
      readonly message: string;
    };

/**
 * Token-usage breakdown of the active session: cumulative totals
 * (live `token_usage_update` stream or `loadSession` history seed)
 * plus the last turn completed in this window. Tokens only; the
 * Droid SDK exposes no USD cost.
 */
export interface SessionTokenUsageStateMessage {
  readonly type: 'session.tokenUsage';
  readonly sequence: number;
  readonly sessionId: string;
  readonly tokenUsage: SessionTokenUsageState;
}

/**
 * Archived sessions of the current workspace, listed through the
 * daemon sidecar. Answers a `sessions.archivedRefresh` request and
 * follows archive/unarchive operations.
 */
export interface SessionArchivedStateMessage {
  readonly type: 'session.archived';
  readonly sequence: number;
  readonly archived: SessionArchivedState;
}

/**
 * Incremental update of one catalog session's background running
 * flag (`SessionSummary.running`). Emitted when a detached daemon
 * turn starts being tracked or stops running, so the drawer spinner
 * appears and disappears without a full catalog refresh.
 */
export interface SessionRunningStateMessage {
  readonly type: 'session.running';
  readonly sequence: number;
  readonly sessionId: string;
  readonly running: boolean;
}

/**
 * Result of one cross-session content search through the daemon
 * sidecar. `query` echoes the request so the webview can drop stale
 * responses.
 */
export interface SessionSearchStateMessage {
  readonly type: 'session.searchResults';
  readonly sequence: number;
  readonly search: SessionSearchState;
}
