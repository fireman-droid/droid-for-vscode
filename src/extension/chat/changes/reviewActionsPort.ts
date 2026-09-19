import type { ChatEffects } from '../chatEffects';
import type { HostOperations } from '../hostOperations';
import type { SessionLifecycleState } from '../sessions/SessionLifecycleState';
import type { TurnState } from '../turns/TurnState';
export interface ReviewActionsPort extends Pick<HostOperations, 'reviewCoordinator'> {
  readonly sessionState: Readonly<
    Pick<SessionLifecycleState, 'connection' | 'sessionId'>
  >;
  readonly turnState: Readonly<Pick<TurnState, 'turn'>>;
  readonly effects: Pick<ChatEffects, 'readConversationTurnChanges'>;
}
