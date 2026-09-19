import type { ChatEffects } from '../chatEffects';
import type { HostOperations } from '../hostOperations';
import type { AttachmentStagingState } from './AttachmentStagingState';
import type { SessionLifecycleState } from '../sessions/SessionLifecycleState';
export interface AttachmentsPort
  extends Pick<HostOperations, 'emitSessionDiagnostic' | 'attachmentSources' | 'emit'> {
  readonly sessionState: Readonly<
    Pick<
      SessionLifecycleState,
      'runtime' | 'connection' | 'sessionId' | 'activeRuntimeCwd'
    >
  >;
  readonly attachmentState: Readonly<Pick<AttachmentStagingState, 'sentAttachments'>> &
    Pick<
      AttachmentStagingState,
      | 'pendingAttachments'
      | 'editStage'
      | 'pendingSentAttachments'
      | 'attachmentOperationInProgress'
      | 'attachmentIdCounter'
    >;
  readonly effects: Pick<ChatEffects, 'ensureActiveRuntimeWorkspaceCurrent'>;
}
