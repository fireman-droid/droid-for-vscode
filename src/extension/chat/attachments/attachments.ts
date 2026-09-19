import type { AttachmentsPort } from './attachmentsPort';
import { isAbsolute, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { RuntimeAttachment } from '../../../runtime/DroidRuntime';
import { type AttachmentStage } from '../../../shared/bridgeMessages';
import {
  type AttachmentKind,
  type AttachmentSummary,
  type ImageTranscriptItem,
  type SentAttachmentSummary,
} from '../../../shared/protocol/attachments';
import {
  MAX_ATTACHMENT_NAME_LENGTH,
  MAX_IMAGE_DATA_LENGTH,
  MAX_PENDING_ATTACHMENTS,
} from '../../../shared/protocol/bounds';
import { base64ByteLength } from '../../../shared/transcript/transcriptLimits';
import { isSafeWorkspaceRelativePath } from '../../../shared/validation/guards';
import {
  type AttachmentCaptureOutcome,
  type AttachmentPayload,
  type AttachmentPickOutcome,
} from '../../attachments/attachmentSources';
import { stableTranscriptId } from '../../recovery/hostTranscriptState';
import type { PendingAttachment } from '../internals';

/**
 * Byte budget for retained sent-attachment payloads (memory only):
 * 8 attachments x 4 MB fits exactly one maximal message, covering
 * the common "edit the latest message" case.
 */
const MAX_SENT_ATTACHMENT_RETENTION_BYTES = 32 * 1024 * 1024;

export const ATTACHMENT_LIMIT_MESSAGE = `Up to ${MAX_PENDING_ATTACHMENTS} attachments can be staged for one message.`;

export const ATTACHMENT_TOO_LARGE_MESSAGE = 'That file is too large to attach.';

export const ATTACHMENT_UNSUPPORTED_TYPE_MESSAGE = 'That file type cannot be attached.';

export const ATTACHMENT_READ_FAILED_MESSAGE =
  'The selected content could not be read for attachment.';

export const ATTACHMENT_OUTSIDE_WORKSPACE_MESSAGE =
  'Dropped files must be inside the current workspace.';

export const ATTACHMENT_NO_EDITOR_MESSAGE =
  'Open a text editor first to attach its contents.';

export const ATTACHMENT_NO_PROBLEMS_MESSAGE = 'There are no problems to attach.';

export const ATTACHMENT_NO_GIT_CHANGES_MESSAGE =
  'There are no uncommitted git changes to attach.';

export const ATTACHMENT_NO_SELECTION_MESSAGE =
  'Select text in an editor first to attach the selection.';

export function canStageAttachments(
  ctl: AttachmentsPort,
  sessionId: string,
  stage?: AttachmentStage,
): boolean {
  return (
    sessionId === ctl.sessionState.sessionId &&
    ctl.sessionState.runtime !== null &&
    ctl.sessionState.connection.status === 'connected' &&
    !ctl.attachmentState.attachmentOperationInProgress &&
    (stage !== 'edit' || ctl.attachmentState.editStage !== null) &&
    ctl.effects.ensureActiveRuntimeWorkspaceCurrent()
  );
}

/** How many attachments the targeted staging area already holds. */
export function stagedCount(ctl: AttachmentsPort, stage?: AttachmentStage): number {
  return stage === 'edit'
    ? (ctl.attachmentState.editStage?.attachments.length ?? 0)
    : ctl.attachmentState.pendingAttachments.length;
}

export function handleAttachmentPick(
  ctl: AttachmentsPort,
  sessionId: string,
  stage?: AttachmentStage,
): void {
  if (!canStageAttachments(ctl, sessionId, stage)) {
    return;
  }
  const remaining = MAX_PENDING_ATTACHMENTS - stagedCount(ctl, stage);
  if (remaining <= 0) {
    ctl.emitSessionDiagnostic('attachment-limit', ATTACHMENT_LIMIT_MESSAGE);
    return;
  }
  ctl.attachmentState.attachmentOperationInProgress = true;
  void ctl.attachmentSources.pickFiles(remaining).then(
    (outcome) => {
      ctl.attachmentState.attachmentOperationInProgress = false;
      if (sessionId !== ctl.sessionState.sessionId) {
        return;
      }
      switch (outcome.status) {
        case 'picked':
          stageAttachmentPayloads(ctl, outcome.items, undefined, stage);
          return;
        case 'cancelled':
          return;
        case 'rejected':
          ctl.emitSessionDiagnostic(
            'attachment-rejected',
            outcome.reason === 'too-large'
              ? ATTACHMENT_TOO_LARGE_MESSAGE
              : ATTACHMENT_UNSUPPORTED_TYPE_MESSAGE,
          );
          return;
        case 'failed':
          ctl.emitSessionDiagnostic(
            'attachment-read-failed',
            ATTACHMENT_READ_FAILED_MESSAGE,
          );
          return;
      }
    },
    () => {
      ctl.attachmentState.attachmentOperationInProgress = false;
      if (sessionId === ctl.sessionState.sessionId) {
        ctl.emitSessionDiagnostic(
          'attachment-read-failed',
          ATTACHMENT_READ_FAILED_MESSAGE,
        );
      }
    },
  );
}

export function handleAttachmentCapture(
  ctl: AttachmentsPort,
  sessionId: string,
  capture: 'editor' | 'selection' | 'problems' | 'git-changes',
  stage?: AttachmentStage,
): void {
  if (!canStageAttachments(ctl, sessionId, stage)) {
    return;
  }
  if (stagedCount(ctl, stage) >= MAX_PENDING_ATTACHMENTS) {
    ctl.emitSessionDiagnostic('attachment-limit', ATTACHMENT_LIMIT_MESSAGE);
    return;
  }
  ctl.attachmentState.attachmentOperationInProgress = true;
  const read =
    capture === 'editor'
      ? ctl.attachmentSources.readActiveEditor()
      : capture === 'selection'
        ? ctl.attachmentSources.readActiveSelection()
        : capture === 'problems'
          ? ctl.attachmentSources.readProblems()
          : ctl.attachmentSources.readGitChanges();
  void read.then(
    (outcome) => {
      ctl.attachmentState.attachmentOperationInProgress = false;
      if (sessionId !== ctl.sessionState.sessionId) {
        return;
      }
      switch (outcome.status) {
        case 'captured':
          stageAttachmentPayloads(
            ctl,
            [outcome.item],
            capture === 'editor' || capture === 'selection' ? capture : undefined,
            stage,
          );
          return;
        case 'empty':
          ctl.emitSessionDiagnostic(
            'attachment-empty',
            capture === 'editor'
              ? ATTACHMENT_NO_EDITOR_MESSAGE
              : capture === 'selection'
                ? ATTACHMENT_NO_SELECTION_MESSAGE
                : capture === 'problems'
                  ? ATTACHMENT_NO_PROBLEMS_MESSAGE
                  : ATTACHMENT_NO_GIT_CHANGES_MESSAGE,
          );
          return;
        case 'failed':
          ctl.emitSessionDiagnostic(
            'attachment-read-failed',
            ATTACHMENT_READ_FAILED_MESSAGE,
          );
          return;
      }
    },
    () => {
      ctl.attachmentState.attachmentOperationInProgress = false;
      if (sessionId === ctl.sessionState.sessionId) {
        ctl.emitSessionDiagnostic(
          'attachment-read-failed',
          ATTACHMENT_READ_FAILED_MESSAGE,
        );
      }
    },
  );
}

/**
 * Stages a selection the `droidvisx.addSelectionToChat` command read
 * at invoke time. The read happens before a cold-starting session
 * exists (QA v0.3 P1-1: the capture must survive however long the
 * connect takes), so this consumes a ready-made outcome instead of
 * reading the editor like `handleAttachmentCapture`. Returns false
 * while the session cannot accept attachments yet — the caller keeps
 * the capture and retries; empty and failed reads are consumed as the
 * same in-session diagnostics the webview `+` menu produces.
 */
export function stageCapturedSelectionOutcome(
  ctl: AttachmentsPort,
  sessionId: string,
  outcome: AttachmentCaptureOutcome,
): boolean {
  if (!canStageAttachments(ctl, sessionId)) {
    return false;
  }
  switch (outcome.status) {
    case 'captured':
      if (stagedCount(ctl) >= MAX_PENDING_ATTACHMENTS) {
        ctl.emitSessionDiagnostic('attachment-limit', ATTACHMENT_LIMIT_MESSAGE);
        return true;
      }
      stageAttachmentPayloads(ctl, [outcome.item], 'selection');
      return true;
    case 'empty':
      ctl.emitSessionDiagnostic('attachment-empty', ATTACHMENT_NO_SELECTION_MESSAGE);
      return true;
    case 'failed':
      ctl.emitSessionDiagnostic('attachment-read-failed', ATTACHMENT_READ_FAILED_MESSAGE);
      return true;
  }
}

export function handleAttachmentAddPath(
  ctl: AttachmentsPort,
  sessionId: string,
  path: string,
  stage?: AttachmentStage,
): void {
  if (!canStageAttachments(ctl, sessionId, stage)) {
    return;
  }
  if (stagedCount(ctl, stage) >= MAX_PENDING_ATTACHMENTS) {
    ctl.emitSessionDiagnostic('attachment-limit', ATTACHMENT_LIMIT_MESSAGE);
    return;
  }
  ctl.attachmentState.attachmentOperationInProgress = true;
  void ctl.attachmentSources.readWorkspaceFile(path).then(
    (outcome) => {
      ctl.attachmentState.attachmentOperationInProgress = false;
      if (sessionId !== ctl.sessionState.sessionId) {
        return;
      }
      switch (outcome.status) {
        case 'picked':
          stageAttachmentPayloads(ctl, outcome.items, undefined, stage);
          return;
        case 'cancelled':
          return;
        case 'rejected':
          ctl.emitSessionDiagnostic(
            'attachment-rejected',
            outcome.reason === 'too-large'
              ? ATTACHMENT_TOO_LARGE_MESSAGE
              : ATTACHMENT_UNSUPPORTED_TYPE_MESSAGE,
          );
          return;
        case 'failed':
          ctl.emitSessionDiagnostic(
            'attachment-read-failed',
            ATTACHMENT_READ_FAILED_MESSAGE,
          );
          return;
      }
    },
    () => {
      ctl.attachmentState.attachmentOperationInProgress = false;
      if (sessionId === ctl.sessionState.sessionId) {
        ctl.emitSessionDiagnostic(
          'attachment-read-failed',
          ATTACHMENT_READ_FAILED_MESSAGE,
        );
      }
    },
  );
}

/**
 * Stages one image dropped or pasted into the composer. The base64
 * payload already passed the bridge validator (media type
 * whitelist, base64 shape, 4 MB cap); the decoded-size check here
 * keeps this path bound by the same rule as the file picker.
 */
/**
 * Stages files dropped onto the composer as `file://` URIs (editor
 * explorer drags). URIs resolving outside the active workspace are
 * reported once as a diagnostic; the rest go through the same
 * workspace file reader as `attachment.addPath`.
 */
export function handleAttachmentAddUris(
  ctl: AttachmentsPort,
  sessionId: string,
  uris: readonly string[],
  stage?: AttachmentStage,
): void {
  if (!canStageAttachments(ctl, sessionId, stage)) {
    return;
  }
  const cwd = ctl.sessionState.activeRuntimeCwd;
  if (cwd === null) {
    return;
  }
  const relativePaths: string[] = [];
  let outsideWorkspace = false;
  for (const uri of uris) {
    let absolute: string;
    try {
      absolute = fileURLToPath(uri);
    } catch {
      outsideWorkspace = true;
      continue;
    }
    const relativePath = relative(cwd, absolute).replaceAll('\\', '/');
    if (
      relativePath.length === 0 ||
      relativePath.startsWith('..') ||
      isAbsolute(relativePath) ||
      !isSafeWorkspaceRelativePath(relativePath)
    ) {
      outsideWorkspace = true;
      continue;
    }
    relativePaths.push(relativePath);
  }
  if (outsideWorkspace) {
    ctl.emitSessionDiagnostic(
      'attachment-outside-workspace',
      ATTACHMENT_OUTSIDE_WORKSPACE_MESSAGE,
    );
  }
  if (relativePaths.length === 0) {
    return;
  }
  const remaining = MAX_PENDING_ATTACHMENTS - stagedCount(ctl, stage);
  if (remaining <= 0) {
    ctl.emitSessionDiagnostic('attachment-limit', ATTACHMENT_LIMIT_MESSAGE);
    return;
  }
  ctl.attachmentState.attachmentOperationInProgress = true;
  void (async () => {
    const payloads: AttachmentPayload[] = [];
    let rejectedReason: 'too-large' | 'unsupported-type' | null = null;
    let failed = false;
    for (const relativePath of relativePaths.slice(0, remaining)) {
      let outcome: AttachmentPickOutcome;
      try {
        outcome = await ctl.attachmentSources.readWorkspaceFile(relativePath);
      } catch {
        failed = true;
        continue;
      }
      switch (outcome.status) {
        case 'picked':
          payloads.push(...outcome.items);
          break;
        case 'rejected':
          rejectedReason = outcome.reason;
          break;
        case 'failed':
          failed = true;
          break;
        case 'cancelled':
          break;
      }
    }
    ctl.attachmentState.attachmentOperationInProgress = false;
    if (sessionId !== ctl.sessionState.sessionId) {
      return;
    }
    if (payloads.length > 0) {
      stageAttachmentPayloads(ctl, payloads, undefined, stage);
    }
    if (rejectedReason !== null) {
      ctl.emitSessionDiagnostic(
        'attachment-rejected',
        rejectedReason === 'too-large'
          ? ATTACHMENT_TOO_LARGE_MESSAGE
          : ATTACHMENT_UNSUPPORTED_TYPE_MESSAGE,
      );
    }
    if (failed) {
      ctl.emitSessionDiagnostic('attachment-read-failed', ATTACHMENT_READ_FAILED_MESSAGE);
    }
  })();
}

/**
 * Stages one non-image file dropped onto the composer whose text
 * content the webview already read and bounded. The bridge validator
 * enforced the character cap and rejected binary content.
 */
export function handleAttachmentAddTextFile(
  ctl: AttachmentsPort,
  sessionId: string,
  name: string,
  text: string,
  truncated: boolean,
  stage?: AttachmentStage,
): void {
  if (!canStageAttachments(ctl, sessionId, stage)) {
    return;
  }
  if (stagedCount(ctl, stage) >= MAX_PENDING_ATTACHMENTS) {
    ctl.emitSessionDiagnostic('attachment-limit', ATTACHMENT_LIMIT_MESSAGE);
    return;
  }
  stageAttachmentPayloads(
    ctl,
    [
      {
        kind: 'text',
        name,
        data: text,
        sizeBytes: Buffer.byteLength(text, 'utf8'),
        truncated,
      },
    ],
    undefined,
    stage,
  );
}

export function handleAttachmentRemove(
  ctl: AttachmentsPort,
  sessionId: string,
  attachmentId: string,
  stage?: AttachmentStage,
): void {
  if (sessionId !== ctl.sessionState.sessionId) {
    return;
  }
  if (stage === 'edit') {
    if (ctl.attachmentState.editStage === null) {
      return;
    }
    const next = ctl.attachmentState.editStage.attachments.filter(
      ({ summary }) => summary.id !== attachmentId,
    );
    if (next.length === ctl.attachmentState.editStage.attachments.length) {
      return;
    }
    ctl.attachmentState.editStage.attachments = next;
    emitEditAttachments(ctl);
    return;
  }
  const next = ctl.attachmentState.pendingAttachments.filter(
    ({ summary }) => summary.id !== attachmentId,
  );
  if (next.length === ctl.attachmentState.pendingAttachments.length) {
    return;
  }
  ctl.attachmentState.pendingAttachments = next;
  emitAttachments(ctl);
}

/**
 * Converts environment payloads into pending attachments. `capture`
 * overrides the display kind for editor and selection captures so
 * the chip communicates the source rather than the payload format.
 */
export function stageAttachmentPayloads(
  ctl: AttachmentsPort,
  payloads: readonly AttachmentPayload[],
  capture?: 'editor' | 'selection',
  stage?: AttachmentStage,
): void {
  // The edit staging area may have been cancelled while an async
  // read (file picker, workspace file) was in flight; drop late
  // results instead of staging them into the composer.
  if (stage === 'edit' && ctl.attachmentState.editStage === null) {
    return;
  }
  let staged = 0;
  for (const payload of payloads) {
    if (
      payload.sourceSessionId !== undefined &&
      payload.sourceSessionId !== ctl.sessionState.sessionId
    ) {
      ctl.emitSessionDiagnostic('attachment-read-failed', ATTACHMENT_READ_FAILED_MESSAGE);
      continue;
    }
    if (stagedCount(ctl, stage) >= MAX_PENDING_ATTACHMENTS) {
      ctl.emitSessionDiagnostic('attachment-limit', ATTACHMENT_LIMIT_MESSAGE);
      break;
    }
    // Double-invoking a capture command (editor right-click "Add
    // Selection to Chat") staged two identical chips (QA v0.3
    // P2-5). The same source, file+range name, and content is
    // already represented, so ignore it silently.
    if (capture !== undefined && isDuplicateCapture(ctl, stage, capture, payload)) {
      continue;
    }
    const runtime = toRuntimeAttachment(payload);
    if (runtime === null) {
      continue;
    }
    ctl.attachmentState.attachmentIdCounter += 1;
    const kind: AttachmentKind = capture ?? payload.kind;
    const summary: AttachmentSummary = {
      id: `attachment-${ctl.attachmentState.attachmentIdCounter}`,
      kind,
      name: boundAttachmentName(payload.name),
      sizeBytes: payload.sizeBytes,
      truncated: payload.truncated,
    };
    if (stage === 'edit') {
      ctl.attachmentState.editStage!.attachments = [
        ...ctl.attachmentState.editStage!.attachments,
        { summary: { ...summary, restorable: true }, runtime },
      ];
    } else {
      ctl.attachmentState.pendingAttachments = [
        ...ctl.attachmentState.pendingAttachments,
        { summary, runtime },
      ];
    }
    staged += 1;
  }
  if (staged > 0) {
    if (stage === 'edit') {
      emitEditAttachments(ctl);
    } else {
      emitAttachments(ctl);
    }
  }
}

/**
 * An already-staged chip with the same capture kind, the same bounded
 * display name (file plus line range for selections), and the same
 * content marks a repeated capture of identical material.
 */
function isDuplicateCapture(
  ctl: AttachmentsPort,
  stage: AttachmentStage | undefined,
  capture: 'editor' | 'selection',
  payload: AttachmentPayload,
): boolean {
  const stagedEntries =
    stage === 'edit'
      ? (ctl.attachmentState.editStage?.attachments ?? [])
      : ctl.attachmentState.pendingAttachments;
  const name = boundAttachmentName(payload.name);
  // Edit-stage chips may carry no payload (restored from a summary
  // whose original bytes were evicted); those cannot match content.
  return stagedEntries.some(
    ({ summary, runtime }) =>
      runtime !== null &&
      summary.kind === capture &&
      summary.name === name &&
      runtime.data === payload.data,
  );
}

export function takePendingAttachments(
  ctl: AttachmentsPort,
): readonly PendingAttachment[] | undefined {
  if (ctl.attachmentState.pendingAttachments.length === 0) {
    return undefined;
  }
  const attachments = ctl.attachmentState.pendingAttachments;
  ctl.attachmentState.pendingAttachments = [];
  emitAttachments(ctl);
  return attachments;
}

export function clearPendingAttachments(ctl: AttachmentsPort): void {
  ctl.attachmentState.pendingAttachments = [];
  ctl.attachmentState.editStage = null;
  ctl.attachmentState.pendingSentAttachments = null;
}

/**
 * Moves the attachments consumed by `turnId` into the retention
 * area once the SDK reports the message id they were sent under.
 * Oldest entries are evicted in insertion order when the byte
 * budget overflows; an entry can evict itself if it alone exceeds
 * the budget.
 */
export function retainSentAttachments(
  ctl: AttachmentsPort,
  turnId: string,
  messageId: string,
): void {
  const pending = ctl.attachmentState.pendingSentAttachments;
  if (pending === null || pending.turnId !== turnId) {
    return;
  }
  ctl.attachmentState.pendingSentAttachments = null;
  ctl.attachmentState.sentAttachments.delete(messageId);
  ctl.attachmentState.sentAttachments.set(messageId, pending.attachments);
  let total = 0;
  for (const entries of ctl.attachmentState.sentAttachments.values()) {
    total += retentionBytes(entries);
  }
  for (const [key, entries] of ctl.attachmentState.sentAttachments) {
    if (total <= MAX_SENT_ATTACHMENT_RETENTION_BYTES) {
      break;
    }
    ctl.attachmentState.sentAttachments.delete(key);
    total -= retentionBytes(entries);
  }
}

export function emitAttachments(ctl: AttachmentsPort): void {
  if (ctl.sessionState.sessionId === null) {
    return;
  }
  ctl.emit({
    type: 'session.attachments',
    sessionId: ctl.sessionState.sessionId,
    attachments: ctl.attachmentState.pendingAttachments.map(({ summary }) => summary),
  });
}

export function emitEditAttachments(ctl: AttachmentsPort): void {
  if (ctl.sessionState.sessionId === null || ctl.attachmentState.editStage === null) {
    return;
  }
  ctl.emit({
    type: 'session.editAttachments',
    sessionId: ctl.sessionState.sessionId,
    messageId: ctl.attachmentState.editStage.messageId,
    attachments: ctl.attachmentState.editStage.attachments.map(({ summary }) => summary),
  });
}

/**
 * Projects the image attachments of an accepted prompt as user-origin
 * image transcript items right after the prompt text. The stream does
 * not echo user images back, so this is their only live projection.
 */
export function echoUserImageAttachments(
  ctl: AttachmentsPort,
  sessionId: string,
  turnId: string,
  attachments: readonly RuntimeAttachment[] | undefined,
): void {
  if (attachments === undefined) {
    return;
  }
  let index = 0;
  for (const attachment of attachments) {
    if (attachment.kind !== 'image') {
      continue;
    }
    const oversized = attachment.data.length > MAX_IMAGE_DATA_LENGTH;
    const item: ImageTranscriptItem = {
      id: stableTranscriptId('image', turnId, 'user-echo', String(index)),
      kind: 'image',
      turnId,
      origin: 'user',
      mediaType: attachment.mediaType,
      data: oversized ? '' : attachment.data,
      generated: false,
      byteLength: base64ByteLength(attachment.data),
    };
    ctl.emit({
      type: 'transcript.image',
      sessionId,
      turnId,
      item,
    });
    index += 1;
  }
}

export function toRuntimeAttachment(
  payload: AttachmentPayload,
): RuntimeAttachment | null {
  switch (payload.kind) {
    case 'image':
      return payload.mediaType === undefined
        ? null
        : {
            kind: 'image',
            data: payload.data,
            mediaType: payload.mediaType,
          };
    case 'pdf':
      return { kind: 'pdf', data: payload.data, name: payload.name };
    case 'text':
      return { kind: 'text', data: payload.data, name: payload.name };
  }
}

export /**
 * Chip metadata for the non-image attachments a prompt was sent with.
 * Image attachments are represented by their own image transcript
 * items (user-echo), so they are excluded here.
 */
function sentAttachmentSummaries(
  attachments: readonly PendingAttachment[],
): readonly SentAttachmentSummary[] | undefined {
  const summaries = attachments
    .filter(({ summary }) => summary.kind !== 'image')
    .map(({ summary }) => ({
      kind: summary.kind,
      name: summary.name,
      sizeBytes: summary.sizeBytes,
    }));
  return summaries.length > 0 ? summaries : undefined;
}

export function retentionBytes(attachments: readonly PendingAttachment[]): number {
  let total = 0;
  for (const { runtime } of attachments) {
    total += runtime.data.length;
  }
  return total;
}

export function boundAttachmentName(name: string): string {
  const trimmed = name.trim();
  const safe = trimmed.length === 0 ? 'attachment' : trimmed;
  return safe.length > MAX_ATTACHMENT_NAME_LENGTH
    ? safe.slice(0, MAX_ATTACHMENT_NAME_LENGTH)
    : safe;
}
