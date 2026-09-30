import type { AttachmentStage } from './attachmentImageProtocol';
import {
  ATTACHMENT_KINDS,
  IMAGE_MEDIA_TYPES,
  IMAGE_ORIGINS,
  WORKSPACE_IMAGE_STATUSES,
} from './bounds';

/**
 * Which staging area an attachment operation targets: the composer
 * staging area (default, field absent) or the per-message edit
 * staging area opened by `editStage.begin`.
 */
/**
 * Asks the host to open a native file picker and stage the chosen
 * files as pending attachments for the next prompt.
 */
export interface AttachmentPickMessage {
  readonly type: 'attachment.pick';
  readonly sessionId: string;
  readonly stage?: AttachmentStage;
}

/** Stages the active editor document as a pending text attachment. */
export interface AttachmentAddEditorMessage {
  readonly type: 'attachment.addEditor';
  readonly sessionId: string;
  readonly stage?: AttachmentStage;
}

/** Stages the active editor selection as a pending text attachment. */
export interface AttachmentAddSelectionMessage {
  readonly type: 'attachment.addSelection';
  readonly sessionId: string;
  readonly stage?: AttachmentStage;
}

/** Stages current workspace diagnostics as a pending text attachment. */
export interface AttachmentAddProblemsMessage {
  readonly type: 'attachment.addProblems';
  readonly sessionId: string;
  readonly stage?: AttachmentStage;
}

/**
 * Stages uncommitted git changes (working tree vs HEAD) as a pending
 * text attachment.
 */
export interface AttachmentAddGitChangesMessage {
  readonly type: 'attachment.addGitChanges';
  readonly sessionId: string;
  readonly stage?: AttachmentStage;
}

/**
 * Longest accepted base64 payload for one dropped or pasted image:
 * the base64 encoding of the 4 MB original-file cap shared with the
 * host file picker (`MAX_IMAGE_ATTACHMENT_BYTES`).
 */

/**
 * Stages one image dropped or pasted into the composer as a pending
 * attachment. This is the only webview-to-host message carrying
 * binary content; both validators bound its media type, name, and
 * base64 length.
 */
/**
 * Stages files dropped onto the composer from an editor explorer drag
 * (`text/uri-list`). The host resolves each `file://` URI, keeps only
 * files inside the workspace, and reads them through the same reader
 * as the attach-files picker.
 */
/** Removes one staged attachment by its host-assigned id. */
export interface AttachmentRemoveMessage {
  readonly type: 'attachment.remove';
  readonly sessionId: string;
  readonly attachmentId: string;
  readonly stage?: AttachmentStage;
}

/**
 * Asks the host to read a workspace-local image referenced by
 * transcript markdown so the webview can display it. The reply is a
 * `workspace.imageData` message keyed by the same path.
 */
export interface WorkspaceReadImageMessage {
  readonly type: 'workspace.readImage';
  readonly sessionId: string;
  readonly path: string;
}

/**
 * Stages one workspace file, named by its validated relative path, as
 * a pending attachment for the next prompt.
 */
export interface AttachmentAddPathMessage {
  readonly type: 'attachment.addPath';
  readonly sessionId: string;
  readonly path: string;
  readonly stage?: AttachmentStage;
}

/**
 * Enters edit mode for one sent user message: the host initializes
 * the edit staging area, prefilled with the retained payloads of the
 * attachments that message was sent with.
 */
export interface EditStageBeginMessage {
  readonly type: 'editStage.begin';
  readonly sessionId: string;
  readonly messageId: string;
}

/** Leaves edit mode: the host discards the edit staging area. */
export interface EditStageCancelMessage {
  readonly type: 'editStage.cancel';
  readonly sessionId: string;
}

export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];

/**
 * Safe metadata about one staged attachment. Content bytes stay on the
 * host; the webview only renders and removes chips.
 */
export interface AttachmentSummary {
  readonly id: string;
  readonly kind: AttachmentKind;
  readonly name: string;
  readonly sizeBytes: number;
  readonly truncated: boolean;
}

/**
 * Metadata about one attachment a sent user message carried. Only
 * metadata crosses the bridge; image attachments are represented by
 * their own image transcript items instead of entries here.
 */
export interface SentAttachmentSummary {
  readonly kind: AttachmentKind;
  readonly name: string;
  readonly sizeBytes: number;
}

export type ImageMediaType = (typeof IMAGE_MEDIA_TYPES)[number];

export type ImageOrigin = (typeof IMAGE_ORIGINS)[number];

/**
 * One image rendered inline in the transcript. `data` is the pure
 * base64 payload (no data-URI prefix); an empty string marks a
 * placeholder whose bytes were dropped (oversized or evicted by the
 * session image budget) while `byteLength` keeps the original size.
 */
export interface ImageTranscriptItem {
  readonly id: string;
  readonly kind: 'image';
  readonly turnId: string;
  readonly origin: ImageOrigin;
  /** SDK user message owning this image, independent of content block order. */
  readonly userMessageId?: string;
  readonly mediaType: ImageMediaType;
  readonly data: string;
  /** True for images the assistant generated (shows a badge). */
  readonly generated: boolean;
  /** Decoded binary size in bytes; kept for placeholder rows. */
  readonly byteLength: number;
}

/** Current staged attachments for the active session. */
export interface SessionAttachmentsStateMessage {
  readonly type: 'session.attachments';
  readonly sequence: number;
  readonly sessionId: string;
  readonly attachments: readonly AttachmentSummary[];
}

/**
 * One entry of the edit staging area: attachment chip metadata plus
 * whether the original payload is still available to resend.
 * `restorable: false` entries (evicted from the retention area or
 * predating this window) can only be removed, not kept.
 */
export interface EditAttachmentSummary extends AttachmentSummary {
  readonly restorable: boolean;
}

/** Current edit staging area contents for one message being edited. */
export interface SessionEditAttachmentsStateMessage {
  readonly type: 'session.editAttachments';
  readonly sequence: number;
  readonly sessionId: string;
  readonly messageId: string;
  readonly attachments: readonly EditAttachmentSummary[];
}

export type WorkspaceImageStatus = (typeof WORKSPACE_IMAGE_STATUSES)[number];

/**
 * Bytes for one `workspace.readImage` request. `data` is the pure
 * base64 payload (no data-URI prefix) and is empty unless `status` is
 * `ok`; non-ok statuses let the markdown renderer degrade to a
 * clickable path link with an accurate reason.
 */
export interface WorkspaceImageDataMessage {
  readonly type: 'workspace.imageData';
  readonly sequence: number;
  readonly sessionId: string;
  readonly path: string;
  readonly status: WorkspaceImageStatus;
  readonly mediaType: ImageMediaType | null;
  readonly data: string;
}

/**
 * Appends one image transcript item during a live turn: an image the
 * user attached to the prompt, an image block the assistant created,
 * or an image embedded in a tool result.
 */
export interface TranscriptImageMessage {
  readonly type: 'transcript.image';
  readonly sequence: number;
  readonly sessionId: string;
  readonly turnId: string;
  readonly item: ImageTranscriptItem;
}
