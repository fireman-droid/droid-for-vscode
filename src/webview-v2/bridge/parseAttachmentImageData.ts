import {
  IMAGE_MEDIA_TYPES,
  MAX_ATTACHMENT_NAME_LENGTH,
} from '../../shared/protocol/bounds';
import {
  MAX_ATTACHMENT_IMAGE_BASE64_LENGTH,
  MAX_BRIDGE_ID_LENGTH,
  type SessionAttachmentImageDataMessage,
} from '../../shared/bridgeMessages';
import { type ImageMediaType } from '../../shared/protocol/attachments';
import {
  hasExactKeys,
  type UnknownRecord,
} from '../../shared/validation/strictValidation';

const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;

export function parseAttachmentImageData(
  value: UnknownRecord,
): SessionAttachmentImageDataMessage | undefined {
  if (
    !hasExactKeys(
      value,
      ['type', 'sequence', 'sessionId', 'attachmentId', 'status'],
      ['name', 'mediaType', 'dataBase64', 'stage'],
    ) ||
    !isSequence(value.sequence) ||
    !isId(value.sessionId) ||
    !isId(value.attachmentId) ||
    (value.stage !== undefined && value.stage !== 'edit')
  ) {
    return undefined;
  }
  if (value.status === 'unavailable') {
    if (
      value.name !== undefined ||
      value.mediaType !== undefined ||
      value.dataBase64 !== undefined
    ) {
      return undefined;
    }
    return {
      type: 'session.attachmentImageData',
      sequence: value.sequence,
      sessionId: value.sessionId,
      attachmentId: value.attachmentId,
      status: 'unavailable',
      ...(value.stage === undefined ? {} : { stage: 'edit' }),
    };
  }
  if (
    value.status !== 'ready' ||
    !isBoundedName(value.name) ||
    !isImageMediaType(value.mediaType) ||
    typeof value.dataBase64 !== 'string' ||
    value.dataBase64.length === 0 ||
    value.dataBase64.length % 4 !== 0 ||
    value.dataBase64.length > MAX_ATTACHMENT_IMAGE_BASE64_LENGTH ||
    !BASE64_PATTERN.test(value.dataBase64)
  ) {
    return undefined;
  }
  return {
    type: 'session.attachmentImageData',
    sequence: value.sequence,
    sessionId: value.sessionId,
    attachmentId: value.attachmentId,
    status: 'ready',
    name: value.name,
    mediaType: value.mediaType,
    dataBase64: value.dataBase64,
    ...(value.stage === undefined ? {} : { stage: 'edit' }),
  };
}

function isSequence(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_BRIDGE_ID_LENGTH &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

function isBoundedName(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_ATTACHMENT_NAME_LENGTH
  );
}

function isImageMediaType(value: unknown): value is ImageMediaType {
  return (
    typeof value === 'string' && (IMAGE_MEDIA_TYPES as readonly string[]).includes(value)
  );
}
