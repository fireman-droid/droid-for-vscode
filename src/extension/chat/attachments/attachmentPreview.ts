import type { AttachmentPreviewRequest } from '../../../shared/protocol/attachmentPreviewProtocol';
import { MAX_ATTACHMENT_TEXT_FILE_CHARS } from '../../../shared/protocol/attachmentDropProtocol';
import type { AttachmentImagesPort } from './attachmentImagesPort';

export function handleAttachmentPreview(
  ctl: Pick<AttachmentImagesPort, 'sessionState' | 'attachmentState' | 'emit'>,
  request: AttachmentPreviewRequest,
): void {
  if (request.sessionId !== ctl.sessionState.sessionId) return;
  const attachments = request.stage === 'edit'
    ? ctl.attachmentState.editStage?.attachments : ctl.attachmentState.pendingAttachments;
  const attachment = attachments?.find(({ summary }) => summary.id === request.attachmentId);
  const runtime = attachment?.runtime;
  const base = { type: 'session.attachmentPreview' as const, sessionId: request.sessionId,
    attachmentId: request.attachmentId, ...(request.stage === undefined ? {} : { stage: request.stage }) };
  if (!attachment || runtime?.kind !== 'text') {
    ctl.emit({ ...base, status: 'unavailable' });
    return;
  }
  // Preview the staged bytes that will be sent, never a newly read path on disk.
  ctl.emit({ ...base, status: 'ready', text: runtime.data.slice(0, MAX_ATTACHMENT_TEXT_FILE_CHARS),
    truncated: attachment.summary.truncated || runtime.data.length > MAX_ATTACHMENT_TEXT_FILE_CHARS });
}
