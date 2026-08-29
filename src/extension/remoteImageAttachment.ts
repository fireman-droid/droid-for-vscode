import { lookup } from 'node:dns/promises';
import { basename, extname } from 'node:path';
import { isIP } from 'node:net';
import { request } from 'node:https';

import type {
  AttachmentPayload,
  AttachmentPickOutcome,
} from './attachmentSources';
import { MAX_IMAGE_ATTACHMENT_BYTES } from './attachmentSources';
import type { RuntimeImageMediaType } from '../runtime/DroidRuntime';

const MAX_REDIRECTS = 4;
const REQUEST_TIMEOUT_MS = 10_000;
const MEDIA_TYPES = new Set<RuntimeImageMediaType>([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);

export async function readPublicHttpsImage(
  input: string,
): Promise<AttachmentPickOutcome> {
  try {
    const payload = await readImage(new URL(input), 0);
    return { status: 'picked', items: [payload] };
  } catch (error) {
    return error instanceof TooLargeError
      ? { status: 'rejected', reason: 'too-large' }
      : error instanceof UnsupportedRemoteImageError
        ? { status: 'rejected', reason: 'unsupported-type' }
        : { status: 'failed' };
  }
}

async function readImage(
  url: URL,
  redirectCount: number,
): Promise<AttachmentPayload> {
  validateUrl(url);
  const addresses = await lookup(url.hostname, {
    all: true,
    verbatim: true,
  });
  if (
    addresses.length === 0 ||
    addresses.some(({ address }) => !isPublicAddress(address))
  ) {
    throw new UnsupportedRemoteImageError();
  }
  const selected = addresses[0]!;
  return await new Promise<AttachmentPayload>((resolve, reject) => {
    const req = request(
      url,
      {
        method: 'GET',
        headers: {
          accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif',
        },
        lookup: (_hostname, _options, callback) => {
          callback(null, selected.address, selected.family);
        },
      },
      (response) => {
        const status = response.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          response.resume();
          const location = response.headers.location;
          if (location === undefined || redirectCount >= MAX_REDIRECTS) {
            reject(new UnsupportedRemoteImageError());
            return;
          }
          let target: URL;
          try {
            target = new URL(location, url);
          } catch (error) {
            reject(error);
            return;
          }
          void readImage(target, redirectCount + 1).then(resolve, reject);
          return;
        }
        if (status !== 200) {
          response.resume();
          reject(new Error(`Remote image returned HTTP ${status}.`));
          return;
        }
        const mediaType = parseMediaType(response.headers['content-type']);
        if (
          mediaType === null ||
          response.headers['content-encoding'] !== undefined
        ) {
          response.resume();
          reject(new UnsupportedRemoteImageError());
          return;
        }
        const declaredLength = Number(response.headers['content-length']);
        if (
          Number.isFinite(declaredLength) &&
          declaredLength > MAX_IMAGE_ATTACHMENT_BYTES
        ) {
          response.resume();
          reject(new TooLargeError());
          return;
        }
        const chunks: Buffer[] = [];
        let sizeBytes = 0;
        response.on('data', (chunk: Buffer) => {
          sizeBytes += chunk.byteLength;
          if (sizeBytes > MAX_IMAGE_ATTACHMENT_BYTES) {
            response.destroy(new TooLargeError());
            return;
          }
          chunks.push(chunk);
        });
        response.once('end', () => {
          if (sizeBytes === 0) {
            reject(new UnsupportedRemoteImageError());
            return;
          }
          const bytes = Buffer.concat(chunks, sizeBytes);
          if (!matchesImageSignature(bytes, mediaType)) {
            reject(new UnsupportedRemoteImageError());
            return;
          }
          resolve({
            kind: 'image',
            name: remoteImageName(url, mediaType),
            data: bytes.toString('base64'),
            mediaType,
            sizeBytes,
            truncated: false,
          });
        });
        response.once('error', reject);
      },
    );
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error('Remote image request timed out.'));
    });
    req.once('error', reject);
    req.end();
  });
}

function validateUrl(url: URL): void {
  if (
    url.protocol !== 'https:' ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.hostname.length === 0
  ) {
    throw new UnsupportedRemoteImageError();
  }
}

function parseMediaType(value: string | undefined): RuntimeImageMediaType | null {
  const mediaType = value?.split(';', 1)[0]?.trim().toLowerCase();
  return mediaType !== undefined &&
    MEDIA_TYPES.has(mediaType as RuntimeImageMediaType)
    ? mediaType as RuntimeImageMediaType
    : null;
}

function remoteImageName(url: URL, mediaType: RuntimeImageMediaType): string {
  const pathName = basename(decodeURIComponent(url.pathname));
  if (pathName.length > 0 && extname(pathName).length > 0) {
    return pathName;
  }
  const extension =
    mediaType === 'image/jpeg'
      ? '.jpg'
      : mediaType === 'image/png'
        ? '.png'
        : mediaType === 'image/gif'
          ? '.gif'
          : '.webp';
  return `remote-image${extension}`;
}

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const [a, b, c] = address.split('.').map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0 && c === 0) ||
      (a === 192 && b === 0 && c === 2) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113) ||
      a >= 224
    );
  }
  if (family !== 6) {
    return false;
  }
  const normalized = address.toLowerCase();
  if (normalized.startsWith('::ffff:')) {
    return isPublicAddress(normalized.slice('::ffff:'.length));
  }
  const first = Number.parseInt(normalized.split(':', 1)[0] ?? '', 16);
  return (
    first >= 0x2000 &&
    first <= 0x3fff &&
    !normalized.startsWith('2001:db8:')
  );
}

class TooLargeError extends Error {}
class UnsupportedRemoteImageError extends Error {}

function matchesImageSignature(
  bytes: Buffer,
  mediaType: RuntimeImageMediaType,
): boolean {
  switch (mediaType) {
    case 'image/jpeg':
      return (
        bytes.length >= 3 &&
        bytes[0] === 0xff &&
        bytes[1] === 0xd8 &&
        bytes[2] === 0xff
      );
    case 'image/png':
      return (
        bytes.length >= 8 &&
        bytes.subarray(0, 8).equals(
          Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        )
      );
    case 'image/gif':
      return (
        bytes.length >= 6 &&
        (bytes.subarray(0, 6).toString('ascii') === 'GIF87a' ||
          bytes.subarray(0, 6).toString('ascii') === 'GIF89a')
      );
    case 'image/webp':
      return (
        bytes.length >= 12 &&
        bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
        bytes.subarray(8, 12).toString('ascii') === 'WEBP'
      );
  }
}
