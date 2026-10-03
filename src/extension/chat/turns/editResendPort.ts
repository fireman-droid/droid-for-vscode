import type { ChatEffects } from '../chatEffects';
import type { HostOperations } from '../hostOperations';
import type { AttachmentStagingState } from '../attachments/AttachmentStagingState';
import type { ConversationRecoveryState } from '../recovery/ConversationRecoveryState';
import type { QueueState } from '../queue/QueueState';
import type { SessionDirectoryState } from '../sessions/SessionDirectoryState';
import type { SessionLifecycleState } from '../sessions/SessionLifecycleState';
import type { TurnState } from './TurnState';
export interface EditResendPort
  extends Pick<
    HostOperations,
    | 'emit'
    | 'diagnostics'
    | 'interactions'
    | 'metadata'
    | 'emitSessionDiagnostic'
    | 'emitSnapshot'
    | 'isCurrentSessionOperation'
  > {
  readonly sessionState: Readonly<
    Pick<
      SessionLifecycleState,
      'runtime' | 'connection' | 'runtimeGeneration' | 'activeRuntimeCwd' | 'conversationId' | 'sessionId'
    >
  > &
    Pick<
      SessionLifecycleState,
      'sessionOperationInProgress'
    >;
  readonly catalogState: Readonly<Pick<SessionDirectoryState, 'refreshInProgress'>> &
    Pick<SessionDirectoryState, 'sessions'>;
  readonly turnState: Readonly<Pick<TurnState, 'turn'>>;
  readonly attachmentState: Readonly<Pick<AttachmentStagingState, 'sentAttachments'>> &
    Pick<AttachmentStagingState, 'editStage' | 'attachmentIdCounter'>;
  readonly queueState: Readonly<Pick<QueueState, 'queuedPrompts'>>;
  readonly recoveryState: Pick<ConversationRecoveryState, 'transcript'>;
  readonly effects: Pick<
    ChatEffects,
    | 'ensureActiveRuntimeWorkspaceCurrent'
    | 'commitSessionBinding'
    | 'handleSend'
    | 'createDurableForkConversation'
    | 'clearPendingAttachments'
    | 'emitEditAttachments'
    | 'armReplayedSubagentWatch'
  >;
}
