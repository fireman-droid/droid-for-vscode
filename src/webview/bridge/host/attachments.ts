import { type HostToWebviewMessage } from '../../../shared/bridgeMessages';
import {
  type AttachmentKind,
  type AttachmentSummary,
  type EditAttachmentSummary,
} from '../../../shared/protocol/attachments';
import {
  ATTACHMENT_KINDS,
  EDIT_RESEND_REJECT_REASONS,
  MAX_ATTACHMENT_NAME_LENGTH,
  MAX_FILE_SEARCH_RESULTS,
  MAX_PENDING_ATTACHMENTS,
  MAX_REWIND_INFO_FILES,
} from '../../../shared/protocol/bounds';
import {
  type EditResendRejectReason,
  type RewindEvictedFile,
} from '../../../shared/protocol/turns';
import {
  hasExactKeys,
  isExactArray,
  isStrictRecord,
  type UnknownRecord,
} from '../../../shared/validation/strictValidation';
import { isSafeWorkspaceRelativePath } from '../../../shared/validation/guards';
import { isRewindDetails } from '../../../shared/protocol/rewindDetails';
import {
  isCount,
  isId,
  isNonEmptyBoundedString,
  isRewindEvictedFile,
  isSequence,
  isWorkspaceFilesStatus,
} from './guards';

export function parseSessionAttachmentsMessage(
  value: UnknownRecord,
): Extract<HostToWebviewMessage, { type: 'session.attachments' }> | undefined {
  if (
    !hasExactKeys(value, ['type', 'sequence', 'sessionId', 'attachments']) ||
    !isSequence(value.sequence) ||
    !isId(value.sessionId) ||
    !isExactArray(value.attachments, 0, MAX_PENDING_ATTACHMENTS)
  ) {
    return undefined;
  }
  const attachments: AttachmentSummary[] = [];
  const ids = new Set<string>();
  for (const itemValue of value.attachments) {
    const item = parseAttachmentSummary(itemValue);
    if (item === undefined || ids.has(item.id)) {
      return undefined;
    }
    ids.add(item.id);
    attachments.push(item);
  }
  return {
    type: 'session.attachments',
    sequence: value.sequence,
    sessionId: value.sessionId,
    attachments,
  };
}

export function parseSessionEditAttachmentsMessage(
  value: UnknownRecord,
): Extract<HostToWebviewMessage, { type: 'session.editAttachments' }> | undefined {
  if (
    !hasExactKeys(value, ['type', 'sequence', 'sessionId', 'messageId', 'attachments']) ||
    !isSequence(value.sequence) ||
    !isId(value.sessionId) ||
    !isId(value.messageId) ||
    !isExactArray(value.attachments, 0, MAX_PENDING_ATTACHMENTS)
  ) {
    return undefined;
  }
  const attachments: EditAttachmentSummary[] = [];
  const ids = new Set<string>();
  for (const itemValue of value.attachments) {
    if (!isStrictRecord(itemValue) || typeof itemValue.restorable !== 'boolean') {
      return undefined;
    }
    const { restorable, ...summaryValue } = itemValue;
    const item = parseAttachmentSummary(summaryValue);
    if (item === undefined || ids.has(item.id)) {
      return undefined;
    }
    ids.add(item.id);
    attachments.push({ ...item, restorable });
  }
  return {
    type: 'session.editAttachments',
    sequence: value.sequence,
    sessionId: value.sessionId,
    messageId: value.messageId,
    attachments,
  };
}

export function parseTurnEditResendRejected(
  value: UnknownRecord,
): Extract<HostToWebviewMessage, { type: 'turn.editResendRejected' }> | undefined {
  if (
    !hasExactKeys(value, ['type', 'sequence', 'sessionId', 'messageId', 'reason']) ||
    !isSequence(value.sequence) ||
    !isId(value.sessionId) ||
    !isId(value.messageId) ||
    typeof value.reason !== 'string' ||
    !(EDIT_RESEND_REJECT_REASONS as readonly string[]).includes(value.reason)
  ) {
    return undefined;
  }
  return {
    type: 'turn.editResendRejected',
    sequence: value.sequence,
    sessionId: value.sessionId,
    messageId: value.messageId,
    reason: value.reason as EditResendRejectReason,
  };
}

export function parseWorkspaceFiles(
  value: UnknownRecord,
): Extract<HostToWebviewMessage, { type: 'workspace.files' }> | undefined {
  if (
    !hasExactKeys(value, [
      'type',
      'sequence',
      'sessionId',
      'requestId',
      'status',
      'files',
    ]) ||
    !isSequence(value.sequence) ||
    !isId(value.sessionId) ||
    !isId(value.requestId) ||
    !isWorkspaceFilesStatus(value.status) ||
    !isExactArray(value.files, 0, MAX_FILE_SEARCH_RESULTS)
  ) {
    return undefined;
  }
  const files: string[] = [];
  const seen = new Set<string>();
  for (const file of value.files) {
    if (!isSafeWorkspaceRelativePath(file) || seen.has(file)) {
      return undefined;
    }
    seen.add(file);
    files.push(file);
  }
  return {
    type: 'workspace.files',
    sequence: value.sequence,
    sessionId: value.sessionId,
    requestId: value.requestId,
    status: value.status,
    files,
  };
}

export function parseRewindInfo(
  value: UnknownRecord,
): Extract<HostToWebviewMessage, { type: 'rewind.info' }> | undefined {
  if (
    !hasExactKeys(value, [
      'type',
      'sequence',
      'sessionId',
      'messageId',
      'restorableCount',
      'createdCount',
      'restorablePaths',
      'createdPaths',
      'evictedFiles',
    ], ['details', 'evictedCount']) ||
    !isSequence(value.sequence) ||
    !isId(value.sessionId) ||
    !isId(value.messageId) ||
    !isCount(value.restorableCount) ||
    !isCount(value.createdCount) ||
    (value.evictedCount !== undefined && !isCount(value.evictedCount)) ||
    (value.details !== undefined && (!isRewindDetails(value.details) || !isCount(value.evictedCount)))
  ) {
    return undefined;
  }
  const restorablePaths = parseRewindPaths(value.restorablePaths);
  const createdPaths = parseRewindPaths(value.createdPaths);
  const evictedFiles = parseRewindEvictedFiles(value.evictedFiles);
  if (
    restorablePaths === undefined ||
    createdPaths === undefined ||
    evictedFiles === undefined ||
    restorablePaths.length > value.restorableCount || createdPaths.length > value.createdCount ||
    (value.details !== undefined && (
      value.details.filter((file) => file.action === 'restore').length > value.restorableCount ||
      value.details.filter((file) => file.action === 'delete').length > value.createdCount ||
      value.details.filter((file) => file.action === 'unavailable').length > (value.evictedCount as number)
    ))
  ) {
    return undefined;
  }
  return {
    type: 'rewind.info',
    sequence: value.sequence,
    sessionId: value.sessionId,
    messageId: value.messageId,
    restorableCount: value.restorableCount,
    createdCount: value.createdCount,
    restorablePaths,
    createdPaths,
    evictedFiles,
    ...(value.details === undefined ? {} : { details: value.details }),
    ...(value.evictedCount === undefined ? {} : { evictedCount: value.evictedCount as number }),
  };
}

export function parseRewindPaths(value: unknown): string[] | undefined {
  return isExactArray(value, 0, MAX_REWIND_INFO_FILES) &&
    value.every((path) => isSafeWorkspaceRelativePath(path))
    ? (value as string[])
    : undefined;
}

export function parseRewindEvictedFiles(value: unknown): RewindEvictedFile[] | undefined {
  return isExactArray(value, 0, MAX_REWIND_INFO_FILES) && value.every(isRewindEvictedFile)
    ? (value as RewindEvictedFile[])
    : undefined;
}

export function parseAttachmentSummary(value: unknown): AttachmentSummary | undefined {
  if (
    !isStrictRecord(value) ||
    !hasExactKeys(value, ['id', 'kind', 'name', 'sizeBytes', 'truncated']) ||
    !isId(value.id) ||
    typeof value.kind !== 'string' ||
    !(ATTACHMENT_KINDS as readonly string[]).includes(value.kind) ||
    !isNonEmptyBoundedString(value.name, MAX_ATTACHMENT_NAME_LENGTH) ||
    !isCount(value.sizeBytes) ||
    typeof value.truncated !== 'boolean'
  ) {
    return undefined;
  }
  return {
    id: value.id,
    kind: value.kind as AttachmentKind,
    name: value.name,
    sizeBytes: value.sizeBytes,
    truncated: value.truncated,
  };
}
