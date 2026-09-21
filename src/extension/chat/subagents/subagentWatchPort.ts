import type { HostOperations } from '../hostOperations';
import type { ConversationRecoveryState } from '../recovery/ConversationRecoveryState';
import type { MissionSessionState } from '../mission/MissionSessionState';
import type { SessionLifecycleState } from '../sessions/SessionLifecycleState';
import type { SubagentWatchState } from './SubagentWatchState';
import type { TurnState } from '../turns/TurnState';
export interface SubagentWatchPort
  extends Pick<
    HostOperations,
    | 'sessionHistory'
    | 'recordHost'
    | 'emit'
    | 'metadata'
    | 'recoveryStore'
    | 'emitSnapshot'
  > {
  readonly sessionState: Readonly<
    Pick<
      SessionLifecycleState,
      | 'runtime'
      | 'conversationId'
      | 'sessionId'
      | 'runtimeGeneration'
      | 'activeRuntimeCwd'
      | 'sessionOperationInProgress'
      | 'disposed'
    >
  >;
  readonly turnState: Readonly<Pick<TurnState, 'turn' | 'turnGeneration'>>;
  readonly recoveryState: Pick<ConversationRecoveryState, 'transcript'>;
  readonly missionState: Pick<MissionSessionState, 'mission'>;
  readonly subagentState: Pick<SubagentWatchState, 'zombieSubagentWatch'>;
}
