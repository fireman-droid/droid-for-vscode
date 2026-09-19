import type { HostOperations } from '../hostOperations';
import type { SessionLifecycleState } from '../sessions/SessionLifecycleState';
import type { TurnState } from './TurnState';
export interface ThinkingBatchPort extends Pick<HostOperations, 'emit'> {
  readonly sessionState: Readonly<
    Pick<SessionLifecycleState, 'sessionId' | 'runtimeGeneration' | 'disposed'>
  >;
  readonly turnState: Readonly<Pick<TurnState, 'turn' | 'turnGeneration'>>;
}
