import {
  MAX_TOOL_ACTION_SUMMARY_LENGTH,
  type HostToWebviewMessage,
} from '../../../shared/bridgeMessages';
import {
  MAX_SUBAGENT_DESCRIPTION_LENGTH,
  MAX_SUBAGENT_TYPE_LENGTH,
  MAX_TOOL_NAME_LENGTH,
} from '../../../shared/protocol/bounds';
import {
  type SessionTranscriptItem,
  type ToolBackgroundHint,
  type ToolDetailKind,
  type ToolSubagentSummary,
} from '../../../shared/protocol/transcript';
import {
  hasExactKeys,
  isStrictRecord,
  type UnknownRecord,
} from '../../../shared/validation/strictValidation';
import {
  hasValidToolTextFields,
  toolTextFields,
} from '../../../shared/transcript/toolTextFields';
import { isSafeWorkspaceRelativePath } from '../../../shared/validation/guards';
import {
  hasConsistentToolProgress,
  hasControlCharacter,
  hasTurnIdentity,
  hasValidAdditionalFileCount,
  hasValidToolDetail,
  isBoundedString,
  isBoundedToolProgressCount,
  isCount,
  isId,
  isNonEmptyBoundedString,
  isNullableToolActivityUpdateKind,
  isSequence,
  isSubagentStatus,
  isToolActivityStatus,
  isTranscriptToolStatus,
} from './guards';

export function parseToolActivity(
  value: UnknownRecord,
): Extract<HostToWebviewMessage, { type: 'tool.activity' }> | undefined {
  if (
    !hasExactKeys(
      value,
      [
        'type',
        'sequence',
        'sessionId',
        'turnId',
        'toolUseId',
        'toolName',
        'action',
        'status',
        'progressCount',
        'latestUpdateKind',
      ],
      [
        'durationMs',
        'filePath',
        'additionalFileCount',
        'detailKind',
        'detail',
        'target',
        'errorMessage',
        'outputTail',
        'resultPreview',
        'operationDiff',
        'executionPhase',
        'backgroundHint',
        'subagent',
      ],
    ) ||
    !hasTurnIdentity(value) ||
    !isId(value.toolUseId) ||
    !isNonEmptyBoundedString(value.toolName, MAX_TOOL_NAME_LENGTH) ||
    !isNonEmptyBoundedString(value.action, MAX_TOOL_ACTION_SUMMARY_LENGTH) ||
    !isToolActivityStatus(value.status) ||
    !isBoundedToolProgressCount(value.progressCount) ||
    !isNullableToolActivityUpdateKind(value.latestUpdateKind) ||
    !hasConsistentToolProgress(value.progressCount, value.latestUpdateKind) ||
    (value.durationMs !== undefined && !isSequence(value.durationMs)) ||
    (value.filePath !== undefined && !isSafeWorkspaceRelativePath(value.filePath)) ||
    !hasValidAdditionalFileCount(value) ||
    !hasValidToolDetail(value) ||
    !hasValidToolTextFields(value)
  ) {
    return undefined;
  }
  const backgroundHint =
    value.backgroundHint === undefined
      ? undefined
      : parseToolBackgroundHint(value.backgroundHint);
  if (value.backgroundHint !== undefined && backgroundHint === undefined) {
    return undefined;
  }
  const subagent =
    value.subagent === undefined ? undefined : parseToolSubagent(value.subagent);
  if (value.subagent !== undefined && subagent === undefined) {
    return undefined;
  }

  return {
    type: 'tool.activity',
    sequence: value.sequence,
    sessionId: value.sessionId,
    turnId: value.turnId,
    toolUseId: value.toolUseId,
    toolName: value.toolName,
    action: value.action,
    status: value.status,
    progressCount: value.progressCount,
    latestUpdateKind: value.latestUpdateKind,
    ...(value.durationMs === undefined ? {} : { durationMs: value.durationMs }),
    ...(value.filePath === undefined ? {} : { filePath: value.filePath }),
    ...(value.additionalFileCount === undefined
      ? {}
      : { additionalFileCount: value.additionalFileCount as number }),
    ...(value.detailKind === undefined
      ? {}
      : {
          detailKind: value.detailKind as ToolDetailKind,
          detail: value.detail as string,
        }),
    ...toolTextFields(value),
    ...(backgroundHint === undefined ? {} : { backgroundHint }),
    ...(subagent === undefined ? {} : { subagent }),
  };
}

/**
 * Out-of-band subagent settlement for one tool row. Only the
 * `subagent` payload travels — the row's own fields are immutable
 * from this channel — and a summary without a status is rejected
 * because a settlement's whole point is the terminal status.
 */
export function parseSubagentUpdate(
  value: UnknownRecord,
): Extract<HostToWebviewMessage, { type: 'subagent.update' }> | undefined {
  if (
    !hasExactKeys(value, [
      'type',
      'sequence',
      'sessionId',
      'turnId',
      'toolUseId',
      'subagent',
    ]) ||
    !hasTurnIdentity(value) ||
    !isId(value.toolUseId)
  ) {
    return undefined;
  }
  const subagent = parseToolSubagent(value.subagent);
  if (subagent === undefined || subagent.status === undefined) {
    return undefined;
  }
  return {
    type: 'subagent.update',
    sequence: value.sequence,
    sessionId: value.sessionId,
    turnId: value.turnId,
    toolUseId: value.toolUseId,
    subagent,
  };
}

/** Exactly `{ fireAndForget: boolean }`; anything else is rejected. */
export function parseToolBackgroundHint(value: unknown): ToolBackgroundHint | undefined {
  if (
    !isStrictRecord(value) ||
    !hasExactKeys(value, ['fireAndForget']) ||
    typeof value.fireAndForget !== 'boolean'
  ) {
    return undefined;
  }
  return { fireAndForget: value.fireAndForget };
}

export function parseToolSubagent(value: unknown): ToolSubagentSummary | undefined {
  if (
    !isStrictRecord(value) ||
    !hasExactKeys(
      value,
      ['type', 'description'],
      ['status', 'toolUseCount', 'durationMs'],
    ) ||
    !isNonEmptyBoundedString(value.type, MAX_SUBAGENT_TYPE_LENGTH) ||
    hasControlCharacter(value.type) ||
    !isBoundedString(value.description, MAX_SUBAGENT_DESCRIPTION_LENGTH) ||
    hasControlCharacter(value.description) ||
    (value.status !== undefined && !isSubagentStatus(value.status)) ||
    (value.toolUseCount !== undefined && !isCount(value.toolUseCount)) ||
    (value.durationMs !== undefined && !isCount(value.durationMs))
  ) {
    return undefined;
  }
  return {
    type: value.type,
    description: value.description,
    ...(value.status === undefined ? {} : { status: value.status }),
    ...(value.toolUseCount === undefined ? {} : { toolUseCount: value.toolUseCount }),
    ...(value.durationMs === undefined ? {} : { durationMs: value.durationMs }),
  };
}

export function parseToolTranscriptItem(
  value: UnknownRecord,
): Extract<SessionTranscriptItem, { kind: 'tool' }> | undefined {
  if (
    !hasExactKeys(
      value,
      [
        'id',
        'kind',
        'turnId',
        'toolUseId',
        'toolName',
        'action',
        'status',
        'progressCount',
        'latestUpdateKind',
      ],
      [
        'durationMs',
        'filePath',
        'additionalFileCount',
        'detailKind',
        'detail',
        'target',
        'errorMessage',
        'outputTail',
        'resultPreview',
        'operationDiff',
        'backgroundHint',
        'executionPhase',
        'subagent',
      ],
    ) ||
    !isId(value.id) ||
    !isId(value.turnId) ||
    !isId(value.toolUseId) ||
    !isNonEmptyBoundedString(value.toolName, MAX_TOOL_NAME_LENGTH) ||
    !isNonEmptyBoundedString(value.action, MAX_TOOL_ACTION_SUMMARY_LENGTH) ||
    !isTranscriptToolStatus(value.status) ||
    !isBoundedToolProgressCount(value.progressCount) ||
    !isNullableToolActivityUpdateKind(value.latestUpdateKind) ||
    !hasConsistentToolProgress(value.progressCount, value.latestUpdateKind) ||
    (value.durationMs !== undefined && !isSequence(value.durationMs)) ||
    (value.filePath !== undefined && !isSafeWorkspaceRelativePath(value.filePath)) ||
    !hasValidAdditionalFileCount(value) ||
    !hasValidToolDetail(value) ||
    !hasValidToolTextFields(value)
  ) {
    return undefined;
  }
  const backgroundHint =
    value.backgroundHint === undefined
      ? undefined
      : parseToolBackgroundHint(value.backgroundHint);
  if (value.backgroundHint !== undefined && backgroundHint === undefined) {
    return undefined;
  }
  const subagent =
    value.subagent === undefined ? undefined : parseToolSubagent(value.subagent);
  if (value.subagent !== undefined && subagent === undefined) {
    return undefined;
  }

  return {
    id: value.id,
    kind: 'tool',
    turnId: value.turnId,
    toolUseId: value.toolUseId,
    toolName: value.toolName,
    action: value.action,
    status: value.status,
    progressCount: value.progressCount,
    latestUpdateKind: value.latestUpdateKind,
    ...(value.durationMs === undefined ? {} : { durationMs: value.durationMs }),
    ...(value.filePath === undefined ? {} : { filePath: value.filePath }),
    ...(value.additionalFileCount === undefined
      ? {}
      : { additionalFileCount: value.additionalFileCount as number }),
    ...(value.detailKind === undefined
      ? {}
      : {
          detailKind: value.detailKind as ToolDetailKind,
          detail: value.detail as string,
        }),
    ...toolTextFields(value),
    ...(backgroundHint === undefined ? {} : { backgroundHint }),
    ...(subagent === undefined ? {} : { subagent }),
  };
}
