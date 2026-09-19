import { type EditStage, type PendingAttachment } from '../internals';
export class AttachmentStagingState {
  pendingAttachments: PendingAttachment[] = [];
  editStage: EditStage | null = null;
  readonly sentAttachments = new Map<string, readonly PendingAttachment[]>();
  pendingSentAttachments: {
    readonly turnId: string;
    readonly attachments: readonly PendingAttachment[];
  } | null = null;
  attachmentOperationInProgress = false;
  attachmentIdCounter = 0;
}
