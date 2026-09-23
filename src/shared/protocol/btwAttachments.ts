import type { ImageMediaType } from './attachments';
import { IMAGE_MEDIA_TYPES, MAX_ATTACHMENT_NAME_LENGTH, MAX_IMAGES_PER_TURN } from './bounds';
import { MAX_ATTACHMENT_IMAGE_BASE64_LENGTH } from './attachmentImageProtocol';
import { isId } from '../validation/guards';
import { hasExactKeys, isStrictRecord } from '../validation/strictValidation';

export interface BtwImageSummary {
  readonly id: string;
  readonly name: string;
}
export interface BtwImage extends BtwImageSummary {
  readonly mediaType: ImageMediaType;
  readonly dataBase64: string;
}

export function isBtwImageSummaries(value: unknown): value is readonly BtwImageSummary[] {
  return Array.isArray(value) && value.length <= MAX_IMAGES_PER_TURN &&
    new Set(value.map((image) => isStrictRecord(image) ? image.id : undefined)).size === value.length &&
    value.every((image) => isStrictRecord(image) && hasExactKeys(image, ['id', 'name']) && validSummary(image));
}

export function isBtwImages(value: unknown): value is readonly BtwImage[] {
  return Array.isArray(value) && value.length <= MAX_IMAGES_PER_TURN &&
    new Set(value.map((image) => isStrictRecord(image) ? image.id : undefined)).size === value.length &&
    value.every((image) => isStrictRecord(image) && hasExactKeys(image, ['id', 'name', 'mediaType', 'dataBase64']) &&
      validSummary(image) && (IMAGE_MEDIA_TYPES as readonly unknown[]).includes(image.mediaType) &&
      typeof image.dataBase64 === 'string' && image.dataBase64.length > 0 &&
      image.dataBase64.length <= MAX_ATTACHMENT_IMAGE_BASE64_LENGTH && image.dataBase64.length % 4 === 0 &&
      /^[A-Za-z0-9+/]+={0,2}$/.test(image.dataBase64));
}

function validSummary(image: Record<string, unknown>): boolean {
  return isId(image.id) && typeof image.name === 'string' && image.name.length > 0 &&
    image.name.length <= MAX_ATTACHMENT_NAME_LENGTH && !/[\u0000-\u001f\u007f]/.test(image.name);
}

export function btwImageSummaries(images: readonly BtwImage[] | undefined): readonly BtwImageSummary[] | undefined {
  return images?.map(({ id, name }) => ({ id, name }));
}
