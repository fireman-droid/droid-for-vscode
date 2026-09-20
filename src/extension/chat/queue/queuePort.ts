import type { ChatEffects } from '../chatEffects';
import type { HostOperations } from '../hostOperations';
import type { AttachmentStagingState } from '../attachments/AttachmentStagingState';
import type { QueueState } from './QueueState';
import type { SessionLifecycleState } from '../sessions/SessionLifecycleState';
import type { TurnState } from '../turns/TurnState';
export interface QueuePort
  extends Pick<
    HostOperations,
    | 'recordHost'
    | 'interactions'
    | 'metadata'
    | 'emitSnapshot'
    | 'emitSessionDiagnostic'
    | 'emit'
    | 'recoveryStore'
  > {
  readonly ideReconnectInProgress?: boolean;
  readonly sessionState: Readonly<
    Pick<
      SessionLifecycleState,
      | 'runtime'
      | 'connection'
      | 'conversationId'
      | 'sessionId'
      | 'runtimeGeneration'
      | 'sessionOperationInProgress'
      | 'disposed'
    >
  >;
  readonly turnState: Readonly<Pick<TurnState, 'turn' | 'turnGeneration'>>;
  readonly attachmentState: Pick<AttachmentStagingState, 'pendingAttachments'>;
  readonly queueState: Pick<QueueState, 'queuedPrompts' | 'queueSendNowIntent'>;
  readonly effects: Pick<ChatEffects, 'emitAttachments' | 'handleStop' | 'handleSend'>;
}
