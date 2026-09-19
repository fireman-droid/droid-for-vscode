import { type ImageMediaType } from './attachments';

export type AttachmentStage = 'edit';
export const MAX_ATTACHMENT_IMAGE_BYTES = 4 * 1024 * 1024;
export const MAX_ATTACHMENT_PDF_BYTES = 6 * 1024 * 1024;
export const MAX_ATTACHMENT_IMAGE_BASE64_LENGTH = 5_592_408;
export const MAX_ATTACHMENT_PDF_BASE64_LENGTH = 8_388_608;
export const MAX_ATTACHMENT_REMOTE_URL_LENGTH = 2048;

export interface AttachmentAddImageMessage {
  readonly type: 'attachment.addImage';
  readonly sessionId: string;
  readonly name: string;
  readonly mediaType: ImageMediaType;
  readonly dataBase64: string;
  readonly stage?: AttachmentStage;
  readonly replaceAttachmentId?: string;
}

export interface AttachmentAddPdfMessage {
  readonly type: 'attachment.addPdf';
  readonly sessionId: string;
  readonly name: string;
  readonly dataBase64: string;
  readonly stage?: AttachmentStage;
}

export interface AttachmentAddRemoteImageMessage {
  readonly type: 'attachment.addRemoteImage';
  readonly sessionId: string;
  readonly url: string;
  readonly stage?: AttachmentStage;
}

export interface AttachmentReadImageMessage {
  readonly type: 'attachment.readImage';
  readonly sessionId: string;
  readonly attachmentId: string;
  readonly stage?: AttachmentStage;
}

export type SessionAttachmentImageDataMessage =
  | {
      readonly type: 'session.attachmentImageData';
      readonly sequence: number;
      readonly sessionId: string;
      readonly attachmentId: string;
      readonly status: 'ready';
      readonly name: string;
      readonly mediaType: ImageMediaType;
      readonly dataBase64: string;
      readonly stage?: AttachmentStage;
    }
  | {
      readonly type: 'session.attachmentImageData';
      readonly sequence: number;
      readonly sessionId: string;
      readonly attachmentId: string;
      readonly status: 'unavailable';
      readonly stage?: AttachmentStage;
    };
