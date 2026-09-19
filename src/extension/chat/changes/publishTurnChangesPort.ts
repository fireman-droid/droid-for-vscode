import type { ChatEffects } from '../chatEffects';
import type { HostOperations } from '../hostOperations';
import type { ConversationRecoveryState } from '../recovery/ConversationRecoveryState';
import type { SessionLifecycleState } from '../sessions/SessionLifecycleState';
import type { TurnState } from '../turns/TurnState';
export interface PublishTurnChangesPort
  extends Pick<
    HostOperations,
    'recoveryStore' | 'reviewCoordinator' | 'emitSnapshot' | 'emit'
  > {
  readonly sessionState: Readonly<
    Pick<
      SessionLifecycleState,
      'conversationId' | 'sessionId' | 'runtimeGeneration' | 'disposed'
    >
  >;
  readonly turnState: Readonly<Pick<TurnState, 'turn'>>;
  readonly recoveryState: Pick<ConversationRecoveryState, 'transcript'>;
  readonly effects: Pick<ChatEffects, 'resolveSettledChangeFiles' | 'scheduleRecoveryCheckpoint'>;
}
