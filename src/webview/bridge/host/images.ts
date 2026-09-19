import { type HostToWebviewMessage } from '../../../shared/bridgeMessages';
import {
  type ImageMediaType,
  type ImageTranscriptItem,
  type WorkspaceImageStatus,
} from '../../../shared/protocol/attachments';
import {
  IMAGE_MEDIA_TYPES,
  MAX_IMAGE_DATA_LENGTH,
  MAX_IMAGE_PATH_LENGTH,
  WORKSPACE_IMAGE_STATUSES,
} from '../../../shared/protocol/bounds';
import {
  hasExactKeys,
  isStrictRecord,
  type UnknownRecord,
} from '../../../shared/validation/strictValidation';
import {
  BASE64_PATTERN,
  hasTurnIdentity,
  isCount,
  isId,
  isImageMediaType,
  isImageOrigin,
  isSequence,
} from './guards';

export function parseTranscriptImage(
  value: UnknownRecord,
): Extract<HostToWebviewMessage, { type: 'transcript.image' }> | undefined {
  if (
    !hasExactKeys(value, ['type', 'sequence', 'sessionId', 'turnId', 'item']) ||
    !hasTurnIdentity(value)
  ) {
    return undefined;
  }
  const item = parseImageTranscriptItem(value.item);
  if (item === undefined || item.turnId !== value.turnId) {
    return undefined;
  }
  return {
    type: 'transcript.image',
    sequence: value.sequence,
    sessionId: value.sessionId,
    turnId: value.turnId,
    item,
  };
}

export function parseImageTranscriptItem(
  value: unknown,
): ImageTranscriptItem | undefined {
  if (
    !isStrictRecord(value) ||
    !hasExactKeys(value, [
      'id',
      'kind',
      'turnId',
      'origin',
      'mediaType',
      'data',
      'generated',
      'byteLength',
    ]) ||
    value.kind !== 'image' ||
    !isId(value.id) ||
    !isId(value.turnId) ||
    !isImageOrigin(value.origin) ||
    !isImageMediaType(value.mediaType) ||
    typeof value.data !== 'string' ||
    value.data.length > MAX_IMAGE_DATA_LENGTH ||
    !BASE64_PATTERN.test(value.data) ||
    typeof value.generated !== 'boolean' ||
    !isCount(value.byteLength)
  ) {
    return undefined;
  }
  return {
    id: value.id,
    kind: 'image',
    turnId: value.turnId,
    origin: value.origin,
    mediaType: value.mediaType,
    data: value.data,
    generated: value.generated,
    byteLength: value.byteLength,
  };
}

export function parseWorkspaceImageData(
  value: UnknownRecord,
): Extract<HostToWebviewMessage, { type: 'workspace.imageData' }> | undefined {
  if (
    !hasExactKeys(value, [
      'type',
      'sequence',
      'sessionId',
      'path',
      'status',
      'mediaType',
      'data',
    ]) ||
    !isSequence(value.sequence) ||
    !isId(value.sessionId) ||
    typeof value.path !== 'string' ||
    value.path.length === 0 ||
    value.path.length > MAX_IMAGE_PATH_LENGTH ||
    typeof value.status !== 'string' ||
    !(WORKSPACE_IMAGE_STATUSES as readonly string[]).includes(value.status) ||
    typeof value.data !== 'string' ||
    value.data.length > MAX_IMAGE_DATA_LENGTH ||
    !BASE64_PATTERN.test(value.data)
  ) {
    return undefined;
  }
  const mediaType = value.mediaType;
  if (
    mediaType !== null &&
    (typeof mediaType !== 'string' ||
      !(IMAGE_MEDIA_TYPES as readonly string[]).includes(mediaType))
  ) {
    return undefined;
  }
  // Bytes require an ok status with a concrete media type.
  if (value.status === 'ok' && (mediaType === null || value.data.length === 0)) {
    return undefined;
  }
  if (value.status !== 'ok' && value.data.length > 0) {
    return undefined;
  }
  return {
    type: 'workspace.imageData',
    sequence: value.sequence,
    sessionId: value.sessionId,
    path: value.path,
    status: value.status as WorkspaceImageStatus,
    mediaType: mediaType as ImageMediaType | null,
    data: value.data,
  };
}
