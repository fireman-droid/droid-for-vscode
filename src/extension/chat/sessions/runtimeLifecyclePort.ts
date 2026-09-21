import type { ChatEffects } from '../chatEffects';
import type { HostOperations } from '../hostOperations';
import type { ConversationRecoveryState } from '../recovery/ConversationRecoveryState';
import type { CustomModelState } from '../models/CustomModelState';
import type { MissionSessionState } from '../mission/MissionSessionState';
import type { SessionDirectoryState } from './SessionDirectoryState';
import type { SessionLifecycleState } from './SessionLifecycleState';
import type { TurnState } from '../turns/TurnState';
import type { NativeIdeBackend } from '../ideIntegration';
export interface RuntimeLifecyclePort
  extends Pick<
    HostOperations,
    | 'getWorkspaceContext'
    | 'recoveryStore'
    | 'emitSnapshot'
    | 'reviewCoordinator'
    | 'interactions'
    | 'planDocuments'
    | 'metadata'
    | 'emitSessionDiagnostic'
    | 'diagnostics'
    | 'recordHost'
    | 'createRuntime'
    | 'worktreeSessions'
    | 'isCurrentSessionOperation'
    | 'btwSideChat'
    | 'handleWorkspaceContextChanged'
  > {
  readonly nativeIde?: Pick<NativeIdeBackend, 'read'>;
  readonly sessionState: Readonly<
    Pick<
      SessionLifecycleState,
      | 'workspaceContext'
      | 'workspaceContextGeneration'
      | 'managedRuntimes'
      | 'closeRuntime'
      | 'disposed'
    >
  > &
    Pick<
      SessionLifecycleState,
      | 'runtime'
      | 'connection'
      | 'conversationId'
      | 'sessionId'
      | 'runtimeGeneration'
      | 'activeRuntimeCwd'
      | 'initialization'
      | 'workspaceTransition'
      | 'sessionOperationInProgress'
    >;
  readonly catalogState: Readonly<Pick<SessionDirectoryState, 'refreshInProgress'>> &
    Pick<SessionDirectoryState, 'sessions'>;
  readonly turnState: Pick<TurnState, 'turn' | 'turnGeneration' | 'specHandoff'>;
  readonly recoveryState: Pick<ConversationRecoveryState, 'transcript'>;
  readonly missionState: Pick<MissionSessionState, 'mission' | 'missionRuntime'>;
  readonly customModelState: Pick<
    CustomModelState,
    'customModelsDiscoveryAbort' | 'customModelsOp'
  >;
  readonly effects: Pick<
    ChatEffects,
    | 'clearCatalog'
    | 'beginCatalogLoad'
    | 'loadCatalog'
    | 'isCurrentCatalogRequest'
    | 'discardCatalogRequest'
    | 'seedBackgroundRunning'
    | 'hasCatalogSession'
    | 'flushRecoveryCheckpoint'
    | 'markRecoveryCheckpointUnavailable'
    | 'setSessionRunning'
    | 'ensureBackgroundRunningPoll'
    | 'withActiveSession'
    | 'prepareActivationTranscript'
    | 'markSessionSwitchReady'
    | 'recoveryTurnId'
    | 'persistActivationRecoveryCheckpoint'
    | 'recoverMissionProjection'
    | 'loadSessionMetadata'
    | 'restoreQueuedPrompts'
    | 'reconcileDaemonTurn'
    | 'resumeRecoveredIdeReconnect'
    | 'armReplayedSubagentWatch'
    | 'clearPendingAttachments'
    | 'discardQueuedPrompts'
  >;
}
