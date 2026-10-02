import type { ChatEffects } from '../chatEffects';
import type { DroidRuntime } from '../../../runtime/DroidRuntime';
import type { HostOperations } from '../hostOperations';
import type { ConversationRecoveryState } from '../recovery/ConversationRecoveryState';
import type { CustomModelState } from '../models/CustomModelState';
import type { MissionSessionState } from '../mission/MissionSessionState';
import type { SessionDirectoryState } from './SessionDirectoryState';
import type { SessionLifecycleState } from './SessionLifecycleState';
import type { TurnState } from '../turns/TurnState';
import type { NativeIdeBackend } from '../ideIntegration';

export interface RuntimeReplacementOptions {
  readonly preserveSessionWork?: boolean;
  readonly acknowledgeFailedTurnId?: string;
}

/** Read-only identity shared by asynchronous completion checks. */
export interface SessionGuardPort extends Pick<HostOperations, 'getWorkspaceContext'> {
  readonly sessionState: Readonly<Pick<SessionLifecycleState,
    'disposed' | 'runtimeGeneration' | 'runtime' | 'activeRuntimeCwd'>> & {
      readonly managedRuntimes: ReadonlySet<DroidRuntime>;
    };
}

export interface ActiveWorkspacePort extends SessionGuardPort,
  Pick<HostOperations, 'handleWorkspaceContextChanged'> {}

export interface WorkspaceFeedbackPort extends SessionGuardPort,
  Pick<HostOperations, 'emitSnapshot' | 'emitSessionDiagnostic'> {
  readonly sessionState: SessionGuardPort['sessionState'] &
    Pick<SessionLifecycleState, 'connection'>;
}

/** Closing a runtime can cancel its local changes ledger, but cannot replace a session. */
export interface RuntimeClosePort {
  readonly sessionState: Readonly<Pick<SessionLifecycleState, 'runtime' | 'closeRuntime'>>;
  readonly turnState: Readonly<Pick<TurnState, 'turn'>>;
}

export interface RuntimeDisposePort extends RuntimeClosePort,
  Pick<HostOperations, 'recoveryStore'> {
  readonly sessionState: Pick<SessionLifecycleState, 'runtime'> &
    Readonly<Pick<SessionLifecycleState, 'closeRuntime' | 'managedRuntimes'>>;
  readonly missionState: Pick<MissionSessionState, 'stopSubscription'>;
}

/** Feature owners release their resources; the session flow only requests cleanup. */
export interface SessionCleanupPort extends Pick<HostOperations, 'btwSideChat'> {
  readonly metadata: Pick<HostOperations['metadata'], 'reset'>;
  readonly missionState: Pick<MissionSessionState, 'detachRuntime'>;
  readonly customModelState: Pick<CustomModelState, 'cancelDiscovery'>;
  readonly turnState: Pick<TurnState, 'specHandoff'>;
  readonly effects: Pick<ChatEffects, 'clearPendingAttachments' | 'discardQueuedPrompts'>;
}

/** The only activation step that publishes the prepared session and recovered display together. */
export interface RuntimeActivationPort extends WorkspaceFeedbackPort,
  Pick<HostOperations, 'recoveryStore' | 'interactions' | 'createRuntime' | 'recordHost' |
    'worktreeSessions' | 'isCurrentSessionOperation'> {
  readonly nativeIde?: Pick<NativeIdeBackend, 'read'>;
  readonly sessionState: SessionGuardPort['sessionState'] & Pick<SessionLifecycleState,
    'runtime' | 'activeRuntimeCwd' | 'conversationId' | 'sessionId' | 'connection' |
    'closeRuntime' | 'managedRuntimes'>;
  readonly turnState: Pick<TurnState, 'turn'>;
  readonly catalogState: Pick<SessionDirectoryState, 'sessions'>;
  readonly recoveryState: Pick<ConversationRecoveryState, 'transcript'>;
  readonly effects: Pick<ChatEffects,
    'prepareActivationTranscript' | 'markRecoveryCheckpointUnavailable' | 'recoveryTurnId' |
    'persistActivationRecoveryCheckpoint' | 'withActiveSession' | 'recoverMissionProjection' |
    'loadSessionMetadata' | 'restoreQueuedPrompts' | 'reconcileDaemonTurn' | 'armReplayedSubagentWatch'>;
}

/** Coordinates startup/replacement; feature internals are reachable only through named effects. */
export interface RuntimeLifecyclePort extends RuntimeActivationPort,
  Pick<HostOperations, 'sessionCatalog' | 'emit' | 'reviewCoordinator' | 'planDocuments' |
    'diagnostics' | 'handleWorkspaceContextChanged' | 'childSession'> {
  readonly metadata: Pick<HostOperations['metadata'], 'settingsUpdate' | 'tokenUsage'>;
  readonly sessionState: RuntimeActivationPort['sessionState'] & Pick<SessionLifecycleState,
    'runtimeGeneration' | 'initialization' | 'workspaceTransition' | 'sessionOperationInProgress'>;
  readonly catalogState: RuntimeActivationPort['catalogState'] &
    Readonly<Pick<SessionDirectoryState, 'refreshInProgress'>>;
  readonly turnState: RuntimeActivationPort['turnState'] & Pick<TurnState, 'turnGeneration'>;
  readonly missionState: Pick<MissionSessionState, 'mission'> &
    Readonly<Pick<MissionSessionState, 'missionRuntime'>>;
  readonly effects: RuntimeActivationPort['effects'] & Pick<ChatEffects,
    'clearCatalog' | 'bindCatalogViewToWorkspace' | 'beginCatalogLoad' | 'loadCatalog' | 'isCurrentCatalogRequest' |
    'discardCatalogRequest' | 'seedBackgroundRunning' | 'hasCatalogSession' |
    'flushRecoveryCheckpoint' | 'setSessionRunning' | 'ensureBackgroundRunningPoll' |
    'markSessionSwitchReady' | 'resumeRecoveredIdeReconnect' | 'resetSessionMetadata'>;
}

/** Owns folder/trust transition ordering; startup is injected to avoid a module cycle. */
export interface WorkspaceLifecyclePort extends WorkspaceFeedbackPort,
  Pick<HostOperations, 'recoveryStore' | 'interactions' | 'handleWorkspaceContextChanged'> {
  readonly sessionState: SessionGuardPort['sessionState'] & Pick<SessionLifecycleState,
    'runtime' | 'activeRuntimeCwd' | 'runtimeGeneration' | 'connection' | 'closeRuntime' |
    'workspaceContext' | 'workspaceContextGeneration' | 'workspaceTransition' | 'initialization'>;
  readonly turnState: Pick<TurnState, 'turn' | 'turnGeneration'>;
  readonly recoveryState: Readonly<Pick<ConversationRecoveryState,
    'recoveryCheckpointTimer' | 'pendingRecoveryCheckpoint'>>;
  readonly effects: Pick<ChatEffects, 'startup' | 'resetSessionMetadata' |
    'checkpointRecoveryTranscript' | 'bindCatalogViewToWorkspace' | 'clearCatalog' |
    'markRecoveryCheckpointUnavailable'>;
}
