import {
  GIT_FILE_STATUSES,
  GIT_UNAVAILABLE_REASONS,
  MAX_BRIDGE_ID_LENGTH,
  MAX_TOOL_PROGRESS_UPDATES_PER_TOOL,
  PERMISSION_CONFIRMATION_KINDS,
  TOOL_ACTIVITY_UPDATE_KINDS,
  type GitFileStatus,
  type GitUnavailableReason,
  type PermissionConfirmationKind,
  type ToolActivityMessage,
  type ToolActivityUpdateKind,
} from '../../../shared/bridgeMessages';
import { CHANGES_UPDATE_STATES } from '../../../shared/protocol/changesProtocol';
import {
  type ImageMediaType,
  type ImageOrigin,
} from '../../../shared/protocol/attachments';
import {
  CONNECTION_STATUSES,
  DIAGNOSTIC_SEVERITIES,
  IMAGE_MEDIA_TYPES,
  IMAGE_ORIGINS,
  MAX_CHANGED_FILES_PER_TURN,
  MAX_REWIND_EVICTED_REASON_LENGTH,
  MAX_TOOL_DETAIL_LENGTH,
  MAX_TURN_TEXT_LENGTH,
  MCP_AUTH_PHASES,
  MCP_SERVER_STATUSES,
  MISSION_SESSION_ROLES,
  MISSION_STATES,
  PLUGIN_SCOPES,
  SESSION_AUTONOMY_LEVELS,
  SESSION_CATALOG_STATUSES,
  SESSION_HISTORY_STATUSES,
  SESSION_INTERACTION_MODES,
  SESSION_REASONING_EFFORTS,
  SKILL_LOCATIONS,
  SUBAGENT_STATUSES,
  TOOL_ACTIVITY_STATUSES,
  TOOL_DETAIL_KINDS,
  TRANSCRIPT_THINKING_STATUSES,
  TRANSCRIPT_TOOL_STATUSES,
  TURN_STATUSES,
  WORKSPACE_FILES_STATUSES,
} from '../../../shared/protocol/bounds';
import {
  type MissionSessionRole,
  type MissionState,
  type SessionCatalogStatus,
  type SessionHistoryStatus,
} from '../../../shared/protocol/sessions';
import {
  type McpAuthPhase,
  type McpServerStatus,
  type PluginScope,
  type SessionAutonomyLevel,
  type SessionInteractionMode,
  type SessionReasoningEffort,
  type SkillLocation,
} from '../../../shared/protocol/settings';
import { type ConnectionState } from '../../../shared/protocol/shell';
import {
  type DiagnosticSeverity,
  type SubagentStatus,
  type TranscriptThinkingStatus,
  type TranscriptToolStatus,
} from '../../../shared/protocol/transcript';
import { type RewindEvictedFile, type TurnStatus } from '../../../shared/protocol/turns';
import { type WorkspaceFilesStatus } from '../../../shared/protocol/workspace';
import {
  hasExactKeys,
  isStrictRecord,
  type UnknownRecord,
} from '../../../shared/validation/strictValidation';
import { isSafeWorkspaceRelativePath } from '../../../shared/validation/guards';

export const MAX_STRING_LENGTH = MAX_TURN_TEXT_LENGTH;

export const CONNECTION_STATUS_SET = new Set<ConnectionState['status']>(
  CONNECTION_STATUSES,
);

export const TURN_STATUS_SET = new Set<TurnStatus>(TURN_STATUSES);

export const TOOL_ACTIVITY_STATUS_SET = new Set<ToolActivityMessage['status']>(
  TOOL_ACTIVITY_STATUSES,
);

export const TOOL_ACTIVITY_UPDATE_KIND_SET = new Set<ToolActivityUpdateKind>(
  TOOL_ACTIVITY_UPDATE_KINDS,
);

export const DIAGNOSTIC_SEVERITY_SET = new Set<DiagnosticSeverity>(DIAGNOSTIC_SEVERITIES);

export const SESSION_CATALOG_STATUS_SET = new Set<SessionCatalogStatus>(
  SESSION_CATALOG_STATUSES,
);

export const SESSION_HISTORY_STATUS_SET = new Set<SessionHistoryStatus>(
  SESSION_HISTORY_STATUSES,
);

export const TRANSCRIPT_THINKING_STATUS_SET = new Set<TranscriptThinkingStatus>(
  TRANSCRIPT_THINKING_STATUSES,
);

export const TRANSCRIPT_TOOL_STATUS_SET = new Set<TranscriptToolStatus>(
  TRANSCRIPT_TOOL_STATUSES,
);

export const PERMISSION_CONFIRMATION_KIND_SET = new Set<PermissionConfirmationKind>(
  PERMISSION_CONFIRMATION_KINDS,
);

export const SESSION_INTERACTION_MODE_SET = new Set<SessionInteractionMode>(
  SESSION_INTERACTION_MODES,
);

export const SESSION_AUTONOMY_LEVEL_SET = new Set<SessionAutonomyLevel>(
  SESSION_AUTONOMY_LEVELS,
);

export const SESSION_REASONING_EFFORT_SET = new Set<SessionReasoningEffort>(
  SESSION_REASONING_EFFORTS,
);

export const SUBAGENT_STATUS_SET = new Set<SubagentStatus>(SUBAGENT_STATUSES);

export const MISSION_STATE_SET = new Set<MissionState>(MISSION_STATES);

export const MISSION_SESSION_ROLE_SET = new Set<MissionSessionRole>(
  MISSION_SESSION_ROLES,
);

export function isMissionState(value: unknown): value is MissionState {
  return typeof value === 'string' && MISSION_STATE_SET.has(value as MissionState);
}

export function isMissionSessionRole(value: unknown): value is MissionSessionRole {
  return (
    typeof value === 'string' && MISSION_SESSION_ROLE_SET.has(value as MissionSessionRole)
  );
}

export function isTokenCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export function isSubagentStatus(value: unknown): value is SubagentStatus {
  return typeof value === 'string' && SUBAGENT_STATUS_SET.has(value as SubagentStatus);
}

export const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;

export function isImageOrigin(value: unknown): value is ImageOrigin {
  return (
    typeof value === 'string' && (IMAGE_ORIGINS as readonly string[]).includes(value)
  );
}

export function isImageMediaType(value: unknown): value is ImageMediaType {
  return (
    typeof value === 'string' && (IMAGE_MEDIA_TYPES as readonly string[]).includes(value)
  );
}

export const CHANGES_UPDATE_STATE_SET = new Set<string>(CHANGES_UPDATE_STATES);

export function isNullableCount(value: unknown): value is number | null {
  return value === null || isCount(value);
}

export const GIT_FILE_STATUS_SET = new Set<string>(GIT_FILE_STATUSES);

export function isGitFileStatus(value: unknown): value is GitFileStatus {
  return typeof value === 'string' && GIT_FILE_STATUS_SET.has(value);
}

export const GIT_UNAVAILABLE_REASON_SET = new Set<string>(GIT_UNAVAILABLE_REASONS);

export function isGitUnavailableReason(value: unknown): value is GitUnavailableReason {
  return typeof value === 'string' && GIT_UNAVAILABLE_REASON_SET.has(value);
}

export function isWorkspaceFilesStatus(value: unknown): value is WorkspaceFilesStatus {
  return (
    typeof value === 'string' &&
    (WORKSPACE_FILES_STATUSES as readonly string[]).includes(value)
  );
}

export function isRewindEvictedFile(value: unknown): value is RewindEvictedFile {
  return (
    isStrictRecord(value) &&
    hasExactKeys(value, ['path', 'reason']) &&
    isSafeWorkspaceRelativePath(value.path) &&
    typeof value.reason === 'string' &&
    value.reason.length <= MAX_REWIND_EVICTED_REASON_LENGTH
  );
}

export function isSkillLocation(value: unknown): value is SkillLocation {
  return (
    typeof value === 'string' && (SKILL_LOCATIONS as readonly string[]).includes(value)
  );
}

export function isPluginScope(value: unknown): value is PluginScope {
  return (
    typeof value === 'string' && (PLUGIN_SCOPES as readonly string[]).includes(value)
  );
}

export function isMcpServerStatus(value: unknown): value is McpServerStatus {
  return (
    typeof value === 'string' &&
    (MCP_SERVER_STATUSES as readonly string[]).includes(value)
  );
}

export function isMcpAuthPhase(value: unknown): value is McpAuthPhase {
  return (
    typeof value === 'string' && (MCP_AUTH_PHASES as readonly string[]).includes(value)
  );
}

export function isCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

export function hasTurnIdentity(value: UnknownRecord): value is UnknownRecord & {
  sequence: number;
  sessionId: string;
  turnId: string;
} {
  return isSequence(value.sequence) && isId(value.sessionId) && isId(value.turnId);
}

export function isSequence(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

export function hasValidAdditionalFileCount(value: UnknownRecord): boolean {
  return (
    value.additionalFileCount === undefined ||
    (value.filePath !== undefined &&
      isSequence(value.additionalFileCount) &&
      value.additionalFileCount > 0 &&
      value.additionalFileCount < MAX_CHANGED_FILES_PER_TURN)
  );
}

export function readStringDataProperty(
  value: UnknownRecord,
  key: string,
): string | undefined {
  const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined &&
    'value' in descriptor &&
    typeof descriptor.value === 'string'
    ? descriptor.value
    : undefined;
}

export function isNullableId(value: unknown): value is string | null {
  return value === null || isId(value);
}

export function isId(value: unknown): value is string {
  return (
    typeof value === 'string' && value.length > 0 && value.length <= MAX_BRIDGE_ID_LENGTH
  );
}

export function isBoundedString(value: unknown, maximumLength: number): value is string {
  return typeof value === 'string' && value.length <= maximumLength;
}

export function isNonEmptyBoundedString(
  value: unknown,
  maximumLength: number,
): value is string {
  return isBoundedString(value, maximumLength) && value.length > 0;
}

export function isConnectionStatus(value: unknown): value is ConnectionState['status'] {
  return (
    typeof value === 'string' &&
    CONNECTION_STATUS_SET.has(value as ConnectionState['status'])
  );
}

export function isTurnStatus(value: unknown): value is TurnStatus {
  return typeof value === 'string' && TURN_STATUS_SET.has(value as TurnStatus);
}

export function isToolActivityStatus(
  value: unknown,
): value is ToolActivityMessage['status'] {
  return (
    typeof value === 'string' &&
    TOOL_ACTIVITY_STATUS_SET.has(value as ToolActivityMessage['status'])
  );
}

/**
 * A tool detail is valid when absent entirely or when the kind and the
 * bounded non-empty text are both present.
 */
export function hasValidToolDetail(value: UnknownRecord): boolean {
  const detailKind = value['detailKind'];
  const detail = value['detail'];
  if (detailKind === undefined && detail === undefined) {
    return true;
  }
  return (
    typeof detailKind === 'string' &&
    (TOOL_DETAIL_KINDS as readonly string[]).includes(detailKind) &&
    isNonEmptyBoundedString(detail, MAX_TOOL_DETAIL_LENGTH)
  );
}

export function isBoundedToolProgressCount(value: unknown): value is number {
  return isSequence(value) && value <= MAX_TOOL_PROGRESS_UPDATES_PER_TOOL;
}

export function isNullableToolActivityUpdateKind(
  value: unknown,
): value is ToolActivityUpdateKind | null {
  return (
    value === null ||
    (typeof value === 'string' &&
      TOOL_ACTIVITY_UPDATE_KIND_SET.has(value as ToolActivityUpdateKind))
  );
}

export function hasConsistentToolProgress(
  progressCount: unknown,
  latestUpdateKind: unknown,
): boolean {
  return (
    (progressCount === 0 && latestUpdateKind === null) ||
    (typeof progressCount === 'number' && progressCount > 0 && latestUpdateKind !== null)
  );
}

export function isDiagnosticSeverity(value: unknown): value is DiagnosticSeverity {
  return (
    typeof value === 'string' && DIAGNOSTIC_SEVERITY_SET.has(value as DiagnosticSeverity)
  );
}

export function isPermissionConfirmationKind(
  value: unknown,
): value is PermissionConfirmationKind {
  return (
    typeof value === 'string' &&
    PERMISSION_CONFIRMATION_KIND_SET.has(value as PermissionConfirmationKind)
  );
}

export function isSessionInteractionMode(
  value: unknown,
): value is SessionInteractionMode {
  return (
    typeof value === 'string' &&
    SESSION_INTERACTION_MODE_SET.has(value as SessionInteractionMode)
  );
}

export function isSessionAutonomyLevel(value: unknown): value is SessionAutonomyLevel {
  return (
    typeof value === 'string' &&
    SESSION_AUTONOMY_LEVEL_SET.has(value as SessionAutonomyLevel)
  );
}

export function isSessionReasoningEffort(
  value: unknown,
): value is SessionReasoningEffort {
  return (
    typeof value === 'string' &&
    SESSION_REASONING_EFFORT_SET.has(value as SessionReasoningEffort)
  );
}

export function isSessionCatalogStatus(value: unknown): value is SessionCatalogStatus {
  return (
    typeof value === 'string' &&
    SESSION_CATALOG_STATUS_SET.has(value as SessionCatalogStatus)
  );
}

export function isSessionHistoryStatus(value: unknown): value is SessionHistoryStatus {
  return (
    typeof value === 'string' &&
    SESSION_HISTORY_STATUS_SET.has(value as SessionHistoryStatus)
  );
}

export function isTranscriptThinkingStatus(
  value: unknown,
): value is TranscriptThinkingStatus {
  return (
    typeof value === 'string' &&
    TRANSCRIPT_THINKING_STATUS_SET.has(value as TranscriptThinkingStatus)
  );
}

export function isTranscriptToolStatus(value: unknown): value is TranscriptToolStatus {
  return (
    typeof value === 'string' &&
    TRANSCRIPT_TOOL_STATUS_SET.has(value as TranscriptToolStatus)
  );
}

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false;
  }

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

export function hasControlCharacter(value: string): boolean {
  return /[\u0000-\u001f\u007f-\u009f]/u.test(value);
}
