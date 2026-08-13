import {
  ATTACHMENT_KINDS,
  DIAGNOSTIC_SEVERITIES,
  IMAGE_MEDIA_TYPES,
  IMAGE_ORIGINS,
  MAX_ASSISTANT_TEXT_LENGTH,
  MAX_ATTACHMENT_NAME_LENGTH,
  MAX_PENDING_ATTACHMENTS,
  MAX_BRIDGE_ID_LENGTH,
  MAX_CHANGED_FILES_PER_TURN,
  MAX_IMAGE_DATA_LENGTH,
  MAX_THINKING_TEXT_LENGTH,
  MAX_TOOL_ACTION_SUMMARY_LENGTH,
  MAX_TOOL_DETAIL_LENGTH,
  MAX_TOOL_ERROR_MESSAGE_LENGTH,
  MAX_SUBAGENT_DESCRIPTION_LENGTH,
  MAX_SUBAGENT_TYPE_LENGTH,
  MAX_TOOL_NAME_LENGTH,
  MAX_TOOL_PROGRESS_UPDATES_PER_TOOL,
  MAX_TURN_TEXT_LENGTH,
  SUBAGENT_STATUSES,
  TRANSCRIPT_THINKING_STATUSES,
  TRANSCRIPT_TOOL_STATUSES,
  TOOL_ACTIVITY_UPDATE_KINDS,
  TOOL_DETAIL_KINDS,
  type AttachmentKind,
  type ChangedFileSummary,
  type SentAttachmentSummary,
  type SessionTranscriptItem,
  type ToolBackgroundHint,
  type ToolDetailKind,
  type ToolSubagentSummary,
} from '../shared/bridgeMessages';
import {
  hasExactKeys,
  isExactArray,
  isStrictRecord,
  type UnknownRecord,
} from '../shared/strictValidation';
import {
  summarizeToolAction,
  type ToolActivityUpdateKind,
} from '../shared/toolActivity';
import { isSafeWorkspaceRelativePath } from '../shared/validateMessage';

/**
 * Per-item validation for recovery checkpoints (extracted verbatim
 * from SessionRecoveryStore.ts): every transcript item read back from
 * persistent storage re-passes the same strict shape rules the bridge
 * enforces, so a corrupted or tampered checkpoint fails closed.
 */
export function parseTranscriptItem(
  value: unknown,
): SessionTranscriptItem | undefined {
  if (!isStrictRecord(value)) {
    return undefined;
  }
  const kind = dataValue(value, 'kind');
  switch (kind) {
    case 'user':
      return parseUser(value);
    case 'assistant':
      return parseAssistant(value);
    case 'thinking':
      return parseThinking(value);
    case 'tool':
      return parseTool(value);
    case 'changes':
      return parseChanges(value);
    case 'diagnostic':
      return parseDiagnostic(value);
    case 'image':
      return parseImage(value);
    default:
      return undefined;
  }
}

const IMAGE_BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;

/**
 * Accepts image items with live bytes so in-memory cache updates keep
 * rendering; `serialize()` strips the bytes before anything reaches
 * persistent storage, so stored checkpoints only ever hold placeholders.
 */
function parseImage(
  value: UnknownRecord,
): Extract<SessionTranscriptItem, { kind: 'image' }> | undefined {
  if (
    !hasExactKeys(value, [
      'id',
      'kind',
      'turnId',
      'origin',
      'mediaType',
      'data',
      'generated',
      'byteLength',
    ])
  ) {
    return undefined;
  }
  const id = dataValue(value, 'id');
  const turnId = dataValue(value, 'turnId');
  const origin = dataValue(value, 'origin');
  const mediaType = dataValue(value, 'mediaType');
  const data = dataValue(value, 'data');
  const generated = dataValue(value, 'generated');
  const byteLength = dataValue(value, 'byteLength');
  return isId(id) &&
    isId(turnId) &&
    isOneOf(origin, IMAGE_ORIGINS) &&
    isOneOf(mediaType, IMAGE_MEDIA_TYPES) &&
    isBoundedString(data, MAX_IMAGE_DATA_LENGTH) &&
    IMAGE_BASE64_PATTERN.test(data as string) &&
    typeof generated === 'boolean' &&
    Number.isSafeInteger(byteLength) &&
    (byteLength as number) >= 0
    ? {
        id,
        kind: 'image',
        turnId,
        origin,
        mediaType,
        data,
        generated,
        byteLength: byteLength as number,
      }
    : undefined;
}

function parseUser(
  value: UnknownRecord,
): Extract<SessionTranscriptItem, { kind: 'user' }> | undefined {
  const id = dataValue(value, 'id');
  const text = dataValue(value, 'text');
  const messageId = dataValue(value, 'messageId');
  const attachmentsValue = dataValue(value, 'attachments');
  if (
    !hasExactKeys(
      value,
      ['id', 'kind', 'text'],
      ['messageId', 'attachments'],
    ) ||
    !isId(id) ||
    !isBoundedString(text, MAX_TURN_TEXT_LENGTH) ||
    (messageId !== undefined && !isId(messageId))
  ) {
    return undefined;
  }
  let attachments: SentAttachmentSummary[] | undefined;
  if (attachmentsValue !== undefined) {
    if (!isExactArray(attachmentsValue, 1, MAX_PENDING_ATTACHMENTS)) {
      return undefined;
    }
    attachments = [];
    for (const entry of attachmentsValue) {
      const attachment = parseSentAttachment(entry);
      if (attachment === undefined) {
        return undefined;
      }
      attachments.push(attachment);
    }
  }
  return {
    id,
    kind: 'user',
    text,
    ...(messageId === undefined ? {} : { messageId }),
    ...(attachments === undefined ? {} : { attachments }),
  };
}

function parseSentAttachment(
  value: unknown,
): SentAttachmentSummary | undefined {
  if (!isStrictRecord(value)) {
    return undefined;
  }
  const kind = dataValue(value, 'kind');
  const name = dataValue(value, 'name');
  const sizeBytes = dataValue(value, 'sizeBytes');
  return hasExactKeys(value, ['kind', 'name', 'sizeBytes']) &&
    isOneOf(kind, ATTACHMENT_KINDS) &&
    isNonEmptyBoundedString(name, MAX_ATTACHMENT_NAME_LENGTH) &&
    typeof sizeBytes === 'number' &&
    Number.isSafeInteger(sizeBytes) &&
    sizeBytes >= 0
    ? { kind: kind as AttachmentKind, name, sizeBytes }
    : undefined;
}

function parseAssistant(
  value: UnknownRecord,
): Extract<SessionTranscriptItem, { kind: 'assistant' }> | undefined {
  const id = dataValue(value, 'id');
  const turnId = dataValue(value, 'turnId');
  const text = dataValue(value, 'text');
  return hasExactKeys(value, ['id', 'kind', 'turnId', 'text']) &&
    isId(id) &&
    isId(turnId) &&
    isBoundedString(text, MAX_ASSISTANT_TEXT_LENGTH)
    ? { id, kind: 'assistant', turnId, text }
    : undefined;
}

function parseThinking(
  value: UnknownRecord,
): Extract<SessionTranscriptItem, { kind: 'thinking' }> | undefined {
  if (
    !hasExactKeys(
      value,
      ['id', 'kind', 'turnId', 'text', 'status', 'truncated'],
      ['durationMs'],
    )
  ) {
    return undefined;
  }
  const id = dataValue(value, 'id');
  const turnId = dataValue(value, 'turnId');
  const text = dataValue(value, 'text');
  const status = dataValue(value, 'status');
  const durationMs = dataValue(value, 'durationMs');
  const truncated = dataValue(value, 'truncated');
  if (
    !isId(id) ||
    !isId(turnId) ||
    !isBoundedString(text, MAX_THINKING_TEXT_LENGTH) ||
    !isOneOf(status, TRANSCRIPT_THINKING_STATUSES) ||
    (durationMs !== undefined &&
      (!Number.isSafeInteger(durationMs) || (durationMs as number) < 0)) ||
    typeof truncated !== 'boolean'
  ) {
    return undefined;
  }
  return {
    id,
    kind: 'thinking',
    turnId,
    text,
    status,
    ...(durationMs === undefined
      ? {}
      : { durationMs: durationMs as number }),
    truncated,
  };
}

function parseTool(
  value: UnknownRecord,
): Extract<SessionTranscriptItem, { kind: 'tool' }> | undefined {
  const legacyKeys = [
    'id',
    'kind',
    'turnId',
    'toolUseId',
    'toolName',
    'status',
  ] as const;
  const currentKeys = [
    ...legacyKeys,
    'action',
    'progressCount',
    'latestUpdateKind',
  ] as const;
  const legacy = hasExactKeys(value, legacyKeys);
  // `outputTail` is accepted but intentionally dropped: command
  // output is a live-session display artifact. Checkpoints replay
  // outputless (matching CLI history projections), and raw command
  // output never reaches persisted storage.
  if (
    !legacy &&
    !hasExactKeys(value, currentKeys, [
      'durationMs',
      'filePath',
      'detailKind',
      'detail',
      'errorMessage',
      'outputTail',
      'backgroundHint',
      'subagent',
    ])
  ) {
    return undefined;
  }
  const id = dataValue(value, 'id');
  const turnId = dataValue(value, 'turnId');
  const toolUseId = dataValue(value, 'toolUseId');
  const toolName = dataValue(value, 'toolName');
  const filePath = legacy ? undefined : dataValue(value, 'filePath');
  const detailKind = legacy ? undefined : dataValue(value, 'detailKind');
  const detail = legacy ? undefined : dataValue(value, 'detail');
  const errorMessage = legacy
    ? undefined
    : dataValue(value, 'errorMessage');
  const rawSubagent = legacy ? undefined : dataValue(value, 'subagent');
  const subagent =
    rawSubagent === undefined ? undefined : parseSubagent(rawSubagent);
  if (rawSubagent !== undefined && subagent === undefined) {
    return undefined;
  }
  const rawBackgroundHint = legacy
    ? undefined
    : dataValue(value, 'backgroundHint');
  const backgroundHint =
    rawBackgroundHint === undefined
      ? undefined
      : parseBackgroundHint(rawBackgroundHint);
  if (rawBackgroundHint !== undefined && backgroundHint === undefined) {
    return undefined;
  }
  const action = legacy
    ? typeof toolName === 'string'
      ? summarizeToolAction(toolName)
      : undefined
    : dataValue(value, 'action');
  const status = dataValue(value, 'status');
  const progressCount = legacy
    ? 0
    : dataValue(value, 'progressCount');
  const latestUpdateKind = legacy
    ? null
    : dataValue(value, 'latestUpdateKind');
  const durationMs = legacy ? undefined : dataValue(value, 'durationMs');
  return isId(id) &&
    isId(turnId) &&
    isId(toolUseId) &&
    isNonEmptyBoundedString(toolName, MAX_TOOL_NAME_LENGTH) &&
    isNonEmptyBoundedString(action, MAX_TOOL_ACTION_SUMMARY_LENGTH) &&
    isOneOf(status, TRANSCRIPT_TOOL_STATUSES) &&
    Number.isSafeInteger(progressCount) &&
    (progressCount as number) >= 0 &&
    (progressCount as number) <= MAX_TOOL_PROGRESS_UPDATES_PER_TOOL &&
    (latestUpdateKind === null ||
      isOneOf(latestUpdateKind, TOOL_ACTIVITY_UPDATE_KINDS)) &&
    ((progressCount === 0 && latestUpdateKind === null) ||
      ((progressCount as number) > 0 && latestUpdateKind !== null)) &&
    (durationMs === undefined ||
      (Number.isSafeInteger(durationMs) && (durationMs as number) >= 0)) &&
    (filePath === undefined || isSafeWorkspaceRelativePath(filePath)) &&
    ((detailKind === undefined && detail === undefined) ||
      (isOneOf(detailKind, TOOL_DETAIL_KINDS) &&
        isNonEmptyBoundedString(detail, MAX_TOOL_DETAIL_LENGTH))) &&
    (errorMessage === undefined ||
      isNonEmptyBoundedString(
        errorMessage,
        MAX_TOOL_ERROR_MESSAGE_LENGTH,
      ))
    ? {
        id,
        kind: 'tool',
        turnId,
        toolUseId,
        toolName,
        action,
        status,
        progressCount: progressCount as number,
        latestUpdateKind:
          latestUpdateKind as ToolActivityUpdateKind | null,
        ...(durationMs === undefined
          ? {}
          : { durationMs: durationMs as number }),
        ...(filePath === undefined
          ? {}
          : { filePath: filePath as string }),
        ...(detailKind === undefined
          ? {}
          : {
              detailKind: detailKind as ToolDetailKind,
              detail: detail as string,
            }),
        ...(errorMessage === undefined
          ? {}
          : { errorMessage: errorMessage as string }),
        ...(backgroundHint === undefined ? {} : { backgroundHint }),
        ...(subagent === undefined ? {} : { subagent }),
      }
    : undefined;
}

/** Mirrors the webview-side `parseToolBackgroundHint` rules. */
function parseBackgroundHint(
  value: unknown,
): ToolBackgroundHint | undefined {
  if (
    !isStrictRecord(value) ||
    !hasExactKeys(value, ['fireAndForget'])
  ) {
    return undefined;
  }
  const fireAndForget = dataValue(value, 'fireAndForget');
  return typeof fireAndForget === 'boolean'
    ? { fireAndForget }
    : undefined;
}

/** Mirrors the webview-side `parseToolSubagent` validation rules. */
function parseSubagent(
  value: unknown,
): ToolSubagentSummary | undefined {
  if (
    !isStrictRecord(value) ||
    !hasExactKeys(
      value,
      ['type', 'description'],
      ['status', 'toolUseCount', 'durationMs'],
    )
  ) {
    return undefined;
  }
  const type = dataValue(value, 'type');
  const description = dataValue(value, 'description');
  const status = dataValue(value, 'status');
  const toolUseCount = dataValue(value, 'toolUseCount');
  const durationMs = dataValue(value, 'durationMs');
  return isNonEmptyBoundedString(type, MAX_SUBAGENT_TYPE_LENGTH) &&
    !hasControlCharacter(type) &&
    isBoundedString(description, MAX_SUBAGENT_DESCRIPTION_LENGTH) &&
    !hasControlCharacter(description) &&
    (status === undefined || isOneOf(status, SUBAGENT_STATUSES)) &&
    (toolUseCount === undefined ||
      (Number.isSafeInteger(toolUseCount) &&
        (toolUseCount as number) >= 0)) &&
    (durationMs === undefined ||
      (Number.isSafeInteger(durationMs) && (durationMs as number) >= 0))
    ? {
        type,
        description,
        ...(status === undefined ? {} : { status }),
        ...(toolUseCount === undefined
          ? {}
          : { toolUseCount: toolUseCount as number }),
        ...(durationMs === undefined
          ? {}
          : { durationMs: durationMs as number }),
      }
    : undefined;
}

function hasControlCharacter(value: string): boolean {
  return /[\u0000-\u001f\u007f-\u009f]/u.test(value);
}

function parseChanges(
  value: UnknownRecord,
): Extract<SessionTranscriptItem, { kind: 'changes' }> | undefined {
  if (!hasExactKeys(value, ['id', 'kind', 'turnId', 'files'])) {
    return undefined;
  }
  const id = dataValue(value, 'id');
  const turnId = dataValue(value, 'turnId');
  const filesValue = dataValue(value, 'files');
  if (
    !isId(id) ||
    !isId(turnId) ||
    !isExactArray(filesValue, 1, MAX_CHANGED_FILES_PER_TURN)
  ) {
    return undefined;
  }
  const files: ChangedFileSummary[] = [];
  const paths = new Set<string>();
  for (const fileValue of filesValue) {
    if (!isStrictRecord(fileValue)) {
      return undefined;
    }
    const path = dataValue(fileValue, 'path');
    const additions = dataValue(fileValue, 'additions');
    const deletions = dataValue(fileValue, 'deletions');
    if (
      !hasExactKeys(fileValue, ['path', 'additions', 'deletions']) ||
      !isSafeWorkspaceRelativePath(path) ||
      paths.has(path as string) ||
      !isNullableChangeCount(additions) ||
      !isNullableChangeCount(deletions)
    ) {
      return undefined;
    }
    paths.add(path as string);
    files.push({
      path: path as string,
      additions: additions as number | null,
      deletions: deletions as number | null,
    });
  }
  return { id, kind: 'changes', turnId, files };
}

function isNullableChangeCount(value: unknown): value is number | null {
  return (
    value === null ||
    (Number.isSafeInteger(value) && (value as number) >= 0)
  );
}

function parseDiagnostic(
  value: UnknownRecord,
): Extract<
  SessionTranscriptItem,
  { kind: 'diagnostic' }
> | undefined {
  if (
    !hasExactKeys(
      value,
      ['id', 'kind', 'turnId', 'severity', 'code', 'message'],
      ['relatedSessionId'],
    )
  ) {
    return undefined;
  }
  const id = dataValue(value, 'id');
  const turnId = dataValue(value, 'turnId');
  const severity = dataValue(value, 'severity');
  const code = dataValue(value, 'code');
  const message = dataValue(value, 'message');
  const relatedSessionId = dataValue(value, 'relatedSessionId');
  return isId(id) &&
    (turnId === null || isId(turnId)) &&
    isOneOf(severity, DIAGNOSTIC_SEVERITIES) &&
    isBoundedString(code, MAX_TURN_TEXT_LENGTH) &&
    isBoundedString(message, MAX_TURN_TEXT_LENGTH) &&
    (relatedSessionId === undefined || isId(relatedSessionId))
    ? {
        id,
        kind: 'diagnostic',
        turnId,
        severity,
        code,
        message,
        ...(relatedSessionId === undefined
          ? {}
          : { relatedSessionId }),
      }
    : undefined;
}

export function dataValue(
  value: object,
  key: PropertyKey,
): unknown {
  const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
  return descriptor && 'value' in descriptor
    ? descriptor.value
    : undefined;
}

export function isId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_BRIDGE_ID_LENGTH
  );
}

function isBoundedString(
  value: unknown,
  maximumLength: number,
): value is string {
  return typeof value === 'string' && value.length <= maximumLength;
}

function isNonEmptyBoundedString(
  value: unknown,
  maximumLength: number,
): value is string {
  return isBoundedString(value, maximumLength) && value.length > 0;
}

export function isOneOf<const Values extends readonly string[]>(
  value: unknown,
  values: Values,
): value is Values[number] {
  return (
    typeof value === 'string' &&
    (values as readonly string[]).includes(value)
  );
}
