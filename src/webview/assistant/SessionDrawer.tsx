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
  readonly onRefresh: () => void;
  readonly onNewSession: () => void;
  readonly onSelectSession: (sessionId: string) => void;
}

const MODIFIED_TIME_FORMAT = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

export const SessionDrawer = memo(function SessionDrawer({
  sessions,
  actionsDisabled,
  onRefresh,
  onNewSession,
  onSelectSession,
}: SessionDrawerProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [pendingAction, setPendingAction] = useState(false);
  const pendingActionRef = useRef(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const previousSessionsRef = useRef(sessions);

  useEffect(() => {
    if (previousSessionsRef.current !== sessions) {
      previousSessionsRef.current = sessions;
      pendingActionRef.current = false;
      setPendingAction(false);
    }
  }, [sessions]);

  useEffect(() => {
    if (open) {
      searchRef.current?.focus({ preventScroll: true });
    }
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
          <button
            type="button"
            className="dvx-drawer-backdrop"
            aria-label="Close session history"
            onClick={() => setOpen(false)}
          />
          <aside
            id="dvx-session-drawer"
            className="dvx-session-drawer"
            aria-label="Session history"
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                setOpen(false);
              }
            }}
          >
            <header className="dvx-drawer-header">
              <div>
                <span className="dvx-kicker">Local history</span>
                <h2>Sessions</h2>
              </div>
              <button
                className="dvx-icon-button"
                type="button"
                aria-label="Close sessions"
                onClick={() => setOpen(false)}
              >
                ×
              </button>
            </header>
            <label className="dvx-visually-hidden" htmlFor="dvx-session-search">
              Search sessions
            </label>
            <input
              ref={searchRef}
              id="dvx-session-search"
              className="dvx-session-search"
              type="search"
              value={query}
              placeholder="Search sessions"
              autoComplete="off"
              onChange={(event) => setQuery(event.currentTarget.value)}
            />
            <div className="dvx-session-actions">
              <button
                type="button"
                className="dvx-button"
                disabled={disabled}
                onClick={() => runOnce(onRefresh)}
              >
                Refresh
              </button>
              <button
                type="button"
                className="dvx-button dvx-button-primary"
                disabled={disabled}
                onClick={() => runOnce(onNewSession)}
              >
                New session
              </button>
            </div>

            <CatalogStatus sessions={sessions} pending={pendingAction} />
            {filteredSessions.length > 0 ? (
              <nav aria-label="Session history">
                <ul className="dvx-session-list">
                  {filteredSessions.map((session) => (
                    <SessionRow
                      key={session.id}
                      session={session}
                      disabled={disabled}
                      onSelect={(sessionId) =>
                        runOnce(() => onSelectSession(sessionId))
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
}: {
  readonly session: SessionSummary;
  readonly disabled: boolean;
  readonly onSelect: (sessionId: string) => void;
}): React.JSX.Element {
  return (
    <li>
      <button
        type="button"
        className="dvx-session-row"
        aria-current={session.active ? 'true' : undefined}
        disabled={disabled || session.active}
        onClick={() => onSelect(session.id)}
      >
        <span className="dvx-session-row-title">{session.title}</span>
        <code>{session.id}</code>
        <span className="dvx-session-row-meta">
          <span>
            {session.messageCount.toLocaleString()}{' '}
            {session.messageCount === 1 ? 'message' : 'messages'}
          </span>
          <time dateTime={session.modifiedTime}>
            {formatModifiedTime(session.modifiedTime)}
          </time>
        </span>
      </button>
    </li>
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
        d="M3 3.5h10M3 8h10M3 12.5h7"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}
