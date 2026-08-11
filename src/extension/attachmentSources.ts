import type { RuntimeImageMediaType } from '../runtime/DroidRuntime';

/** Original file-size cap for one image attachment. */
export const MAX_IMAGE_ATTACHMENT_BYTES = 4 * 1024 * 1024;
/** Original file-size cap for one PDF attachment. */
export const MAX_PDF_ATTACHMENT_BYTES = 6 * 1024 * 1024;
/** Character cap for one text attachment; longer text is truncated. */
export const MAX_TEXT_ATTACHMENT_CHARS = 256 * 1024;

export type AttachmentPayloadKind = 'image' | 'pdf' | 'text';

/**
 * One file or editor capture read by the host environment. `data` is
 * base64 for images and PDFs and plain UTF-8 text otherwise. Payload
 * bytes never cross the bridge; the webview only sees metadata.
 */
export interface AttachmentPayload {
  readonly kind: AttachmentPayloadKind;
  readonly name: string;
  readonly data: string;
  readonly mediaType?: RuntimeImageMediaType;
  readonly sizeBytes: number;
  readonly truncated: boolean;
}

export type AttachmentPickOutcome =
  | { readonly status: 'picked'; readonly items: readonly AttachmentPayload[] }
  | { readonly status: 'cancelled' }
  | { readonly status: 'failed' }
  | {
      readonly status: 'rejected';
      readonly reason: 'too-large' | 'unsupported-type';
    };

export type AttachmentCaptureOutcome =
  | { readonly status: 'captured'; readonly item: AttachmentPayload }
  | { readonly status: 'empty' }
  | { readonly status: 'failed' };

/**
 * Host-environment access needed for attachments. Implemented with
 * VS Code APIs in production and stubbed in tests.
 */
export interface AttachmentSources {
  pickFiles(maxCount: number): Promise<AttachmentPickOutcome>;
  readActiveEditor(): Promise<AttachmentCaptureOutcome>;
  readActiveSelection(): Promise<AttachmentCaptureOutcome>;
}

export function createUnavailableAttachmentSources(): AttachmentSources {
  return {
    pickFiles: () => Promise.resolve({ status: 'failed' }),
    readActiveEditor: () => Promise.resolve({ status: 'failed' }),
    readActiveSelection: () => Promise.resolve({ status: 'failed' }),
  };
}
