import type { AttachmentKind } from '../../../shared/protocol/attachments';

export const ATTACHMENT_KIND_LABELS: Record<AttachmentKind, string> = {
  image: 'Image',
  pdf: 'PDF',
  text: 'File',
  editor: 'Editor',
  selection: 'Selection',
};

export function formatAttachmentBytes(byteLength: number): string {
  if (byteLength >= 1_048_576) return `${(byteLength / 1_048_576).toFixed(1)} MB`;
  if (byteLength >= 1_024) return `${Math.round(byteLength / 1_024)} KB`;
  return `${byteLength} B`;
}
