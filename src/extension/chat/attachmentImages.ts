import type {
  AttachmentStage,
  ImageMediaType,
} from '../../shared/bridgeMessages';
import { MAX_PENDING_ATTACHMENTS } from '../../shared/bridgeMessages';
import { base64ByteLength } from '../../shared/transcriptLimits';
import {
  MAX_IMAGE_ATTACHMENT_BYTES,
  MAX_PDF_ATTACHMENT_BYTES,
  type AttachmentPayload,
} from '../attachmentSources';
import type { ChatControllerInternals } from './internals';
import {
  ATTACHMENT_LIMIT_MESSAGE,
  ATTACHMENT_TOO_LARGE_MESSAGE,
  ATTACHMENT_UNSUPPORTED_TYPE_MESSAGE,
  canStageAttachments,
  emitAttachments,
  emitEditAttachments,
  stagedCount,
  stageAttachmentPayloads,
  toRuntimeAttachment,
} from './attachments';

const ATTACHMENT_REMOTE_FAILED_MESSAGE =
  'The public HTTPS image could not be attached.';
const ATTACHMENT_REPLACE_FAILED_MESSAGE =
  'The staged image could not be updated.';

export function handleAttachmentAddImage(
  ctl: ChatControllerInternals,
  sessionId: string,
  name: string,
  mediaType: ImageMediaType,
  dataBase64: string,
  stage?: AttachmentStage,
  replaceAttachmentId?: string,
): void {
  if (!canStageAttachments(ctl, sessionId, stage)) {
    return;
  }
  if (
    replaceAttachmentId === undefined &&
    stagedCount(ctl, stage) >= MAX_PENDING_ATTACHMENTS
  ) {
    ctl.emitSessionDiagnostic('attachment-limit', ATTACHMENT_LIMIT_MESSAGE);
    return;
  }
  const sizeBytes = base64ByteLength(dataBase64);
  if (sizeBytes > MAX_IMAGE_ATTACHMENT_BYTES) {
    ctl.emitSessionDiagnostic(
      'attachment-rejected',
      ATTACHMENT_TOO_LARGE_MESSAGE,
    );
    return;
  }
  const payload: AttachmentPayload = {
    kind: 'image',
    name,
    data: dataBase64,
    mediaType,
    sizeBytes,
    truncated: false,
  };
  if (replaceAttachmentId !== undefined) {
    replaceStagedImage(ctl, replaceAttachmentId, payload, stage);
    return;
  }
  stageAttachmentPayloads(ctl, [payload], undefined, stage);
}

export function handleAttachmentAddPdf(
  ctl: ChatControllerInternals,
  sessionId: string,
  name: string,
  dataBase64: string,
  stage?: AttachmentStage,
): void {
  if (!canStageAttachments(ctl, sessionId, stage)) {
    return;
  }
  if (stagedCount(ctl, stage) >= MAX_PENDING_ATTACHMENTS) {
    ctl.emitSessionDiagnostic('attachment-limit', ATTACHMENT_LIMIT_MESSAGE);
    return;
  }
  const sizeBytes = base64ByteLength(dataBase64);
  if (sizeBytes > MAX_PDF_ATTACHMENT_BYTES) {
    ctl.emitSessionDiagnostic(
      'attachment-rejected',
      ATTACHMENT_TOO_LARGE_MESSAGE,
    );
    return;
  }
  stageAttachmentPayloads(ctl, [{
    kind: 'pdf',
    name,
    data: dataBase64,
    sizeBytes,
    truncated: false,
  }], undefined, stage);
}

export function handleAttachmentAddRemoteImage(
  ctl: ChatControllerInternals,
  sessionId: string,
  url: string,
  stage?: AttachmentStage,
): void {
  if (!canStageAttachments(ctl, sessionId, stage)) {
    return;
  }
  if (stagedCount(ctl, stage) >= MAX_PENDING_ATTACHMENTS) {
    ctl.emitSessionDiagnostic('attachment-limit', ATTACHMENT_LIMIT_MESSAGE);
    return;
  }
  const read = ctl.attachmentSources.readRemoteImage;
  if (read === undefined) {
    ctl.emitSessionDiagnostic(
      'attachment-remote-failed',
      ATTACHMENT_REMOTE_FAILED_MESSAGE,
    );
    return;
  }
  ctl.attachmentOperationInProgress = true;
  void read(url).then(
    (outcome) => {
      ctl.attachmentOperationInProgress = false;
      if (sessionId !== ctl.sessionId) {
        return;
      }
      switch (outcome.status) {
        case 'picked':
          stageAttachmentPayloads(ctl, outcome.items, undefined, stage);
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
            'attachment-remote-failed',
            ATTACHMENT_REMOTE_FAILED_MESSAGE,
          );
          return;
        case 'cancelled':
          return;
      }
    },
    () => {
      ctl.attachmentOperationInProgress = false;
      if (sessionId === ctl.sessionId) {
        ctl.emitSessionDiagnostic(
          'attachment-remote-failed',
          ATTACHMENT_REMOTE_FAILED_MESSAGE,
        );
      }
    },
  );
}

export function handleAttachmentReadImage(
  ctl: ChatControllerInternals,
  sessionId: string,
  attachmentId: string,
  stage?: AttachmentStage,
): void {
  if (sessionId !== ctl.sessionId) {
    return;
  }
  const attachment =
    stage === 'edit'
      ? ctl.editStage?.attachments.find(
          ({ summary }) => summary.id === attachmentId,
        )
      : ctl.pendingAttachments.find(
          ({ summary }) => summary.id === attachmentId,
        );
  const runtime = attachment?.runtime;
  if (attachment === undefined || runtime?.kind !== 'image') {
    ctl.emit({
      type: 'session.attachmentImageData',
      sessionId,
      attachmentId,
      status: 'unavailable',
      ...(stage === undefined ? {} : { stage }),
    });
    return;
  }
  ctl.emit({
    type: 'session.attachmentImageData',
    sessionId,
    attachmentId,
    status: 'ready',
    name: attachment.summary.name,
    mediaType: runtime.mediaType,
    dataBase64: runtime.data,
    ...(stage === undefined ? {} : { stage }),
  });
}

function replaceStagedImage(
  ctl: ChatControllerInternals,
  attachmentId: string,
  payload: AttachmentPayload,
  stage?: AttachmentStage,
): void {
  const runtime = toRuntimeAttachment(payload);
  if (runtime?.kind !== 'image') {
    return;
  }
  if (stage === 'edit') {
    const editStage = ctl.editStage;
    if (editStage === null) {
      return;
    }
    const index = editStage.attachments.findIndex(
      ({ summary }) => summary.id === attachmentId,
    );
    const current = editStage.attachments[index];
    if (
      index < 0 ||
      current === undefined ||
      current.summary.kind !== 'image'
    ) {
      ctl.emitSessionDiagnostic(
        'attachment-replace-failed',
        ATTACHMENT_REPLACE_FAILED_MESSAGE,
      );
      return;
    }
    const next = [...editStage.attachments];
    next[index] = {
      summary: {
        ...current.summary,
        sizeBytes: payload.sizeBytes,
        truncated: false,
        restorable: true,
      },
      runtime,
    };
    editStage.attachments = next;
    emitEditAttachments(ctl);
    return;
  }
  const index = ctl.pendingAttachments.findIndex(
    ({ summary }) => summary.id === attachmentId,
  );
  const current = ctl.pendingAttachments[index];
  if (
    index < 0 ||
    current === undefined ||
    current.summary.kind !== 'image'
  ) {
    ctl.emitSessionDiagnostic(
      'attachment-replace-failed',
      ATTACHMENT_REPLACE_FAILED_MESSAGE,
    );
    return;
  }
  const next = [...ctl.pendingAttachments];
  next[index] = {
    summary: {
      ...current.summary,
      sizeBytes: payload.sizeBytes,
      truncated: false,
    },
    runtime,
  };
  ctl.pendingAttachments = next;
  emitAttachments(ctl);
}
