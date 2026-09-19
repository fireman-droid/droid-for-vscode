import type { ChatEffects } from '../chatEffects';
import type { HostOperations } from '../hostOperations';
import type { AttachmentStagingState } from './AttachmentStagingState';
import type { SessionLifecycleState } from '../sessions/SessionLifecycleState';
export interface AttachmentImagesPort
  extends Pick<HostOperations, 'emitSessionDiagnostic' | 'attachmentSources' | 'emit'> {
  readonly sessionState: Readonly<Pick<SessionLifecycleState, 'sessionId'>>;
  readonly attachmentState: Readonly<Pick<AttachmentStagingState, 'editStage'>> &
    Pick<AttachmentStagingState, 'pendingAttachments' | 'attachmentOperationInProgress'>;
  readonly effects: Pick<
    ChatEffects,
    | 'canStageAttachments'
    | 'stagedCount'
    | 'stageAttachmentPayloads'
    | 'emitEditAttachments'
    | 'emitAttachments'
  >;
}
