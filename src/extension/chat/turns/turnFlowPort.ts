import type { ChatEffects } from '../chatEffects';
import type { HostOperations } from '../hostOperations';
import type { AttachmentStagingState } from '../attachments/AttachmentStagingState';
import type { ConversationRecoveryState } from '../recovery/ConversationRecoveryState';
import type { MissionSessionState } from '../mission/MissionSessionState';
import type { SessionDirectoryState } from '../sessions/SessionDirectoryState';
import type { SessionLifecycleState } from '../sessions/SessionLifecycleState';
import type { TurnState } from './TurnState';
export interface TurnFlowPort
  extends Pick<
    HostOperations,
    | 'metadata'
    | 'diagnostics'
    | 'recordHost'
    | 'interactions'
    | 'emit'
    | 'terminalMirror'
    | 'emitSessionDiagnostic'
    | 'getWorkspaceContext'
    | 'emitSnapshot'
    | 'recoveryStore'
    | 'reviewCoordinator'
    | 'isCurrentSessionOperation'
  > {
  readonly sessionState: Readonly<
    Pick<
      SessionLifecycleState,
      | 'runtime'
      | 'conversationId'
      | 'runtimeGeneration'
      | 'activeRuntimeCwd'
      | 'disposed'
    >
  > &
    Pick<SessionLifecycleState, 'sessionId' | 'sessionOperationInProgress' | 'connection'>;
  readonly catalogState: Readonly<
    Pick<SessionDirectoryState, 'catalogCwd' | 'refreshInProgress'>
  > &
    Pick<SessionDirectoryState, 'sessions'>;
  readonly turnState: Pick<
    TurnState,
    'turn' | 'turnGeneration' | 'stopRequestGeneration' | 'specHandoff' | 'turnIo'
  >;
  readonly attachmentState: Pick<AttachmentStagingState, 'pendingSentAttachments'>;
  readonly recoveryState: Pick<ConversationRecoveryState, 'transcript'>;
  readonly missionState: Pick<MissionSessionState, 'mission'>;
  readonly effects: Pick<
    ChatEffects,
    | 'ensureActiveRuntimeWorkspaceCurrent'
    | 'discardPendingThinking'
    | 'armTurnWatchdog'
    | 'takePendingAttachments'
    | 'scheduleRecoveryCheckpoint'
    | 'touchActiveSession'
    | 'recordRecentCommand'
    | 'echoUserImageAttachments'
    | 'flushPendingThinking'
    | 'capturePreToolBaseline'
    | 'handleMissionRuntimeEvent'
    | 'queueThinkingProjection'
    | 'mirrorExecuteEvent'
    | 'recordLiveToolChanges'
    | 'startLiveChanges'
    | 'scheduleLiveSubagentSync'
    | 'retainSentAttachments'
    | 'updateTokenUsage'
    | 'refreshSettingsAfterRuntimeEvent'
    | 'publishTurnChanges'
    | 'settleTurnSubagents'
    | 'startReplacement'
    | 'flushRecoveryCheckpointOrReport'
    | 'adoptDurableSuccessor'
    | 'markStopRequested'
    | 'emitWorkspaceUnavailable'
    | 'hasCatalogSession'
    | 'beginCatalogLoad'
    | 'loadCatalog'
    | 'isCurrentCatalogRequest'
    | 'discardCatalogRequest'
    | 'seedBackgroundRunning'
    | 'replaceRuntime'
    | 'activeSessionSummary'
    | 'withActiveSession'
    | 'loadHistoryTimed'
    | 'clearTurnWatchdog'
    | 'settleQueueAfterTurn'
    | 'setSessionRunning'
    | 'isCurrentRuntime'
    | 'refreshContext'
  >;
}
