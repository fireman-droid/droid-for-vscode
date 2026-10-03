import type { ChatEffects } from '../chatEffects';
import type { HostOperations } from '../hostOperations';
import type { ConversationRecoveryState } from './ConversationRecoveryState';
import type { MissionSessionState } from '../mission/MissionSessionState';
import type { SessionLifecycleState } from '../sessions/SessionLifecycleState';
import type { TurnState } from '../turns/TurnState';
export interface RecoveryPort
  extends Pick<
    HostOperations,
    | 'recoveryStore'
    | 'recordHost'
    | 'emitSnapshot'
    | 'emit'
    | 'interactions'
    | 'isCurrentSessionOperation'
    | 'diagnostics'
    | 'metadata'
    | 'emitSessionDiagnostic'
  > {
  readonly sessionState: Readonly<Pick<SessionLifecycleState, 'conversationId' | 'sessionId'>> &
    Pick<SessionLifecycleState, 'connection'>;
  readonly turnState: Readonly<Pick<TurnState, 'turn' | 'turnGeneration'>>;
  readonly recoveryState: Pick<
    ConversationRecoveryState,
    'transcript' | 'pendingRecoveryCheckpoint' | 'recoveryCheckpointTimer'
  >;
  readonly missionState: Pick<MissionSessionState, 'mission'>;
  readonly effects: Pick<
    ChatEffects,
    | 'setSessionRunning'
    | 'beginTurn'
    | 'restoreTurn'
    | 'isCurrentTurn'
    | 'failTurn'
    | 'loadHistoryTimed'
    | 'refreshContextAfterTurn'
    | 'setTurnStatus'
    | 'handleTurnComplete'
    | 'publishTurnChanges'
    | 'startLiveChanges'
    | 'reconnectRecoveredIde'
  >;
}
