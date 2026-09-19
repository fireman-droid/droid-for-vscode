// Shell header (brand + connection status + session actions). Moved
// verbatim from App.tsx (structure-only split under the file-budget
// ratchet); App remains the only consumer.

import { useMemo } from 'react';

import { SessionDrawer } from '../sessions/SessionDrawer';
import { type AssistantWebviewState } from '../state/types';

export function AppHeader({
  state,
  sessionActionsDisabled,
  sessionsOpenSignal,
  onNewSession,
  onCreateWorktreeSession,
  onSelectSession,
  onRenameSession,
  onForkSession,
  onToggleFavorite,
  onArchiveSession,
  onUnarchiveSession,
  onRefreshArchived,
  onSearchContent,
}: {
  readonly state: AssistantWebviewState;
  readonly sessionActionsDisabled: boolean;
  /** `/sessions` navigation counter; a change opens the drawer. */
  readonly sessionsOpenSignal: number;
  readonly onNewSession: () => void;
  readonly onCreateWorktreeSession: () => void;
  readonly onSelectSession: (sessionId: string) => void;
  readonly onRenameSession: (sessionId: string, title: string) => void;
  readonly onForkSession: (sessionId: string) => void;
  readonly onToggleFavorite: (sessionId: string, favorite: boolean) => void;
  readonly onArchiveSession: (sessionId: string) => void;
  readonly onUnarchiveSession: (sessionId: string) => void;
  readonly onRefreshArchived: () => void;
  readonly onSearchContent: (query: string) => void;
}): React.JSX.Element {
  const connectionLabel = formatConnectionStatus(state.connection.status);
  const runtimeLabel =
    state.mission === null
      ? connectionLabel
      : `${connectionLabel} · ${formatMissionIdentity(state.mission)}`;
  const ordinarySessions = useMemo(
    () => ({
      ...state.sessions,
      items: state.sessions.items.filter((session) => session.missionRole === undefined),
    }),
    [state.sessions],
  );
  const missionSessionIds = useMemo(
    () =>
      new Set(
        state.sessions.items
          .filter((session) => session.missionRole !== undefined)
          .map((session) => session.id),
      ),
    [state.sessions.items],
  );
  const ordinaryArchived = useMemo(
    () =>
      state.archived.status !== 'ready'
        ? state.archived
        : {
            ...state.archived,
            items: state.archived.items.filter(
              (session) => !missionSessionIds.has(session.id),
            ),
          },
    [missionSessionIds, state.archived],
  );
  const ordinarySearch = useMemo(
    () =>
      state.sessionSearch === null
        ? null
        : state.sessionSearch.status !== 'ready'
          ? state.sessionSearch
          : {
              ...state.sessionSearch,
              items: state.sessionSearch.items.filter(
                (session) => !missionSessionIds.has(session.id),
              ),
            },
    [missionSessionIds, state.sessionSearch],
  );
  return (
    <>
      <header className="dvx-header">
        <div className="dvx-brand">
          <div>
            <div className="dvx-title">Droid</div>
            <span
              className="dvx-runtime-status"
              data-status={state.connection.status}
              role={state.connection.status === 'unavailable' ? 'alert' : 'status'}
              title={runtimeLabel}
            >
              <span className="dvx-runtime-status-dot" aria-hidden="true" />
              <span className="dvx-visually-hidden">{runtimeLabel}</span>
            </span>
          </div>
        </div>
        <div className="dvx-header-actions">
          <button
            className="dvx-icon-button dvx-header-new"
            type="button"
            aria-label="New session"
            disabled={sessionActionsDisabled}
            onClick={onNewSession}
          >
            <NewSessionIcon />
          </button>
          <SessionDrawer
            sessions={ordinarySessions}
            archived={ordinaryArchived}
            sessionSearch={ordinarySearch}
            actionsDisabled={sessionActionsDisabled}
            openSignal={sessionsOpenSignal}
            worktreeCreateAvailable={state.worktreeCreateAvailable}
            onCreateWorktreeSession={onCreateWorktreeSession}
            onSelectSession={onSelectSession}
            onRenameSession={onRenameSession}
            onForkSession={onForkSession}
            onToggleFavorite={onToggleFavorite}
            onArchiveSession={onArchiveSession}
            onUnarchiveSession={onUnarchiveSession}
            onRefreshArchived={onRefreshArchived}
            onSearchContent={onSearchContent}
          />
        </div>
      </header>
    </>
  );
}

function NewSessionIcon(): React.JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 3.333v9.334M3.333 8h9.334"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function formatConnectionStatus(
  status: AssistantWebviewState['connection']['status'],
): string {
  switch (status) {
    case 'connected':
      return 'Local runtime connected';
    case 'connecting':
      return 'Connecting to local runtime';
    case 'unavailable':
      return 'Local runtime unavailable';
    case 'idle':
      return 'Local runtime idle';
  }
}

/** "Mission · running" / "Mission worker" read-only identity text. */
function formatMissionIdentity(
  mission: NonNullable<AssistantWebviewState['mission']>,
): string {
  const label = mission.role === 'worker' ? 'Mission worker' : 'Mission';
  return mission.state === null
    ? label
    : `${label} · ${formatMissionState(mission.state)}`;
}

function formatMissionState(
  state: NonNullable<NonNullable<AssistantWebviewState['mission']>['state']>,
): string {
  switch (state) {
    case 'awaiting_input':
      return 'awaiting input';
    case 'orchestrator_turn':
      return 'orchestrating';
    default:
      return state;
  }
}
