import { type EditAttachmentSummary } from '../../../shared/protocol/attachments';
import type { RewindDetailFields } from '../../../shared/protocol/rewindDetails';
import {
  type EditResendRejectReason,
  type RewindEvictedFile,
} from '../../../shared/protocol/turns';

export const EDIT_REJECT_COPY: Record<EditResendRejectReason, string> = {
  busy: 'Droid is busy — stop or finish the current work, then resend.',
  unsupported: 'This message can no longer anchor a resend.',
  failed: 'Rewinding to this message failed. You can try again.',
};

export interface RewindFileInfo extends RewindDetailFields {
  readonly messageId: string;
  readonly restorableCount: number;
  readonly createdCount: number;
  readonly restorablePaths: readonly string[];
  readonly createdPaths: readonly string[];
  readonly evictedFiles: readonly RewindEvictedFile[];
}

export interface EditStageState {
  readonly messageId: string;
  readonly attachments: readonly EditAttachmentSummary[];
}

export interface EditResendRejection {
  readonly messageId: string;
  readonly reason: EditResendRejectReason;
  readonly sequence: number;
}
