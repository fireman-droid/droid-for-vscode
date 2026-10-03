import type { ChatEffects } from '../chatEffects';
import type { HostOperations } from '../hostOperations';
import type { ConversationRecoveryState } from '../recovery/ConversationRecoveryState';
import type { MissionSessionState } from './MissionSessionState';
import type { SessionDirectoryState } from '../sessions/SessionDirectoryState';
import type { SessionLifecycleState } from '../sessions/SessionLifecycleState';
import type { TurnState } from '../turns/TurnState';
export interface ControllerPort
  extends Pick<
    HostOperations,
    | 'getWorkspaceContext'
    | 'metadata'
    | 'missionGateway'
    | 'interactions'
    | 'isCurrentSessionOperation'
    | 'recoveryStore'
    | 'emitSnapshot'
    | 'emit'
    | 'emitSessionDiagnostic'
  > {
  readonly sessionState: Readonly<
    Pick<SessionLifecycleState, 'connection' | 'managedRuntimes' | 'disposed' | 'conversationId' | 'sessionId'>
  > &
    Pick<
      SessionLifecycleState,
      | 'runtime'
      | 'runtimeGeneration'
      | 'activeRuntimeCwd'
    >;
  readonly catalogState: Pick<SessionDirectoryState, 'sessions'>;
  readonly turnState: Readonly<Pick<TurnState, 'turn'>>;
  readonly recoveryState: Pick<ConversationRecoveryState, 'transcript'>;
  readonly missionState: Pick<
    MissionSessionState,
    'mission' | 'missionRuntime' | 'missionStartInProgress' | 'stopMissionSubscription'
  >;
  readonly effects: Pick<ChatEffects, 'closeRuntime' | 'handleSend' | 'loadSessionMetadata' | 'commitSessionBinding'>;
}
