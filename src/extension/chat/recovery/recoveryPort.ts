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
    | 'interactions'
    | 'isCurrentSessionOperation'
    | 'diagnostics'
    | 'metadata'
    | 'emitSessionDiagnostic'
  > {
  readonly sessionState: Pick<
    SessionLifecycleState,
    'connection' | 'conversationId' | 'sessionId'
  >;
  readonly turnState: Pick<TurnState, 'turn' | 'turnGeneration' | 'turnIo'>;
  readonly recoveryState: Pick<
    ConversationRecoveryState,
    'transcript' | 'pendingRecoveryCheckpoint' | 'recoveryCheckpointTimer'
  >;
  readonly missionState: Pick<MissionSessionState, 'mission'>;
  readonly effects: Pick<
    ChatEffects,
    | 'setSessionRunning'
    | 'isCurrentTurn'
    | 'failTurn'
    | 'loadHistoryTimed'
    | 'refreshContextAfterTurn'
    | 'setTurnStatus'
    | 'startLiveChanges'
    | 'reconnectRecoveredIde'
  >;
}
