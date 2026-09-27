import type { ChatEffects } from '../chatEffects';
import type { HostOperations } from '../hostOperations';
import type { AttachmentStagingState } from '../attachments/AttachmentStagingState';
import type { ConversationRecoveryState } from '../recovery/ConversationRecoveryState';
import type { MissionSessionState } from '../mission/MissionSessionState';
import type { SessionDirectoryState } from '../sessions/SessionDirectoryState';
import type { SessionLifecycleState } from '../sessions/SessionLifecycleState';
import type { TurnState } from './TurnState';

/** Guard-only code cannot replace a runtime or mutate turn ownership. */
export interface TurnIdentityPort {
  readonly sessionState: Readonly<Pick<SessionLifecycleState, 'sessionId'>>;
  readonly turnState: Readonly<Pick<TurnState, 'turn' | 'turnGeneration'>>;
  readonly effects: Pick<ChatEffects, 'isCurrentRuntime' | 'ensureActiveRuntimeWorkspaceCurrent'>;
}

export interface TurnContextPort {
  readonly sessionState: Readonly<Pick<SessionLifecycleState,
    'runtime' | 'activeRuntimeCwd' | 'sessionId' | 'runtimeGeneration' | 'connection'>>;
  readonly effects: Pick<ChatEffects, 'refreshContext'>;
}

export interface TurnStatusPort extends Pick<HostOperations, 'emit' | 'recordHost' | 'diagnostics'> {
  readonly turnState: Readonly<Pick<TurnState, 'turn'>> & Pick<TurnState, 'turnIo'>;
  readonly effects: Pick<ChatEffects, 'clearTurnWatchdog' | 'settleQueueAfterTurn' | 'setSessionRunning'>;
}

export interface SpecHandoffSignalPort extends Pick<HostOperations, 'emit'> {
  readonly sessionState: Readonly<Pick<SessionLifecycleState, 'sessionId'>>;
  readonly turnState: Pick<TurnState, 'specHandoff'>;
}

/** Adoption owns only the session-operation lock, never the runtime itself. */
export type SpecHandoffPort = SpecHandoffSignalPort & Pick<HostOperations, 'recordHost' | 'emitSessionDiagnostic' | 'interactions'> & {
  readonly metadata: Readonly<Pick<HostOperations['metadata'], 'settingsUpdate'>>;
  readonly sessionState: Readonly<Pick<SessionLifecycleState, 'conversationId' | 'activeRuntimeCwd' | 'connection'>> &
    Pick<SessionLifecycleState, 'sessionOperationInProgress'>;
  readonly catalogState: Readonly<Pick<SessionDirectoryState, 'refreshInProgress'>>;
  readonly turnState: Readonly<Pick<TurnState, 'turn'>>;
  readonly effects: Pick<ChatEffects, 'flushRecoveryCheckpointOrReport' | 'adoptDurableSuccessor' | 'startReplacement'>;
};

/** Runtime events project activity; they cannot switch sessions or load a catalog. */
export type TurnRuntimeEventPort = TurnStatusPort & SpecHandoffSignalPort & Pick<HostOperations, 'reviewCoordinator'> & {
  readonly recoveryState: Pick<ConversationRecoveryState, 'transcript'>;
  readonly effects: Pick<ChatEffects,
    'flushPendingThinking' | 'handleMissionRuntimeEvent' | 'queueThinkingProjection' | 'mirrorExecuteEvent' |
    'recordLiveToolChanges' | 'scheduleLiveSubagentSync' | 'retainSentAttachments' |
    'scheduleRecoveryCheckpoint' | 'updateTokenUsage' | 'refreshSettingsAfterRuntimeEvent'>;
};

export interface TurnTranscriptPort {
  readonly sessionState: Readonly<Pick<SessionLifecycleState, 'sessionId'>>;
  readonly turnState: Readonly<Pick<TurnState, 'turn'>>;
  readonly recoveryState: Pick<ConversationRecoveryState, 'transcript'>;
  readonly effects: Pick<ChatEffects, 'scheduleRecoveryCheckpoint'>;
}

export type TurnFailurePort = TurnStatusPort & TurnContextPort & Pick<HostOperations, 'interactions' | 'terminalMirror'> & {
  readonly turnState: Pick<TurnState, 'specHandoff'>;
  readonly effects: Pick<ChatEffects, 'flushPendingThinking' | 'publishTurnChanges'>;
};

export type TurnCompletionPort = TurnFailurePort & SpecHandoffPort & {
  readonly effects: Pick<ChatEffects, 'updateTokenUsage' | 'settleTurnSubagents'>;
};

export type TurnStopPort = TurnStatusPort & TurnIdentityPort & Pick<HostOperations, 'interactions'> & {
  readonly sessionState: Readonly<Pick<SessionLifecycleState, 'runtime' | 'runtimeGeneration'>>;
  readonly turnState: Pick<TurnState, 'stopRequestGeneration'>;
  readonly effects: Pick<ChatEffects, 'flushPendingThinking' | 'markStopRequested'>;
};

/** The send/consume orchestrator composes the roles required by its event and settlement stages. */
export type TurnFlowPort = TurnRuntimeEventPort & TurnCompletionPort & TurnIdentityPort & {
  readonly sessionState: Readonly<Pick<SessionLifecycleState, 'runtimeGeneration'>>;
  readonly turnState: Pick<TurnState, 'turn' | 'turnGeneration'>;
  readonly attachmentState: Pick<AttachmentStagingState, 'pendingSentAttachments'>;
  readonly effects: Pick<ChatEffects,
    'discardPendingThinking' | 'armTurnWatchdog' | 'takePendingAttachments' | 'touchActiveSession' |
    'recordRecentCommand' | 'echoUserImageAttachments' | 'startLiveChanges' | 'capturePreToolBaseline' | 'reconcileDaemonTurn'>;
};

export interface TurnRetryPort extends Pick<HostOperations, 'getWorkspaceContext' | 'emitSnapshot' | 'recoveryStore'> {
  readonly sessionState: Readonly<Pick<SessionLifecycleState, 'sessionId' | 'disposed'>> &
    Pick<SessionLifecycleState, 'sessionOperationInProgress' | 'connection'>;
  readonly catalogState: Readonly<Pick<SessionDirectoryState, 'catalogCwd' | 'refreshInProgress'>> &
    Pick<SessionDirectoryState, 'sessions'>;
  readonly turnState: Readonly<Pick<TurnState, 'turn'>>;
  readonly effects: Pick<ChatEffects,
    'emitWorkspaceUnavailable' | 'resumeRecoveredIdeReconnect' | 'hasCatalogSession' | 'startReplacement' |
    'beginCatalogLoad' | 'loadCatalog' | 'isCurrentCatalogRequest' | 'discardCatalogRequest' | 'seedBackgroundRunning' | 'replaceRuntime'>;
}

export type CompactPort = TurnContextPort & Pick<HostOperations,
  'emit' | 'emitSnapshot' | 'emitSessionDiagnostic' | 'isCurrentSessionOperation' | 'interactions' | 'recoveryStore'> & {
  readonly metadata: Readonly<Pick<HostOperations['metadata'], 'settingsUpdate'>> & Pick<HostOperations['metadata'], 'tokenUsage'>;
  readonly sessionState: Readonly<Pick<SessionLifecycleState, 'conversationId'>> &
    Pick<SessionLifecycleState, 'sessionId' | 'sessionOperationInProgress'>;
  readonly catalogState: Readonly<Pick<SessionDirectoryState, 'refreshInProgress'>> & Pick<SessionDirectoryState, 'sessions'>;
  readonly turnState: Pick<TurnState, 'turn'>;
  readonly missionState: Pick<MissionSessionState, 'mission'>;
  readonly effects: Pick<ChatEffects, 'ensureActiveRuntimeWorkspaceCurrent' | 'adoptDurableSuccessor' |
    'activeSessionSummary' | 'withActiveSession' | 'loadHistoryTimed' | 'flushRecoveryCheckpointOrReport'>;
};
