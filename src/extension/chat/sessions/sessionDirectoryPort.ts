import type { ChatEffects } from '../chatEffects';
import type { HostOperations } from '../hostOperations';
import type { ConversationRecoveryState } from '../recovery/ConversationRecoveryState';
import type { MissionSessionState } from '../mission/MissionSessionState';
import type { SessionDirectoryState } from './SessionDirectoryState';
import type { SessionLifecycleState } from './SessionLifecycleState';
import type { TurnState } from '../turns/TurnState';
export interface SessionDirectoryPort
  extends Pick<
    HostOperations,
    | 'getWorkspaceContext'
    | 'worktreeSessions'
    | 'emitSessionDiagnostic'
    | 'isCurrentSessionOperation'
    | 'emitSnapshot'
    | 'sessionCatalog'
    | 'daemonSessions'
    | 'emit'
    | 'recordPanelFailure'
    | 'recoveryStore'
    | 'interactions'
    | 'metadata'
  > {
  readonly sessionState: Readonly<
    Pick<
      SessionLifecycleState,
      'runtime' | 'connection' | 'runtimeGeneration' | 'activeRuntimeCwd' | 'disposed'
    >
  > &
    Pick<
      SessionLifecycleState,
      'conversationId' | 'sessionId' | 'sessionOperationInProgress'
    >;
  readonly catalogState: Readonly<Pick<SessionDirectoryState, 'runningSessionIds'>> &
    Pick<
      SessionDirectoryState,
      | 'sessions'
      | 'catalogGeneration'
      | 'catalogCwd'
      | 'refreshInProgress'
      | 'worktreeCreateAvailable'
      | 'worktreeAvailabilityCwd'
    >;
  readonly turnState: Pick<TurnState, 'turn'>;
  readonly recoveryState: Pick<ConversationRecoveryState, 'transcript'>;
  readonly missionState: Pick<MissionSessionState, 'mission'>;
  readonly effects: Pick<
    ChatEffects,
    | 'canReplaceSession'
    | 'emitWorkspaceUnavailable'
    | 'startReplacement'
    | 'ensureActiveRuntimeWorkspaceCurrent'
    | 'isTargetWorkspaceCurrent'
    | 'seedBackgroundRunning'
    | 'createDurableForkConversation'
    | 'clearPendingAttachments'
    | 'loadHistoryTimed'
    | 'flushRecoveryCheckpointOrReport'
    | 'refreshContextAfterTurn'
    | 'armReplayedSubagentWatch'
  >;
}
