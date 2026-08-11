import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import type {
  SessionCatalogState,
  SessionSummary,
} from '../../shared/bridgeMessages';

interface SessionDrawerProps {
  readonly sessions: SessionCatalogState;
  readonly actionsDisabled: boolean;
  readonly onSelectSession: (sessionId: string) => void;
  readonly onRenameSession: (sessionId: string, title: string) => void;
  readonly onForkSession: (sessionId: string) => void;
}

const MODIFIED_TIME_FORMAT = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

export const SessionDrawer = memo(function SessionDrawer({
  sessions,
  actionsDisabled,
  onSelectSession,
  onRenameSession,
  onForkSession,
}: SessionDrawerProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
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
                placeholder="Search recent chats"
                autoComplete="off"
                onChange={(event) => setQuery(event.currentTarget.value)}
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

            <CatalogStatus sessions={sessions} pending={pendingAction} />
            {filteredSessions.length > 0 ? (
              <nav
                className="dvx-session-nav"
                aria-label="Session history"
              >
                <ul className="dvx-session-list">
                  {filteredSessions.map((session) => (
                    <SessionRow
                      key={session.id}
                      session={session}
                      disabled={disabled}
                      onSelect={(sessionId) =>
                        runOnce(() => onSelectSession(sessionId))
                      }
                      onRename={onRenameSession}
                      onFork={(sessionId) =>
                        runOnce(() => onForkSession(sessionId))
                      }
                    />
                  ))}
                </ul>
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
          </aside>
        </>
      ) : null}
    </>
  );
});

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
}: {
  readonly session: SessionSummary;
  readonly disabled: boolean;
  readonly onSelect: (sessionId: string) => void;
  readonly onRename: (sessionId: string, title: string) => void;
  readonly onFork: (sessionId: string) => void;
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
        <time dateTime={session.modifiedTime}>
          {formatModifiedTime(session.modifiedTime)}
        </time>
      </button>
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
