import type { HostOperations } from '../hostOperations';
import type { ConversationRecoveryState } from '../recovery/ConversationRecoveryState';
import type { SessionLifecycleState } from '../sessions/SessionLifecycleState';
import type { TurnState } from '../turns/TurnState';
export interface LiveChangesPort
  extends Pick<
    HostOperations,
    'turnSnapshots' | 'changeStats' | 'reviewCoordinator' | 'emit'
  > {
  readonly sessionState: Readonly<
    Pick<SessionLifecycleState, 'sessionId' | 'runtimeGeneration' | 'disposed'>
  >;
  readonly turnState: Readonly<Pick<TurnState, 'turn'>>;
  readonly recoveryState: Pick<ConversationRecoveryState, 'transcript'>;
}
