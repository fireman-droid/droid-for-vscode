// Shell header (brand + connection status + session actions). Moved
// verbatim from App.tsx (structure-only split under the file-budget
// ratchet); App remains the only consumer.

import { SessionDrawer } from './SessionDrawer';
import type { AssistantWebviewState } from './store';
import { MissionControl } from './mission/MissionControl';
import type { MissionUiCommand } from './mission/useMissionControl';

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
  onMissionCommand,
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
  readonly onToggleFavorite: (
    sessionId: string,
    favorite: boolean,
  ) => void;
  readonly onArchiveSession: (sessionId: string) => void;
  readonly onUnarchiveSession: (sessionId: string) => void;
  readonly onRefreshArchived: () => void;
  readonly onSearchContent: (query: string) => void;
  readonly onMissionCommand: (command: MissionUiCommand) => void;
}): React.JSX.Element {
  const connectionLabel = formatConnectionStatus(state.connection.status);
  return (
    <>
    <header className="dvx-header">
      <div className="dvx-brand">
        <div>
          <div className="dvx-title">Droid</div>
          <div
            className="dvx-runtime-status"
            role={
              state.connection.status === 'unavailable' ? 'alert' : 'status'
            }
          >
            <span>{connectionLabel}</span>
            {/* Quiet read-only mission identity; same muted style as
                the connection label (UI restraint: no new element). */}
            {state.mission !== null ? (
              <span>{`· ${formatMissionIdentity(state.mission)}`}</span>
            ) : null}
          </div>
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
          sessions={state.sessions}
          archived={state.archived}
          sessionSearch={state.sessionSearch}
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
    {state.missionSnapshot?.lifecycle === undefined ? null : (
      <MissionControl
        snapshot={state.missionSnapshot}
        onCommand={onMissionCommand}
      />
    )}
    </>
  );
}

function NewSessionIcon(): React.JSX.Element {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
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
  const label =
    mission.role === 'worker' ? 'Mission worker' : 'Mission';
  return mission.state === null
    ? label
    : `${label} · ${formatMissionState(mission.state)}`;
}

function formatMissionState(
  state: NonNullable<
    NonNullable<AssistantWebviewState['mission']>['state']
  >,
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
