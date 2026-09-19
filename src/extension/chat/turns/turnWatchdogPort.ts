import type { ChatEffects } from '../chatEffects';
import type { HostOperations } from '../hostOperations';
import type { ConversationRecoveryState } from '../recovery/ConversationRecoveryState';
import type { MissionSessionState } from '../mission/MissionSessionState';
import type { SessionLifecycleState } from '../sessions/SessionLifecycleState';
import type { TurnState } from './TurnState';
export interface TurnWatchdogPort
  extends Pick<
    HostOperations,
    | 'recordHost'
    | 'emit'
    | 'interactions'
    | 'terminalMirror'
    | 'metadata'
    | 'emitSnapshot'
  > {
  readonly sessionState: Readonly<
    Pick<
      SessionLifecycleState,
      'runtime' | 'sessionId' | 'runtimeGeneration' | 'activeRuntimeCwd' | 'disposed'
    >
  >;
  readonly turnState: Readonly<Pick<TurnState, 'turn'>> &
    Pick<TurnState, 'turnGeneration' | 'turnWatchdog'>;
  readonly recoveryState: Pick<ConversationRecoveryState, 'transcript'>;
  readonly missionState: Pick<MissionSessionState, 'mission'>;
  readonly effects: Pick<
    ChatEffects,
    | 'loadHistoryTimed'
    | 'flushPendingThinking'
    | 'publishTurnChanges'
    | 'setTurnStatus'
    | 'flushRecoveryCheckpointInBackground'
    | 'settleTurnSubagents'
    | 'refreshContextAfterTurn'
  >;
}
