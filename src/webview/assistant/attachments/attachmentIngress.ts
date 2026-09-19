import {
  IMAGE_MEDIA_TYPES,
  MAX_ATTACHMENT_URI_COUNT,
} from '../../../shared/protocol/bounds';
import {
  MAX_ATTACHMENT_IMAGE_BYTES,
  MAX_ATTACHMENT_PDF_BYTES,
  MAX_ATTACHMENT_TEXT_FILE_CHARS,
  MAX_ATTACHMENT_REMOTE_URL_LENGTH,
  MAX_ATTACHMENT_URI_LENGTH,
} from '../../../shared/bridgeMessages';
import { type ImageMediaType } from '../../../shared/protocol/attachments';

export function isImageMediaType(value: string): value is ImageMediaType {
  return (IMAGE_MEDIA_TYPES as readonly string[]).includes(value);
}

export function readDroppedFileUris(
  dataTransfer: Pick<DataTransfer, 'getData'>,
): readonly string[] {
  const plain = dataTransfer.getData('text/uri-list');
  let entries = plain
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
  if (entries.length === 0) {
    const code = dataTransfer.getData('application/vnd.code.uri-list');
    if (code.length > 0) {
      try {
        const parsed: unknown = JSON.parse(code);
        entries = Array.isArray(parsed)
          ? parsed.filter((entry): entry is string => typeof entry === 'string')
          : [];
      } catch {
        entries = code
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => line.length > 0);
      }
    }
  }
  return entries
    .filter((uri) => uri.startsWith('file://') && uri.length <= MAX_ATTACHMENT_URI_LENGTH)
    .slice(0, MAX_ATTACHMENT_URI_COUNT);
}

export function readDroppedRemoteImageUrl(
  dataTransfer: Pick<DataTransfer, 'getData'>,
): string | null {
  const candidates = [
    ...dataTransfer
      .getData('text/uri-list')
      .split(/\r?\n/)
      .map((value) => value.trim()),
    dataTransfer.getData('text/plain').trim(),
  ];
  const html = dataTransfer.getData('text/html');
  const htmlSrc = html.match(/<img\b[^>]*\bsrc=["']([^"']+)["']/i)?.[1];
  if (htmlSrc !== undefined) {
    candidates.push(htmlSrc);
  }
  for (const candidate of candidates) {
    if (candidate.length === 0 || candidate.length > MAX_ATTACHMENT_REMOTE_URL_LENGTH) {
      continue;
    }
    try {
      const url = new URL(candidate);
      if (
        url.protocol === 'https:' &&
        url.username.length === 0 &&
        url.password.length === 0
      ) {
        return url.href;
      }
    } catch {
      // Keep looking through the bounded drag formats.
    }
  }
  return null;
}

export function readFileAsBase64(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onerror = () => resolve(null);
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        resolve(null);
        return;
      }
      const separator = result.indexOf(',');
      resolve(separator === -1 ? null : result.slice(separator + 1));
    };
    reader.readAsDataURL(file);
  });
}

export type PreparedAttachment =
  | {
      readonly kind: 'image';
      readonly name: string;
      readonly mediaType: ImageMediaType;
      readonly data: string;
    }
  | { readonly kind: 'pdf'; readonly name: string; readonly data: string }
  | {
      readonly kind: 'text';
      readonly name: string;
      readonly text: string;
      readonly truncated: boolean;
    }
  | { readonly kind: 'notice'; readonly message: string };

/** Decode untrusted dropped bytes once; UI staging and preview ownership stay with the caller. */
export async function prepareAttachment(file: File): Promise<PreparedAttachment> {
  if (file.size === 0) {
    return {
      kind: 'notice',
      message: `${file.name || 'File'} is empty and was not attached.`,
    };
  }
  const image = isImageMediaType(file.type);
  const pdf =
    file.type === 'application/pdf' || file.name.toLocaleLowerCase().endsWith('.pdf');
  if (image || pdf) {
    const maxBytes = image ? MAX_ATTACHMENT_IMAGE_BYTES : MAX_ATTACHMENT_PDF_BYTES;
    if (file.size > maxBytes) {
      return {
        kind: 'notice',
        message: `${file.name || 'File'} is too large to attach (${maxBytes / 1024 / 1024} MB max).`,
      };
    }
    const data = await readFileAsBase64(file);
    if (data === null)
      return { kind: 'notice', message: `${file.name || 'File'} could not be read.` };
    return image
      ? {
          kind: 'image',
          name: file.name.trim() || 'pasted-image',
          mediaType: file.type as ImageMediaType,
          data,
        }
      : { kind: 'pdf', name: file.name || 'document.pdf', data };
  }
  const byteCap = MAX_ATTACHMENT_TEXT_FILE_CHARS * 4;
  let raw: string;
  try {
    raw = await (file.size > byteCap ? file.slice(0, byteCap) : file).text();
  } catch {
    return { kind: 'notice', message: `${file.name} could not be read.` };
  }
  if (raw.includes('\u0000')) {
    return {
      kind: 'notice',
      message: `${file.name} is not a text file. Use “+” → Attach files instead.`,
    };
  }
  return {
    kind: 'text',
    name: file.name,
    text: raw.slice(0, MAX_ATTACHMENT_TEXT_FILE_CHARS),
    truncated: file.size > byteCap || raw.length > MAX_ATTACHMENT_TEXT_FILE_CHARS,
  };
}
