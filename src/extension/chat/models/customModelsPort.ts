import type { ChatEffects } from '../chatEffects';
import type { HostOperations } from '../hostOperations';
import type { CustomModelState } from './CustomModelState';
import type { QueueState } from '../queue/QueueState';
import type { SessionDirectoryState } from '../sessions/SessionDirectoryState';
import type { SessionLifecycleState } from '../sessions/SessionLifecycleState';
import type { TurnState } from '../turns/TurnState';
export interface CustomModelsPort
  extends Pick<
    HostOperations,
    | 'recordHost'
    | 'sessionRequestDropReason'
    | 'recordDroppedPanelRequest'
    | 'modelDiscovery'
    | 'isCurrentSessionOperation'
    | 'recordPanelFailure'
    | 'daemonCustomModels'
    | 'interactions'
    | 'metadata'
    | 'emit'
  > {
  readonly sessionState: Readonly<
    Pick<
      SessionLifecycleState,
      | 'runtime'
      | 'connection'
      | 'sessionId'
      | 'runtimeGeneration'
      | 'activeRuntimeCwd'
      | 'sessionOperationInProgress'
    >
  >;
  readonly catalogState: Readonly<Pick<SessionDirectoryState, 'refreshInProgress'>>;
  readonly turnState: Readonly<Pick<TurnState, 'turn'>>;
  readonly queueState: Readonly<Pick<QueueState, 'queuedPrompts'>>;
  readonly customModelState: Pick<
    CustomModelState,
    'customModelsDiscoveryAbort' | 'customModelsOp' | 'providerTests'
  >;
  readonly effects: Pick<ChatEffects, 'handleProviderModels' | 'startReplacement'>;
}
