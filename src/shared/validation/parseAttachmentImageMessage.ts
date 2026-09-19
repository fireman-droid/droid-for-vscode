import { IMAGE_MEDIA_TYPES, MAX_ATTACHMENT_NAME_LENGTH } from '../protocol/bounds';
import {
  MAX_ATTACHMENT_IMAGE_BASE64_LENGTH,
  MAX_ATTACHMENT_PDF_BASE64_LENGTH,
  MAX_ATTACHMENT_REMOTE_URL_LENGTH,
  type AttachmentAddImageMessage,
  type AttachmentAddPdfMessage,
  type AttachmentAddRemoteImageMessage,
  type AttachmentReadImageMessage,
} from '../bridgeMessages';
import { hasExactKeys, type UnknownRecord } from './strictValidation';

type AttachmentImageMessage =
  | AttachmentAddImageMessage
  | AttachmentAddPdfMessage
  | AttachmentAddRemoteImageMessage
  | AttachmentReadImageMessage;

const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

export function parseAttachmentImageMessage(
  value: UnknownRecord,
  isId: (value: unknown) => value is string,
  hasValidStage: (value: UnknownRecord) => value is UnknownRecord & { stage?: 'edit' },
): AttachmentImageMessage | undefined {
  switch (value.type) {
    case 'attachment.addImage':
      return parseImage(value, isId, hasValidStage);
    case 'attachment.addPdf':
      return parsePdf(value, isId, hasValidStage);
    case 'attachment.addRemoteImage':
      return parseRemote(value, isId, hasValidStage);
    case 'attachment.readImage':
      return parseRead(value, isId, hasValidStage);
    default:
      return undefined;
  }
}

function parseImage(
  value: UnknownRecord,
  isId: (value: unknown) => value is string,
  hasValidStage: (value: UnknownRecord) => value is UnknownRecord & { stage?: 'edit' },
): AttachmentAddImageMessage | undefined {
  if (
    !hasExactKeys(
      value,
      ['type', 'sessionId', 'name', 'mediaType', 'dataBase64'],
      ['stage', 'replaceAttachmentId'],
    ) ||
    !isId(value.sessionId) ||
    !hasValidStage(value) ||
    !isAttachmentName(value.name) ||
    typeof value.mediaType !== 'string' ||
    !(IMAGE_MEDIA_TYPES as readonly string[]).includes(value.mediaType) ||
    !isBase64(value.dataBase64, MAX_ATTACHMENT_IMAGE_BASE64_LENGTH) ||
    (value.replaceAttachmentId !== undefined && !isId(value.replaceAttachmentId))
  ) {
    return undefined;
  }
  return {
    type: 'attachment.addImage',
    sessionId: value.sessionId,
    name: value.name,
    mediaType: value.mediaType as AttachmentAddImageMessage['mediaType'],
    dataBase64: value.dataBase64,
    ...stageOf(value),
    ...(value.replaceAttachmentId === undefined
      ? {}
      : { replaceAttachmentId: value.replaceAttachmentId }),
  };
}

function parsePdf(
  value: UnknownRecord,
  isId: (value: unknown) => value is string,
  hasValidStage: (value: UnknownRecord) => value is UnknownRecord & { stage?: 'edit' },
): AttachmentAddPdfMessage | undefined {
  if (
    !hasExactKeys(value, ['type', 'sessionId', 'name', 'dataBase64'], ['stage']) ||
    !isId(value.sessionId) ||
    !hasValidStage(value) ||
    !isAttachmentName(value.name) ||
    !isBase64(value.dataBase64, MAX_ATTACHMENT_PDF_BASE64_LENGTH)
  ) {
    return undefined;
  }
  return {
    type: 'attachment.addPdf',
    sessionId: value.sessionId,
    name: value.name,
    dataBase64: value.dataBase64,
    ...stageOf(value),
  };
}

function parseRemote(
  value: UnknownRecord,
  isId: (value: unknown) => value is string,
  hasValidStage: (value: UnknownRecord) => value is UnknownRecord & { stage?: 'edit' },
): AttachmentAddRemoteImageMessage | undefined {
  if (
    !hasExactKeys(value, ['type', 'sessionId', 'url'], ['stage']) ||
    !isId(value.sessionId) ||
    !hasValidStage(value) ||
    !isPublicHttpsUrlShape(value.url)
  ) {
    return undefined;
  }
  return {
    type: 'attachment.addRemoteImage',
    sessionId: value.sessionId,
    url: value.url,
    ...stageOf(value),
  };
}

function parseRead(
  value: UnknownRecord,
  isId: (value: unknown) => value is string,
  hasValidStage: (value: UnknownRecord) => value is UnknownRecord & { stage?: 'edit' },
): AttachmentReadImageMessage | undefined {
  if (
    !hasExactKeys(value, ['type', 'sessionId', 'attachmentId'], ['stage']) ||
    !isId(value.sessionId) ||
    !isId(value.attachmentId) ||
    !hasValidStage(value)
  ) {
    return undefined;
  }
  return {
    type: 'attachment.readImage',
    sessionId: value.sessionId,
    attachmentId: value.attachmentId,
    ...stageOf(value),
  };
}

function isAttachmentName(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_ATTACHMENT_NAME_LENGTH &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

function isBase64(value: unknown, maxLength: number): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length % 4 === 0 &&
    value.length <= maxLength &&
    BASE64_PATTERN.test(value)
  );
}

function isPublicHttpsUrlShape(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_ATTACHMENT_REMOTE_URL_LENGTH ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    return false;
  }
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      url.hostname.length > 0 &&
      url.username.length === 0 &&
      url.password.length === 0
    );
  } catch {
    return false;
  }
}

function stageOf(value: { stage?: 'edit' }): { stage?: 'edit' } {
  return value.stage === undefined ? {} : { stage: value.stage };
}
