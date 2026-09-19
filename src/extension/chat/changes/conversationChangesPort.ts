import type { HostOperations } from '../hostOperations';
import type { SessionLifecycleState } from '../sessions/SessionLifecycleState';
export interface ConversationChangesPort extends Pick<HostOperations, 'recoveryStore'> {
  readonly sessionState: Readonly<Pick<SessionLifecycleState, 'conversationId'>>;
}
