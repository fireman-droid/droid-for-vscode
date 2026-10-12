import type { AttachmentStage } from './attachmentImageProtocol';
import { MAX_ATTACHMENT_TEXT_FILE_CHARS } from './attachmentDropProtocol';
import { hasValidStage, isId, stageOf } from '../validation/guards';
import { hasExactKeys, isStrictRecord } from '../validation/strictValidation';

export interface AttachmentPreviewRequest {
  readonly type: 'attachment.preview';
  readonly sessionId: string;
  readonly attachmentId: string;
  readonly stage?: AttachmentStage;
}

export type AttachmentPreviewContent =
  | { readonly status: 'ready'; readonly text: string; readonly truncated: boolean }
  | { readonly status: 'unavailable' };

export type AttachmentPreviewResponse = AttachmentPreviewContent & {
  readonly type: 'session.attachmentPreview';
  readonly sequence: number;
  readonly sessionId: string;
  readonly attachmentId: string;
  readonly stage?: AttachmentStage;
};

export function parseAttachmentPreviewRequest(value: unknown): AttachmentPreviewRequest | undefined {
  if (!isStrictRecord(value) || value.type !== 'attachment.preview' ||
    !hasExactKeys(value, ['type', 'sessionId', 'attachmentId'], ['stage']) ||
    !isId(value.sessionId) || !isId(value.attachmentId) || !hasValidStage(value)) return undefined;
  return { type: 'attachment.preview', sessionId: value.sessionId, attachmentId: value.attachmentId, ...stageOf(value) };
}

export function parseAttachmentPreviewResponse(value: unknown): AttachmentPreviewResponse | undefined {
  if (!isStrictRecord(value) || value.type !== 'session.attachmentPreview' ||
    !hasExactKeys(value, ['type', 'sequence', 'sessionId', 'attachmentId', 'status'], ['stage', 'text', 'truncated']) ||
    !Number.isSafeInteger(value.sequence) || (value.sequence as number) < 0 ||
    !isId(value.sessionId) || !isId(value.attachmentId) || !hasValidStage(value)) return undefined;
  const base = { type: 'session.attachmentPreview' as const, sequence: value.sequence as number,
    sessionId: value.sessionId, attachmentId: value.attachmentId, ...stageOf(value) };
  if (value.status === 'unavailable' && value.text === undefined && value.truncated === undefined)
    return { ...base, status: 'unavailable' };
  if (value.status !== 'ready' || typeof value.text !== 'string' || value.text.length > MAX_ATTACHMENT_TEXT_FILE_CHARS ||
    typeof value.truncated !== 'boolean') return undefined;
  return { ...base, status: 'ready', text: value.text, truncated: value.truncated };
}
