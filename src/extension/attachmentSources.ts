import type { RuntimeImageMediaType } from '../runtime/DroidRuntime';
import {
  MAX_ATTACHMENT_IMAGE_BYTES,
  MAX_ATTACHMENT_PDF_BYTES,
} from '../shared/bridgeMessages';

/** Original file-size cap for one image attachment. */
export const MAX_IMAGE_ATTACHMENT_BYTES = MAX_ATTACHMENT_IMAGE_BYTES;
/** Original file-size cap for one PDF attachment. */
export const MAX_PDF_ATTACHMENT_BYTES = MAX_ATTACHMENT_PDF_BYTES;
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

/**
 * Notice appended inside the payload when a selection is cut at the
 * text-attachment cap, so the model knows the excerpt is partial.
 */
export const SELECTION_TRUNCATION_NOTICE =
  '\n[selection truncated at the attachment size limit]';

/**
 * Formats one editor selection as a self-describing text attachment:
 * a fenced code block headed `startLine:endLine:relativePath` (the
 * citation form models already know) so Droid can locate the excerpt
 * without the file itself. The fence grows past any backtick run in
 * the selection, and the wrapper plus truncation notice count against
 * `MAX_TEXT_ATTACHMENT_CHARS` so the payload never exceeds the
 * runtime text-attachment cap.
 */
export function selectionAttachmentPayload(args: {
  readonly displayName: string;
  readonly relativePath: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly text: string;
}): AttachmentPayload {
  const { displayName, relativePath, startLine, endLine, text } = args;
  let fenceLength = 3;
  for (const run of text.matchAll(/`{3,}/g)) {
    fenceLength = Math.max(fenceLength, run[0].length + 1);
  }
  const fence = '`'.repeat(fenceLength);
  const open = `${fence}${startLine}:${endLine}:${relativePath}\n`;
  const close = `\n${fence}`;
  const truncated =
    open.length + text.length + close.length >
    MAX_TEXT_ATTACHMENT_CHARS;
  const body = truncated
    ? text.slice(
        0,
        MAX_TEXT_ATTACHMENT_CHARS -
          open.length -
          close.length -
          SELECTION_TRUNCATION_NOTICE.length,
      )
    : text;
  const data = truncated
    ? `${open}${body}${close}${SELECTION_TRUNCATION_NOTICE}`
    : `${open}${body}${close}`;
  return {
    kind: 'text',
    name: `${displayName}:${startLine}-${endLine}`,
    data,
    sizeBytes: Buffer.byteLength(data, 'utf8'),
    truncated,
  };
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
  /**
   * Matches workspace files by name fragment for `@` mentions.
   * Returns bounded workspace-relative forward-slash paths.
   */
  searchWorkspaceFiles(
    query: string,
    maxResults: number,
  ): Promise<readonly string[]>;
  /**
   * Lists files open in editor tabs for the empty `@` query, as
   * deduplicated workspace-relative forward-slash paths in tab order.
   * Optional: hosts without a tab UI simply have no open editors.
   */
  listOpenEditorFiles?(maxResults: number): readonly string[];
  /** Reads one workspace file by validated relative path. */
  readWorkspaceFile(
    relativePath: string,
  ): Promise<AttachmentPickOutcome>;
  /** Fetches one public HTTPS image through the host trust boundary. */
  readRemoteImage?(
    url: string,
  ): Promise<AttachmentPickOutcome>;
  /** Captures current workspace diagnostics as a text attachment. */
  readProblems(): Promise<AttachmentCaptureOutcome>;
  /**
   * Captures uncommitted git changes (working tree vs HEAD) as a text
   * attachment.
   */
  readGitChanges(): Promise<AttachmentCaptureOutcome>;
}

export function createUnavailableAttachmentSources(): AttachmentSources {
  return {
    pickFiles: () => Promise.resolve({ status: 'failed' }),
    readActiveEditor: () => Promise.resolve({ status: 'failed' }),
    readActiveSelection: () => Promise.resolve({ status: 'failed' }),
    searchWorkspaceFiles: () => Promise.resolve([]),
    listOpenEditorFiles: () => [],
    readWorkspaceFile: () => Promise.resolve({ status: 'failed' }),
    readProblems: () => Promise.resolve({ status: 'failed' }),
    readGitChanges: () => Promise.resolve({ status: 'failed' }),
  };
}
