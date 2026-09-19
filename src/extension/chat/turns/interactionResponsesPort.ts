import type { ChatEffects } from '../chatEffects';
import type { HostOperations } from '../hostOperations';
import type { SessionLifecycleState } from '../sessions/SessionLifecycleState';
import type { TurnState } from './TurnState';
export interface InteractionResponsesPort
  extends Pick<HostOperations, 'planDocuments' | 'interactions'> {
  readonly sessionState: Readonly<Pick<SessionLifecycleState, 'sessionId'>>;
  readonly turnState: Readonly<Pick<TurnState, 'turn'>> & Pick<TurnState, 'specHandoff'>;
  readonly effects: Pick<ChatEffects, 'ensureActiveRuntimeWorkspaceCurrent'>;
}
