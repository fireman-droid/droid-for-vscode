import { MAX_SESSION_TRANSCRIPT_ITEMS } from '../../../shared/bridgeMessages';
import {
  type AttachmentKind,
  type SentAttachmentSummary,
} from '../../../shared/protocol/attachments';
import {
  ATTACHMENT_KINDS,
  MAX_ASSISTANT_TEXT_LENGTH,
  MAX_ATTACHMENT_NAME_LENGTH,
  MAX_PENDING_ATTACHMENTS,
  MAX_THINKING_TEXT_LENGTH,
  MAX_TURN_TEXT_LENGTH,
} from '../../../shared/protocol/bounds';
import { type SessionTranscriptItem } from '../../../shared/protocol/transcript';
import { isMessageTimestamp } from '../../../shared/protocol/messageTimestamp';
import {
  hasExactKeys,
  isExactArray,
  isStrictRecord,
  type UnknownRecord,
} from '../../../shared/validation/strictValidation';
import { enforceToolResultBudget } from '../../../shared/transcript/toolResultPreview';
import {
  MAX_SESSION_IMAGE_DATA_UNITS,
  MAX_SESSION_TRANSCRIPT_TEXT_UNITS,
  transcriptImageDataUnits,
  transcriptTextUnits,
} from '../../../shared/transcript/transcriptLimits';
import { parseAskUserResultTranscriptItem } from '../interactionHostValidation';
import { parseChangedFiles } from './changes';
import {
  MAX_STRING_LENGTH,
  isBoundedString,
  isCount,
  isDiagnosticSeverity,
  isId,
  isNonEmptyBoundedString,
  isNullableId,
  isSequence,
  isTranscriptThinkingStatus,
} from './guards';
import { parseImageTranscriptItem } from './images';
import { parseToolTranscriptItem } from './tools';

export function parseSessionTranscript(
  value: unknown,
): SessionTranscriptItem[] | undefined {
  if (!isExactArray(value, 0, MAX_SESSION_TRANSCRIPT_ITEMS)) {
    return undefined;
  }

  const items: SessionTranscriptItem[] = [];
  const ids = new Set<string>();
  for (const itemValue of value) {
    const item = parseSessionTranscriptItem(itemValue);
    if (item === undefined || ids.has(item.id)) {
      return undefined;
    }
    ids.add(item.id);
    items.push(item);
  }
  return transcriptTextUnits(items) <= MAX_SESSION_TRANSCRIPT_TEXT_UNITS &&
    transcriptImageDataUnits(items) <= MAX_SESSION_IMAGE_DATA_UNITS
    ? [...enforceToolResultBudget(items).items]
    : undefined;
}

export function parseSessionTranscriptItem(
  value: unknown,
): SessionTranscriptItem | undefined {
  if (!isStrictRecord(value)) {
    return undefined;
  }

  const kindDescriptor = Reflect.getOwnPropertyDescriptor(value, 'kind');
  if (
    kindDescriptor === undefined ||
    !('value' in kindDescriptor) ||
    typeof kindDescriptor.value !== 'string'
  ) {
    return undefined;
  }

  switch (kindDescriptor.value) {
    case 'user':
      return parseUserTranscriptItem(value);
    case 'assistant':
      return parseAssistantTranscriptItem(value);
    case 'thinking':
      return parseThinkingTranscriptItem(value);
    case 'tool':
      return parseToolTranscriptItem(value);
    case 'changes':
      return parseChangesTranscriptItem(value);
    case 'ask-user-result':
      return parseAskUserResultTranscriptItem(value);
    case 'diagnostic':
      return parseDiagnosticTranscriptItem(value);
    case 'image':
      return parseImageTranscriptItem(value);
    default:
      return undefined;
  }
}

export function parseChangesTranscriptItem(
  value: UnknownRecord,
): Extract<SessionTranscriptItem, { kind: 'changes' }> | undefined {
  if (
    !hasExactKeys(value, ['id', 'kind', 'turnId', 'files']) ||
    !isId(value.id) ||
    !isId(value.turnId)
  ) {
    return undefined;
  }
  const files = parseChangedFiles(value.files, 0);
  return files === undefined
    ? undefined
    : {
        id: value.id,
        kind: 'changes',
        turnId: value.turnId,
        files,
      };
}

export function parseUserTranscriptItem(
  value: UnknownRecord,
): Extract<SessionTranscriptItem, { kind: 'user' }> | undefined {
  if (
    !hasExactKeys(value, ['id', 'kind', 'text'], ['messageId', 'attachments', 'timestamp']) ||
    !isId(value.id) ||
    !isBoundedString(value.text, MAX_TURN_TEXT_LENGTH) ||
    (value.messageId !== undefined && !isId(value.messageId)) ||
    (value.timestamp !== undefined && !isMessageTimestamp(value.timestamp))
  ) {
    return undefined;
  }
  let attachments: SentAttachmentSummary[] | undefined;
  if (value.attachments !== undefined) {
    if (!isExactArray(value.attachments, 0, MAX_PENDING_ATTACHMENTS)) {
      return undefined;
    }
    attachments = [];
    for (const itemValue of value.attachments) {
      const item = parseSentAttachmentSummary(itemValue);
      if (item === undefined) {
        return undefined;
      }
      attachments.push(item);
    }
  }

  return {
    id: value.id,
    kind: 'user',
    text: value.text,
    ...(value.timestamp === undefined ? {} : { timestamp: value.timestamp }),
    ...(value.messageId === undefined ? {} : { messageId: value.messageId }),
    ...(attachments === undefined ? {} : { attachments }),
  };
}

export function parseSentAttachmentSummary(
  value: unknown,
): SentAttachmentSummary | undefined {
  if (
    !isStrictRecord(value) ||
    !hasExactKeys(value, ['kind', 'name', 'sizeBytes']) ||
    typeof value.kind !== 'string' ||
    !(ATTACHMENT_KINDS as readonly string[]).includes(value.kind) ||
    !isNonEmptyBoundedString(value.name, MAX_ATTACHMENT_NAME_LENGTH) ||
    !isCount(value.sizeBytes)
  ) {
    return undefined;
  }
  return {
    kind: value.kind as AttachmentKind,
    name: value.name,
    sizeBytes: value.sizeBytes,
  };
}

export function parseAssistantTranscriptItem(
  value: UnknownRecord,
): Extract<SessionTranscriptItem, { kind: 'assistant' }> | undefined {
  if (
    !hasExactKeys(value, ['id', 'kind', 'turnId', 'text'], ['timestamp']) ||
    !isId(value.id) ||
    !isId(value.turnId) ||
    !isBoundedString(value.text, MAX_ASSISTANT_TEXT_LENGTH) ||
    (value.timestamp !== undefined && !isMessageTimestamp(value.timestamp))
  ) {
    return undefined;
  }

  return {
    id: value.id,
    kind: 'assistant',
    turnId: value.turnId,
    text: value.text,
    ...(value.timestamp === undefined ? {} : { timestamp: value.timestamp }),
  };
}

export function parseThinkingTranscriptItem(
  value: UnknownRecord,
): Extract<SessionTranscriptItem, { kind: 'thinking' }> | undefined {
  if (
    !hasExactKeys(
      value,
      ['id', 'kind', 'turnId', 'text', 'status', 'truncated'],
      ['durationMs'],
    ) ||
    !isId(value.id) ||
    !isId(value.turnId) ||
    !isBoundedString(value.text, MAX_THINKING_TEXT_LENGTH) ||
    !isTranscriptThinkingStatus(value.status) ||
    (value.durationMs !== undefined && !isSequence(value.durationMs)) ||
    typeof value.truncated !== 'boolean'
  ) {
    return undefined;
  }

  return {
    id: value.id,
    kind: 'thinking',
    turnId: value.turnId,
    text: value.text,
    status: value.status,
    ...(value.durationMs === undefined ? {} : { durationMs: value.durationMs }),
    truncated: value.truncated,
  };
}

export function parseDiagnosticTranscriptItem(
  value: UnknownRecord,
): Extract<SessionTranscriptItem, { kind: 'diagnostic' }> | undefined {
  if (
    !hasExactKeys(
      value,
      ['id', 'kind', 'turnId', 'severity', 'code', 'message'],
      ['relatedSessionId'],
    ) ||
    !isId(value.id) ||
    !isNullableId(value.turnId) ||
    !isDiagnosticSeverity(value.severity) ||
    !isBoundedString(value.code, MAX_STRING_LENGTH) ||
    !isBoundedString(value.message, MAX_STRING_LENGTH) ||
    (value.relatedSessionId !== undefined && !isId(value.relatedSessionId))
  ) {
    return undefined;
  }

  return {
    id: value.id,
    kind: 'diagnostic',
    turnId: value.turnId,
    severity: value.severity,
    code: value.code,
    message: value.message,
    ...(value.relatedSessionId === undefined
      ? {}
      : { relatedSessionId: value.relatedSessionId }),
  };
}
