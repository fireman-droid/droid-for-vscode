import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  MAX_SESSION_SEARCH_QUERY_LENGTH,
  type SessionArchivedState,
  type SessionCatalogState,
  type SessionSearchState,
  type SessionSummary,
} from '../../shared/bridgeMessages';

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
  readonly onToggleFavorite: (
    sessionId: string,
    favorite: boolean,
  ) => void;
  readonly onArchiveSession: (sessionId: string) => void;
  readonly onUnarchiveSession: (sessionId: string) => void;
  readonly onRefreshArchived: () => void;
  readonly onSearchContent: (query: string) => void;
}

const MODIFIED_TIME_FORMAT = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

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
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
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
  const disabled =
    actionsDisabled || operationLoading || pendingAction;

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
    if (
      trimmed.length === 0 ||
      trimmed.length > MAX_SESSION_SEARCH_QUERY_LENGTH
    ) {
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
    <>
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
        <>
          <aside
            id="dvx-session-drawer"
            className="dvx-session-drawer"
            aria-label="Session history"
          >
            <label className="dvx-visually-hidden" htmlFor="dvx-session-search">
              Search sessions
            </label>
            <div className="dvx-session-search-shell">
              <span aria-hidden="true" className="dvx-session-search-icon">
                <SearchIcon />
              </span>
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
            </div>
            <div className="dvx-session-filter-row">
              <span>All chats</span>
              <button
                type="button"
                className="dvx-session-close"
                aria-label="Close session history"
                onClick={() => setOpen(false)}
              >
                <CloseHistoryIcon />
              </button>
            </div>
            {worktreeCreateAvailable === true &&
            onCreateWorktreeSession !== undefined ? (
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

            <CatalogStatus sessions={sessions} pending={pendingAction} />
            {filteredSessions.length > 0 ? (
              <nav
                className="dvx-session-nav"
                aria-label="Session history"
              >
                {sessionGroups.map((group) => (
                  <section
                    key={group.key}
                    className="dvx-session-group"
                    aria-label={group.label ?? undefined}
                  >
                    {group.label !== null ? (
                      <h3 className="dvx-session-group-label">
                        {group.label}
                      </h3>
                    ) : null}
                    <ul className="dvx-session-list">
                      {group.items.map((session) => (
                        <SessionRow
                          key={session.id}
                          session={session}
                          disabled={disabled}
                          onSelect={(sessionId) =>
                            // Selecting navigates: the drawer closes and
                            // the chat view takes over immediately, like
                            // Cursor's history list.
                            runOnce(() => {
                              setOpen(false);
                              onSelectSession(sessionId);
                            })
                          }
                          onRename={onRenameSession}
                          onFork={(sessionId) =>
                            runOnce(() => onForkSession(sessionId))
                          }
                          onToggleFavorite={(sessionId, favorite) =>
                            runOnce(() =>
                              onToggleFavorite(sessionId, favorite),
                            )
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
            <ArchivedSection
              archived={archived}
              open={archivedOpen}
              disabled={disabled}
              onToggle={toggleArchived}
              onUnarchive={(sessionId) =>
                runOnce(() => onUnarchiveSession(sessionId))
              }
            />
          </aside>
        </>
      ) : null}
    </>
  );
});

interface SessionGroup {
  readonly key: string;
  readonly label: string | null;
  readonly items: readonly SessionSummary[];
}

/**
 * Partitions the catalog into a pinned Favorites group and the rest.
 * Order within each group keeps the host's modified-time ordering.
 * Without favorites the list renders ungrouped, exactly as before.
 */
function groupSessions(
  items: readonly SessionSummary[],
): readonly SessionGroup[] {
  const favorites = items.filter((session) => session.isFavorite);
  if (favorites.length === 0) {
    return [{ key: 'all', label: null, items }];
  }
  const rest = items.filter((session) => !session.isFavorite);
  const groups: SessionGroup[] = [
    { key: 'favorites', label: 'Favorites', items: favorites },
  ];
  if (rest.length > 0) {
    groups.push({ key: 'recent', label: 'Recent', items: rest });
  }
  return groups;
}

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
      <h3 className="dvx-session-group-label">
        Content matches · “{search.query}”
      </h3>
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
                <span className="dvx-session-row-title">
                  {hit.title}
                </span>
                {hit.snippet !== null ? (
                  <span className="dvx-session-match-snippet">
                    {hit.snippet}
                  </span>
                ) : null}
                {hit.modifiedTime !== null ? (
                  <time dateTime={hit.modifiedTime}>
                    {formatModifiedTime(hit.modifiedTime)}
                  </time>
                ) : null}
              </>
            );
            return (
              <li key={hit.id} className="dvx-session-row-shell">
                {selectable ? (
                  <button
                    type="button"
                    className="dvx-session-row dvx-session-match"
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
        ) : archived.status === 'loading' ||
          archived.status === 'idle' ? (
          <p className="dvx-session-status" role="status">
            Loading archived sessions…
          </p>
        ) : archived.items.length === 0 ? (
          <p className="dvx-session-empty">No archived sessions.</p>
        ) : (
          <ul className="dvx-session-list">
            {archived.items.map((session) => (
              <li key={session.id} className="dvx-session-row-shell">
                <div className="dvx-session-row dvx-session-row-static">
                  <span className="dvx-session-row-title">
                    {session.title}
                  </span>
                  <time dateTime={session.archivedTime}>
                    {formatModifiedTime(session.archivedTime)}
                  </time>
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
        {sessions.status === 'loading'
          ? 'Loading sessions…'
          : 'Waiting for Droid…'}
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
  readonly onToggleFavorite: (
    sessionId: string,
    favorite: boolean,
  ) => void;
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
            onChange={(event) =>
              setRenameText(event.currentTarget.value)
            }
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
        disabled={disabled || session.active}
        onClick={() => onSelect(session.id)}
      >
        <span className="dvx-session-row-title">{session.title}</span>
        {session.worktree !== undefined ? (
          // Quiet secondary line; the full worktree path only surfaces
          // as a tooltip (UI restraint: no new prominent element).
          <span
            className="dvx-session-row-worktree"
            title={session.worktree.path}
          >
            {session.worktree.branch.length > 0
              ? `worktree · ${session.worktree.branch}`
              : 'worktree'}
          </span>
        ) : null}
        {session.missionRole !== undefined ? (
          // Same quiet secondary style as the worktree annotation.
          <span className="dvx-session-row-worktree">
            {session.missionRole === 'worker'
              ? 'mission · worker'
              : 'mission'}
          </span>
        ) : null}
        <time dateTime={session.modifiedTime}>
          {formatModifiedTime(session.modifiedTime)}
        </time>
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
        title={
          session.isFavorite
            ? 'Remove from favorites'
            : 'Add to favorites'
        }
        disabled={disabled}
        onClick={() =>
          onToggleFavorite(session.id, !session.isFavorite)
        }
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

function StarIcon({
  filled,
}: {
  readonly filled: boolean;
}): React.JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill={filled ? 'currentColor' : 'none'}
      aria-hidden="true"
    >
      <path
        d="m8 2.2 1.76 3.57 3.94.57-2.85 2.78.67 3.92L8 11.19l-3.52 1.85.67-3.92L2.3 6.34l3.94-.57L8 2.2Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ForkIcon(): React.JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="4.5" cy="3.75" r="1.75" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="11.5" cy="3.75" r="1.75" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="8" cy="12.25" r="1.75" stroke="currentColor" strokeWidth="1.2" />
      <path
        d="M4.5 5.5v1a2 2 0 0 0 2 2h3a2 2 0 0 0 2-2v-1M8 8.5v2"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function RenameIcon(): React.JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="m11.1 2.6 2.3 2.3-7.6 7.6-3 .7.7-3 7.6-7.6Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ArchiveIcon(): React.JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <rect
        x="2.25"
        y="3"
        width="11.5"
        height="3"
        rx="0.75"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <path
        d="M3.25 6v6a1 1 0 0 0 1 1h7.5a1 1 0 0 0 1-1V6M6.5 8.75h3"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function UnarchiveIcon(): React.JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <rect
        x="2.25"
        y="3"
        width="11.5"
        height="3"
        rx="0.75"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <path
        d="M3.25 6v6a1 1 0 0 0 1 1h7.5a1 1 0 0 0 1-1V6M8 12v-4m0 0-1.75 1.75M8 8l1.75 1.75"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChevronIcon(): React.JSX.Element {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="m6 4 4 4-4 4"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function formatModifiedTime(value: string): string {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp)
    ? MODIFIED_TIME_FORMAT.format(timestamp)
    : value;
}

function SessionIcon(): React.JSX.Element {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M2 2v3.333h3.333M2.033 8.667a6 6 0 1 0 1.967-5.134l-2 1.8M8 4.667V8l2.333 1.333"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SearchIcon(): React.JSX.Element {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <circle
        cx="7"
        cy="7"
        r="3.75"
        stroke="currentColor"
        strokeWidth="1.25"
      />
      <path
        d="m9.8 9.8 3 3"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CloseHistoryIcon(): React.JSX.Element {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <rect
        x="2.5"
        y="2.75"
        width="11"
        height="10.5"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <path
        d="M9.5 2.75v10.5M7.25 6 5.25 8l2 2"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
