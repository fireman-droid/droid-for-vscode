import {
  MAX_ATTACHMENT_TEXT_FILE_CHARS,
  MAX_ATTACHMENT_URI_LENGTH,
  type AttachmentAddTextFileMessage,
  type AttachmentAddUrisMessage,
} from '../bridgeMessages';
import {
  type AttachmentAddEditorMessage,
  type AttachmentAddGitChangesMessage,
  type AttachmentAddPathMessage,
  type AttachmentAddProblemsMessage,
  type AttachmentAddSelectionMessage,
  type AttachmentPickMessage,
  type AttachmentRemoveMessage,
  type EditStageBeginMessage,
  type EditStageCancelMessage,
} from '../protocol/attachments';
import { MAX_ATTACHMENT_NAME_LENGTH, MAX_ATTACHMENT_URI_COUNT } from '../protocol/bounds';
import { hasExactKeys, type UnknownRecord } from './strictValidation';
import { hasValidStage, isId, isSafeWorkspaceRelativePath, stageOf } from './guards';

export function parseAttachmentPick(
  value: UnknownRecord,
): AttachmentPickMessage | undefined {
  if (
    !hasExactKeys(value, ['type', 'sessionId'], ['stage']) ||
    !isId(value.sessionId) ||
    !hasValidStage(value)
  ) {
    return undefined;
  }

  return {
    type: 'attachment.pick',
    sessionId: value.sessionId,
    ...stageOf(value),
  };
}

export function parseAttachmentAddEditor(
  value: UnknownRecord,
): AttachmentAddEditorMessage | undefined {
  if (
    !hasExactKeys(value, ['type', 'sessionId'], ['stage']) ||
    !isId(value.sessionId) ||
    !hasValidStage(value)
  ) {
    return undefined;
  }

  return {
    type: 'attachment.addEditor',
    sessionId: value.sessionId,
    ...stageOf(value),
  };
}

export function parseAttachmentAddSelection(
  value: UnknownRecord,
): AttachmentAddSelectionMessage | undefined {
  if (
    !hasExactKeys(value, ['type', 'sessionId'], ['stage']) ||
    !isId(value.sessionId) ||
    !hasValidStage(value)
  ) {
    return undefined;
  }

  return {
    type: 'attachment.addSelection',
    sessionId: value.sessionId,
    ...stageOf(value),
  };
}

export function parseAttachmentAddProblems(
  value: UnknownRecord,
): AttachmentAddProblemsMessage | undefined {
  if (
    !hasExactKeys(value, ['type', 'sessionId'], ['stage']) ||
    !isId(value.sessionId) ||
    !hasValidStage(value)
  ) {
    return undefined;
  }

  return {
    type: 'attachment.addProblems',
    sessionId: value.sessionId,
    ...stageOf(value),
  };
}

export function parseAttachmentAddGitChanges(
  value: UnknownRecord,
): AttachmentAddGitChangesMessage | undefined {
  if (
    !hasExactKeys(value, ['type', 'sessionId'], ['stage']) ||
    !isId(value.sessionId) ||
    !hasValidStage(value)
  ) {
    return undefined;
  }

  return {
    type: 'attachment.addGitChanges',
    sessionId: value.sessionId,
    ...stageOf(value),
  };
}

export function parseAttachmentAddUris(
  value: UnknownRecord,
): AttachmentAddUrisMessage | undefined {
  if (
    !hasExactKeys(value, ['type', 'sessionId', 'uris'], ['stage']) ||
    !isId(value.sessionId) ||
    !hasValidStage(value) ||
    !Array.isArray(value.uris) ||
    value.uris.length === 0 ||
    value.uris.length > MAX_ATTACHMENT_URI_COUNT ||
    !value.uris.every(
      (uri) =>
        typeof uri === 'string' &&
        uri.startsWith('file://') &&
        uri.length <= MAX_ATTACHMENT_URI_LENGTH &&
        !/[\u0000-\u001f\u007f]/.test(uri),
    )
  ) {
    return undefined;
  }

  return {
    type: 'attachment.addUris',
    sessionId: value.sessionId,
    uris: [...(value.uris as readonly string[])],
    ...stageOf(value),
  };
}

export function parseAttachmentAddTextFile(
  value: UnknownRecord,
): AttachmentAddTextFileMessage | undefined {
  if (
    !hasExactKeys(value, ['type', 'sessionId', 'name', 'text', 'truncated'], ['stage']) ||
    !isId(value.sessionId) ||
    !hasValidStage(value) ||
    typeof value.name !== 'string' ||
    value.name.length === 0 ||
    value.name.length > MAX_ATTACHMENT_NAME_LENGTH ||
    /[\u0000-\u001f\u007f]/.test(value.name) ||
    typeof value.text !== 'string' ||
    value.text.length === 0 ||
    value.text.length > MAX_ATTACHMENT_TEXT_FILE_CHARS ||
    value.text.includes('\u0000') ||
    typeof value.truncated !== 'boolean'
  ) {
    return undefined;
  }

  return {
    type: 'attachment.addTextFile',
    sessionId: value.sessionId,
    name: value.name,
    text: value.text,
    truncated: value.truncated,
    ...stageOf(value),
  };
}

export function parseAttachmentRemove(
  value: UnknownRecord,
): AttachmentRemoveMessage | undefined {
  if (
    !hasExactKeys(value, ['type', 'sessionId', 'attachmentId'], ['stage']) ||
    !isId(value.sessionId) ||
    !isId(value.attachmentId) ||
    !hasValidStage(value)
  ) {
    return undefined;
  }

  return {
    type: 'attachment.remove',
    sessionId: value.sessionId,
    attachmentId: value.attachmentId,
    ...stageOf(value),
  };
}

export function parseAttachmentAddPath(
  value: UnknownRecord,
): AttachmentAddPathMessage | undefined {
  if (
    !hasExactKeys(value, ['type', 'sessionId', 'path'], ['stage']) ||
    !isId(value.sessionId) ||
    !isSafeWorkspaceRelativePath(value.path) ||
    !hasValidStage(value)
  ) {
    return undefined;
  }

  return {
    type: 'attachment.addPath',
    sessionId: value.sessionId,
    path: value.path,
    ...stageOf(value),
  };
}

export function parseEditStageBegin(
  value: UnknownRecord,
): EditStageBeginMessage | undefined {
  if (
    !hasExactKeys(value, ['type', 'sessionId', 'messageId']) ||
    !isId(value.sessionId) ||
    !isId(value.messageId)
  ) {
    return undefined;
  }

  return {
    type: 'editStage.begin',
    sessionId: value.sessionId,
    messageId: value.messageId,
  };
}

export function parseEditStageCancel(
  value: UnknownRecord,
): EditStageCancelMessage | undefined {
  if (!hasExactKeys(value, ['type', 'sessionId']) || !isId(value.sessionId)) {
    return undefined;
  }

  return { type: 'editStage.cancel', sessionId: value.sessionId };
}
