import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { groupSessions } from './sessionGroups';
export { groupSessions } from './sessionGroups';

import { MAX_SESSION_SEARCH_QUERY_LENGTH } from '../../../shared/protocol/bounds';
import {
  type SessionArchivedState,
  type SessionCatalogState,
  type SessionSearchState,
  type SessionSummary,
} from '../../../shared/protocol/sessions';
import {
  ArchiveIcon,
  CheckCircleIcon,
  ChevronIcon,
  ForkIcon,
  RenameIcon,
  SessionIcon,
  StarIcon,
  UnarchiveIcon,
} from './sessionDrawerIcons';

interface SessionDrawerProps {
  readonly sessions: SessionCatalogState;
  readonly archived:
    | SessionArchivedState
    | { readonly status: 'idle'; readonly items: readonly [] };
  readonly sessionSearch: SessionSearchState | null;
  readonly actionsDisabled: boolean;
  /**
   * Renders the quiet "New session in a worktree" option. Only true
   * when the host advertised the capability (daemon runtime mode and
   * a git workspace); absent or false keeps the entry unrendered
   * (fail closed, no half-available hint).
   */
  readonly worktreeCreateAvailable?: boolean;
  /**
   * Monotonic `/sessions` navigation counter; each increment opens
   * the drawer (slash-parity S2 navigation rows).
   */
  readonly openSignal?: number;
  readonly onCreateWorktreeSession?: () => void;
  readonly onSelectSession: (sessionId: string) => void;
  readonly onRenameSession: (sessionId: string, title: string) => void;
  readonly onForkSession: (sessionId: string) => void;
  readonly onToggleFavorite: (sessionId: string, favorite: boolean) => void;
  readonly onArchiveSession: (sessionId: string) => void;
  readonly onUnarchiveSession: (sessionId: string) => void;
  readonly onRefreshArchived: () => void;
  readonly onSearchContent: (query: string) => void;
}

const MODIFIED_TIME_FORMAT = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

/**
 * Chat history as a right-anchored popover under the header clock
 * button (Cursor form, spec §2.1): search crown, relative-time
 * groups, 28px rows with hover-revealed actions, and the Archived
 * fold at the bottom. Dates left the rows — grouping expresses them,
 * the exact stamp lives in each row's hover title.
 */
export const SessionDrawer = memo(function SessionDrawer({
  sessions,
  archived,
  sessionSearch,
  actionsDisabled,
  worktreeCreateAvailable,
  openSignal = 0,
  onCreateWorktreeSession,
  onSelectSession,
  onRenameSession,
  onForkSession,
  onToggleFavorite,
  onArchiveSession,
  onUnarchiveSession,
  onRefreshArchived,
  onSearchContent,
}: SessionDrawerProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState(false);
  const pendingActionRef = useRef(false);
  const previousSessionsRef = useRef(sessions);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (previousSessionsRef.current !== sessions) {
      previousSessionsRef.current = sessions;
      pendingActionRef.current = false;
      setPendingAction(false);
    }
  }, [sessions]);

  const lastOpenSignalRef = useRef(openSignal);
  useEffect(() => {
    if (openSignal !== lastOpenSignalRef.current) {
      lastOpenSignalRef.current = openSignal;
      setOpen(true);
    }
  }, [openSignal]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
      }
    };
    // A popover closes on any outside press (Cursor behavior); the
    // trigger itself still toggles through its own click handler.
    const handlePointerDown = (event: PointerEvent): void => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('pointerdown', handlePointerDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [open]);

  const normalizedQuery = query.trim().toLowerCase();
  const filteredSessions = useMemo(
    () =>
      normalizedQuery.length === 0
        ? sessions.items
        : sessions.items.filter(
            (session) =>
              session.title.toLowerCase().includes(normalizedQuery) ||
              session.id.toLowerCase().includes(normalizedQuery),
          ),
    [normalizedQuery, sessions.items],
  );
  const sessionGroups = useMemo(
    () => groupSessions(filteredSessions),
    [filteredSessions],
  );
  const operationLoading = sessions.status === 'loading';
  const disabled = actionsDisabled || operationLoading || pendingAction;

  const runOnce = (action: () => void): void => {
    if (disabled || pendingActionRef.current) {
      return;
    }
    pendingActionRef.current = true;
    setPendingAction(true);
    action();
  };

  const submitContentSearch = (): void => {
    const trimmed = query.trim();
    if (trimmed.length === 0 || trimmed.length > MAX_SESSION_SEARCH_QUERY_LENGTH) {
      return;
    }
    onSearchContent(trimmed);
  };

  const toggleArchived = (): void => {
    const next = !archivedOpen;
    setArchivedOpen(next);
    if (next && archived.status === 'idle') {
      onRefreshArchived();
    }
  };

  const catalogIds = useMemo(
    () => new Set(sessions.items.map(({ id }) => id)),
    [sessions.items],
  );

  return (
    <div className="dvx-session-popover-root" ref={rootRef}>
      <button
        type="button"
        className="dvx-icon-button dvx-session-toggle"
        aria-label="Sessions"
        aria-expanded={open}
        aria-controls="dvx-session-drawer"
        onClick={() => setOpen((current) => !current)}
      >
        <SessionIcon />
      </button>
      {open ? (
        <aside
          id="dvx-session-drawer"
          className="dvx-session-drawer"
          aria-label="Session history"
        >
          <label className="dvx-visually-hidden" htmlFor="dvx-session-search">
            Search sessions
          </label>
          <input
            id="dvx-session-search"
            className="dvx-session-search"
            type="search"
            value={query}
            placeholder="Search chats · Enter searches content"
            autoComplete="off"
            maxLength={MAX_SESSION_SEARCH_QUERY_LENGTH}
            onChange={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                submitContentSearch();
              }
            }}
          />
          <CatalogStatus sessions={sessions} pending={pendingAction} />
          {filteredSessions.length > 0 ? (
            <nav className="dvx-session-nav" aria-label="Session history">
              {sessionGroups.map((group) => (
                <section
                  key={group.key}
                  className="dvx-session-group"
                  aria-label={group.label ?? undefined}
                >
                  {group.label !== null ? (
                    <h3 className="dvx-session-group-label">{group.label}</h3>
                  ) : null}
                  <ul className="dvx-session-list">
                    {group.items.map((session) => (
                      <SessionRow
                        key={session.id}
                        session={session}
                        disabled={disabled}
                        onSelect={(sessionId) =>
                          // Selecting navigates: the popover closes and
                          // the chat view takes over immediately, like
                          // Cursor's history list.
                          runOnce(() => {
                            setOpen(false);
                            onSelectSession(sessionId);
                          })
                        }
                        onRename={onRenameSession}
                        onFork={(sessionId) => runOnce(() => onForkSession(sessionId))}
                        onToggleFavorite={(sessionId, favorite) =>
                          runOnce(() => onToggleFavorite(sessionId, favorite))
                        }
                        onArchive={(sessionId) =>
                          runOnce(() => onArchiveSession(sessionId))
                        }
                      />
                    ))}
                  </ul>
                </section>
              ))}
            </nav>
          ) : normalizedQuery.length > 0 ||
            sessions.status === 'ready' ||
            sessions.status === 'idle' ? (
            <p className="dvx-session-empty">
              {normalizedQuery.length > 0
                ? 'No sessions match your search.'
                : sessions.status === 'ready'
                  ? 'No Droid sessions found.'
                  : 'Session history has not loaded yet.'}
            </p>
          ) : null}
          {sessionSearch !== null ? (
            <ContentMatches
              search={sessionSearch}
              catalogIds={catalogIds}
              disabled={disabled}
              onSelect={(sessionId) =>
                // Same navigation contract as the catalog rows.
                runOnce(() => {
                  setOpen(false);
                  onSelectSession(sessionId);
                })
              }
            />
          ) : null}
          {worktreeCreateAvailable === true && onCreateWorktreeSession !== undefined ? (
            // Our worktree entry survives the Cursor restyle as a
            // quiet secondary row at the popover foot (spec §2.1:
            // features stay, chrome submits to the popover language).
            <button
              type="button"
              className="dvx-session-worktree-new"
              disabled={disabled}
              onClick={() =>
                runOnce(() => {
                  setOpen(false);
                  onCreateWorktreeSession();
                })
              }
            >
              New session in a worktree…
            </button>
          ) : null}
          <ArchivedSection
            archived={archived}
            open={archivedOpen}
            disabled={disabled}
            onToggle={toggleArchived}
            onUnarchive={(sessionId) => runOnce(() => onUnarchiveSession(sessionId))}
          />
        </aside>
      ) : null}
    </div>
  );
});

/**
 * Daemon content-search results. Rows only navigate when the hit is
 * part of the current workspace catalog; hits from other workspaces
 * render as plain text.
 */
function ContentMatches({
  search,
  catalogIds,
  disabled,
  onSelect,
}: {
  readonly search: SessionSearchState;
  readonly catalogIds: ReadonlySet<string>;
  readonly disabled: boolean;
  readonly onSelect: (sessionId: string) => void;
}): React.JSX.Element {
  return (
    <section
      className="dvx-session-group dvx-session-matches"
      aria-label="Content matches"
    >
      <h3 className="dvx-session-group-label">Content matches · “{search.query}”</h3>
      {search.status === 'error' ? (
        <p className="dvx-session-status dvx-error-text" role="alert">
          {search.message}
        </p>
      ) : search.items.length === 0 ? (
        <p className="dvx-session-empty">No content matches.</p>
      ) : (
        <ul className="dvx-session-list">
          {search.items.map((hit) => {
            const selectable = catalogIds.has(hit.id);
            const body = (
              <>
                <span className="dvx-session-row-title">{hit.title}</span>
                {hit.snippet !== null ? (
                  <span className="dvx-session-match-snippet">{hit.snippet}</span>
                ) : null}
              </>
            );
            const stampTitle =
              hit.modifiedTime !== null
                ? formatModifiedTime(hit.modifiedTime)
                : undefined;
            return (
              <li key={hit.id} className="dvx-session-row-shell">
                {selectable ? (
                  <button
                    type="button"
                    className="dvx-session-row dvx-session-match"
                    title={stampTitle}
                    disabled={disabled}
                    onClick={() => onSelect(hit.id)}
                  >
                    {body}
                  </button>
                ) : (
                  <div
                    className="dvx-session-row dvx-session-match dvx-session-match-remote"
                    title="This session belongs to another workspace"
                  >
                    {body}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Collapsible list of archived sessions with restore actions. */
function ArchivedSection({
  archived,
  open,
  disabled,
  onToggle,
  onUnarchive,
}: {
  readonly archived:
    | SessionArchivedState
    | { readonly status: 'idle'; readonly items: readonly [] };
  readonly open: boolean;
  readonly disabled: boolean;
  readonly onToggle: () => void;
  readonly onUnarchive: (sessionId: string) => void;
}): React.JSX.Element {
  return (
    <section
      className="dvx-session-group dvx-session-archived"
      aria-label="Archived sessions"
    >
      <button
        type="button"
        className="dvx-session-archived-toggle"
        aria-expanded={open}
        onClick={onToggle}
      >
        <span
          aria-hidden="true"
          className={
            open
              ? 'dvx-session-archived-chevron dvx-session-archived-chevron-open'
              : 'dvx-session-archived-chevron'
          }
        >
          <ChevronIcon />
        </span>
        Archived
        {archived.status === 'ready' && archived.items.length > 0
          ? ` (${archived.items.length})`
          : ''}
      </button>
      {open ? (
        archived.status === 'error' ? (
          <p className="dvx-session-status dvx-error-text" role="alert">
            {archived.message}
          </p>
        ) : archived.status === 'loading' || archived.status === 'idle' ? (
          <p className="dvx-session-status" role="status">
            Loading archived sessions…
          </p>
        ) : archived.items.length === 0 ? (
          <p className="dvx-session-empty">No archived sessions.</p>
        ) : (
          <ul className="dvx-session-list">
            {archived.items.map((session) => (
              <li key={session.id} className="dvx-session-row-shell">
                <div
                  className="dvx-session-row dvx-session-row-static"
                  title={`Archived ${formatModifiedTime(session.archivedTime)}`}
                >
                  <span className="dvx-session-row-title">{session.title}</span>
                </div>
                <button
                  type="button"
                  className="dvx-session-rename"
                  aria-label={`Restore ${session.title} from the archive`}
                  title="Restore from archive"
                  disabled={disabled}
                  onClick={() => onUnarchive(session.id)}
                >
                  <UnarchiveIcon />
                </button>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </section>
  );
}

function CatalogStatus({
  sessions,
  pending,
}: {
  readonly sessions: SessionCatalogState;
  readonly pending: boolean;
}): React.JSX.Element | null {
  if (sessions.status === 'loading' || pending) {
    return (
      <p className="dvx-session-status" role="status">
        {sessions.status === 'loading' ? 'Loading sessions…' : 'Waiting for Droid…'}
      </p>
    );
  }
  if (sessions.status === 'error') {
    return (
      <p className="dvx-session-status dvx-error-text" role="alert">
        {sessions.message || 'Session history could not be loaded.'}
      </p>
    );
  }
  return null;
}

function SessionRow({
  session,
  disabled,
  onSelect,
  onRename,
  onFork,
  onToggleFavorite,
  onArchive,
}: {
  readonly session: SessionSummary;
  readonly disabled: boolean;
  readonly onSelect: (sessionId: string) => void;
  readonly onRename: (sessionId: string, title: string) => void;
  readonly onFork: (sessionId: string) => void;
  readonly onToggleFavorite: (sessionId: string, favorite: boolean) => void;
  readonly onArchive: (sessionId: string) => void;
}): React.JSX.Element {
  const [renaming, setRenaming] = useState(false);
  const [renameText, setRenameText] = useState(session.title);

  useEffect(() => {
    setRenaming(false);
    setRenameText(session.title);
  }, [session.title]);

  const submitRename = (): void => {
    setRenaming(false);
    const trimmed = renameText.trim();
    if (trimmed.length > 0 && trimmed !== session.title) {
      onRename(session.id, trimmed);
    } else {
      setRenameText(session.title);
    }
  };

  if (renaming) {
    return (
      <li>
        <div className="dvx-session-row dvx-session-row-renaming">
          <input
            className="dvx-session-rename-input"
            type="text"
            aria-label="Rename session"
            value={renameText}
            autoFocus
            maxLength={256}
            onChange={(event) => setRenameText(event.currentTarget.value)}
            onBlur={submitRename}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                submitRename();
              } else if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                setRenaming(false);
                setRenameText(session.title);
              }
            }}
          />
        </div>
      </li>
    );
  }

  return (
    <li className="dvx-session-row-shell">
      <button
        type="button"
        className="dvx-session-row"
        aria-current={session.active ? 'true' : undefined}
        // The exact stamp moved off the row into its hover title
        // (grouping already expresses recency, spec §2.1).
        title={formatModifiedTime(session.modifiedTime)}
        disabled={disabled || session.active}
        onClick={() => onSelect(session.id)}
      >
        {session.running === true ? (
          // Quiet inline spinner: a detached daemon turn is still
          // running in the background. Decorative ring; the
          // accessible signal is the hidden text.
          <>
            <span className="dvx-session-run-spinner" aria-hidden="true" />
            <span className="dvx-visually-hidden">{'Turn still running. '}</span>
          </>
        ) : (
          <span className="dvx-session-row-state" aria-hidden="true">
            <CheckCircleIcon />
          </span>
        )}
        <span className="dvx-session-row-title">{session.title}</span>
        {session.worktree !== undefined ? (
          // Quiet inline annotation; the full worktree path only
          // surfaces as a tooltip (UI restraint: no second line in a
          // 28px row).
          <span className="dvx-session-row-worktree" title={session.worktree.path}>
            {session.worktree.branch.length > 0
              ? `worktree · ${session.worktree.branch}`
              : 'worktree'}
          </span>
        ) : null}
        {session.missionRole !== undefined ? (
          <span className="dvx-session-row-worktree">
            {session.missionRole === 'worker' ? 'mission · worker' : 'mission'}
          </span>
        ) : null}
      </button>
      <button
        type="button"
        className={
          session.isFavorite
            ? 'dvx-session-star dvx-session-star-active'
            : 'dvx-session-star'
        }
        aria-label={
          session.isFavorite
            ? 'Remove session from favorites'
            : 'Add session to favorites'
        }
        aria-pressed={session.isFavorite}
        title={session.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
        disabled={disabled}
        onClick={() => onToggleFavorite(session.id, !session.isFavorite)}
      >
        <StarIcon filled={session.isFavorite} />
      </button>
      {!session.active ? (
        <button
          type="button"
          className="dvx-session-rename"
          aria-label={`Archive ${session.title}`}
          title="Archive session"
          disabled={disabled}
          onClick={() => onArchive(session.id)}
        >
          <ArchiveIcon />
        </button>
      ) : null}
      {session.active ? (
        <>
          <button
            type="button"
            className="dvx-session-rename"
            aria-label="Fork session"
            title="Fork session into a copy"
            disabled={disabled}
            onClick={() => onFork(session.id)}
          >
            <ForkIcon />
          </button>
          <button
            type="button"
            className="dvx-session-rename"
            aria-label="Rename session"
            title="Rename session"
            disabled={disabled}
            onClick={() => {
              setRenameText(session.title);
              setRenaming(true);
            }}
          >
            <RenameIcon />
          </button>
        </>
      ) : null}
    </li>
  );
}

function formatModifiedTime(value: string): string {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? MODIFIED_TIME_FORMAT.format(timestamp) : value;
}
