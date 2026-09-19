import type { AttachmentStage } from './attachmentImageProtocol';

export const MAX_ATTACHMENT_URI_LENGTH = 2048;
export const MAX_ATTACHMENT_TEXT_FILE_CHARS = 262_144;

export interface AttachmentAddUrisMessage {
  readonly type: 'attachment.addUris';
  readonly sessionId: string;
  readonly uris: readonly string[];
  readonly stage?: AttachmentStage;
}

export interface AttachmentAddTextFileMessage {
  readonly type: 'attachment.addTextFile';
  readonly sessionId: string;
  readonly name: string;
  readonly text: string;
  readonly truncated: boolean;
  readonly stage?: AttachmentStage;
}
