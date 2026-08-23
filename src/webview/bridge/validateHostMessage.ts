import {
  CONNECTION_STATUSES,
  DIAGNOSTIC_SEVERITIES,
  MAX_ASK_USER_OPTION_LENGTH,
  MAX_ASK_USER_OPTIONS,
  MAX_ASK_USER_QUESTIONS,
  MAX_ASK_USER_QUESTION_LENGTH,
  MAX_ASK_USER_TOPIC_LENGTH,
  MAX_ASSISTANT_TEXT_LENGTH,
  MAX_BRIDGE_ID_LENGTH,
  MAX_EDITED_SPEC_LENGTH,
  MAX_INTERACTION_DETAIL_LENGTH,
  MAX_SPEC_PLAN_LENGTH,
  MAX_INTERACTION_TITLE_LENGTH,
  MAX_MODEL_CATALOG_ITEMS,
  MAX_OPEN_PATH_LENGTH,
  MAX_PERMISSION_OPTIONS,
  MAX_PERMISSION_OPTION_LABEL_LENGTH,
  MAX_PERMISSION_OPTION_VALUE_LENGTH,
  MAX_PERMISSION_RISK_NOTE_LENGTH,
  MAX_PERMISSION_TOOLS,
  MAX_PERMISSION_TOOL_NAME_LENGTH,
  MAX_ARCHIVED_SESSION_ITEMS,
  MAX_SESSION_CATALOG_ITEMS,
  MAX_SESSION_SEARCH_QUERY_LENGTH,
  MAX_SESSION_SEARCH_RESULTS,
  MAX_SESSION_SEARCH_SNIPPET_LENGTH,
  MAX_SESSION_TITLE_LENGTH,
  MAX_SESSION_TRANSCRIPT_ITEMS,
  MAX_WORKTREE_BRANCH_LENGTH,
  MAX_WORKTREE_PATH_LENGTH,
  MAX_MCP_NAME_LENGTH,
  MAX_MCP_SERVERS,
  MAX_MCP_TOOLS_PER_SERVER,
  MAX_MCP_TOOL_DESCRIPTION_LENGTH,
  MAX_PLUGIN_ID_LENGTH,
  MAX_PLUGIN_ITEMS,
  MAX_PLUGIN_MARKETPLACE_COUNT,
  MAX_PLUGIN_VERSION_LENGTH,
  PLUGIN_SCOPES,
  MAX_SKILL_DESCRIPTION_LENGTH,
  MAX_SKILL_ITEMS,
  MAX_SKILL_NAME_LENGTH,
  MAX_COMMAND_ARGUMENT_HINT_LENGTH,
  MAX_COMMAND_DESCRIPTION_LENGTH,
  MAX_COMMAND_ITEMS,
  MAX_RECENT_COMMANDS,
  MAX_MCP_AUTH_MESSAGE_LENGTH,
  MCP_AUTH_PHASES,
  MCP_SERVER_STATUSES,
  MAX_THINKING_DELTA_LENGTH,
  MAX_THINKING_TEXT_LENGTH,
  MAX_TOOL_ACTION_SUMMARY_LENGTH,
  MAX_TOOL_DETAIL_LENGTH,
  MAX_TOOL_ERROR_MESSAGE_LENGTH,
  MAX_TOOL_NAME_LENGTH,
  MAX_TOOL_OUTPUT_TAIL_LENGTH,
  MAX_TOOL_PROGRESS_UPDATES_PER_TOOL,
  MAX_SUBAGENT_DESCRIPTION_LENGTH,
  MAX_SUBAGENT_TYPE_LENGTH,
  MISSION_SESSION_ROLES,
  MISSION_STATES,
  SUBAGENT_STATUSES,
  TOOL_DETAIL_KINDS,
  MAX_TURN_TEXT_LENGTH,
  PERMISSION_CONFIRMATION_KINDS,
  SESSION_AUTONOMY_LEVELS,
  SESSION_CATALOG_STATUSES,
  SESSION_HISTORY_STATUSES,
  SESSION_INTERACTION_MODES,
  SESSION_REASONING_EFFORTS,
  TOOL_ACTIVITY_STATUSES,
  TOOL_ACTIVITY_UPDATE_KINDS,
  ATTACHMENT_KINDS,
  EDIT_RESEND_REJECT_REASONS,
  IMAGE_MEDIA_TYPES,
  IMAGE_ORIGINS,
  MAX_ATTACHMENT_NAME_LENGTH,
  MAX_CHANGED_FILES_PER_TURN,
  GIT_FILE_STATUSES,
  GIT_UNAVAILABLE_REASONS,
  MAX_GIT_BRANCH_LENGTH,
  MAX_GIT_COMMIT_ERROR_LENGTH,
  MAX_GIT_COMMIT_SUBJECT_LENGTH,
  MAX_GIT_STATUS_FILES,
  isGitCommitHashEcho,
  type GitFileStatus,
  type GitStatusFile,
  type GitUnavailableReason,
  MAX_IMAGE_DATA_LENGTH,
  MAX_FILE_SEARCH_RESULTS,
  MAX_PENDING_ATTACHMENTS,
  MAX_REWIND_EVICTED_REASON_LENGTH,
  MAX_REWIND_INFO_FILES,
  type RewindEvictedFile,
  SKILL_LOCATIONS,
  WORKSPACE_FILES_STATUSES,
  type WorkspaceFilesStatus,
  MAX_IMAGE_PATH_LENGTH,
  WORKSPACE_IMAGE_STATUSES,
  type WorkspaceImageStatus,
  THEME_PREFERENCES,
  TRANSCRIPT_THINKING_STATUSES,
  TRANSCRIPT_TOOL_STATUSES,
  TURN_STATUSES,
  type ArchivedSessionSummary,
  type AskUserInteractionRequest,
  type AskUserQuestion,
  type AttachmentKind,
  type AttachmentSummary,
  type ChangedFileSummary,
  type EditAttachmentSummary,
  type EditResendRejectReason,
  type SentAttachmentSummary,
  type ConnectionState,
  type DiagnosticSeverity,
  type HostToWebviewMessage,
  type ImageMediaType,
  type ImageOrigin,
  type ImageTranscriptItem,
  type InteractionRequest,
  type PermissionConfirmationKind,
  type PermissionInteractionRequest,
  type PermissionOption,
  type PermissionToolSummary,
  type ModelCatalogItem,
  type ModelCatalogState,
  type SessionAutonomyLevel,
  type SessionArchivedState,
  type SessionCatalogState,
  type SessionCatalogStatus,
  type SessionSearchHit,
  type SessionSearchState,
  type SessionInteractionMode,
  type SessionReasoningEffort,
  type SessionSettingsState,
  type McpAuthPhase,
  type McpServerStatus,
  type McpServerSummary,
  type McpToolSummary,
  type SessionMcpState,
  type SessionPluginsState,
  type PluginScope,
  type PluginSummary,
  type SessionSkillsState,
  type SkillLocation,
  type SkillSummary,
  type CommandSummary,
  type SessionCommandsState,
  type SessionHistoryStatus,
  type SessionMissionSummary,
  type MissionSessionRole,
  type MissionState,
  type SessionSummary,
  type SessionWorktreeInfo,
  type SessionTranscriptItem,
  type SubagentStatus,
  type ThemePreference,
  type ToolBackgroundHint,
  type ToolSubagentSummary,
  type ToolActivityMessage,
  type ToolActivityUpdateKind,
  type ToolDetailKind,
  type TranscriptThinkingStatus,
  type TranscriptToolStatus,
  type TurnStatus,
} from '../../shared/bridgeMessages';
import {
  CHANGES_UPDATE_STATES,
  type ChangesUpdateState,
} from '../../shared/changesProtocol';
import { parseCustomModelsHostMessage } from '../../shared/customModelsProtocol';
import { parseCanvasFeedbackDraftMessage } from '../../shared/canvasProtocol';
import { parseMissionHostMessage } from '../../shared/missionProtocol';
import { parseSubagentActivityMessage } from '../../shared/subagentProtocol';
import {
  parseSessionBtwMessage,
  type SessionBtwMessage,
} from '../../shared/btwProtocol';
import {
  parseQueueStateMessage,
  parseSessionQueueState,
  type QueueStateMessage,
  type SessionQueueState,
} from '../../shared/queueProtocol';
import {
  hasExactKeys,
  isExactArray,
  isStrictRecord,
  type UnknownRecord,
} from '../../shared/strictValidation';
import {
  parseAskUserResultTranscriptItem,
  parseInteractionClosedMessage,
  parsePlanDocumentStateMessage,
} from './interactionHostValidation';
import type {
  SessionTokenUsageState,
  TokenUsageBreakdown,
} from '../../shared/tokenUsage';
import {
  isSafeCommandName,
  isSafeDisplayName,
  isSafeModelId,
  isSafeWorkspaceRelativePath,
} from '../../shared/validateMessage';
import { parseGitBranchDiff } from './parseGitBranchDiff';
import {
  MAX_SESSION_IMAGE_DATA_UNITS,
  MAX_SESSION_TRANSCRIPT_TEXT_UNITS,
  transcriptImageDataUnits,
  transcriptTextUnits,
} from '../../shared/transcriptLimits';
import { isValidToolTarget } from './validateToolTarget';
import { parseSessionContext } from './validateContextState';

const MAX_STRING_LENGTH = MAX_TURN_TEXT_LENGTH;
const CONNECTION_STATUS_SET = new Set<ConnectionState['status']>(
  CONNECTION_STATUSES,
);
const TURN_STATUS_SET = new Set<TurnStatus>(TURN_STATUSES);
const TOOL_ACTIVITY_STATUS_SET = new Set<ToolActivityMessage['status']>(
  TOOL_ACTIVITY_STATUSES,
);
const TOOL_ACTIVITY_UPDATE_KIND_SET = new Set<ToolActivityUpdateKind>(
  TOOL_ACTIVITY_UPDATE_KINDS,
);
const DIAGNOSTIC_SEVERITY_SET = new Set<DiagnosticSeverity>(
  DIAGNOSTIC_SEVERITIES,
);
const SESSION_CATALOG_STATUS_SET = new Set<SessionCatalogStatus>(
  SESSION_CATALOG_STATUSES,
);
const SESSION_HISTORY_STATUS_SET = new Set<SessionHistoryStatus>(
  SESSION_HISTORY_STATUSES,
);
const TRANSCRIPT_THINKING_STATUS_SET = new Set<TranscriptThinkingStatus>(
  TRANSCRIPT_THINKING_STATUSES,
);
const TRANSCRIPT_TOOL_STATUS_SET = new Set<TranscriptToolStatus>(
  TRANSCRIPT_TOOL_STATUSES,
);
const PERMISSION_CONFIRMATION_KIND_SET =
  new Set<PermissionConfirmationKind>(PERMISSION_CONFIRMATION_KINDS);
const SESSION_INTERACTION_MODE_SET = new Set<SessionInteractionMode>(
  SESSION_INTERACTION_MODES,
);
const SESSION_AUTONOMY_LEVEL_SET = new Set<SessionAutonomyLevel>(
  SESSION_AUTONOMY_LEVELS,
);
const SESSION_REASONING_EFFORT_SET = new Set<SessionReasoningEffort>(
  SESSION_REASONING_EFFORTS,
);
const SUBAGENT_STATUS_SET = new Set<SubagentStatus>(SUBAGENT_STATUSES);
const MISSION_STATE_SET = new Set<MissionState>(MISSION_STATES);
const MISSION_SESSION_ROLE_SET = new Set<MissionSessionRole>(
  MISSION_SESSION_ROLES,
);

export function readHostMessage(
  value: unknown,
): HostToWebviewMessage | undefined {
  try {
    if (!isStrictRecord(value)) {
      return undefined;
    }
    const type = readStringDataProperty(value, 'type');
    if (type === undefined) {
      return undefined;
    }

    switch (type) {
      case 'host.snapshot':
        return parseHostSnapshot(value);
      case 'host.connection':
        return parseHostConnection(value);
      case 'session.settings':
        return parseSessionSettingsMessage(value);
      case 'session.context':
        return parseSessionContextMessage(value);
      case 'session.tokenUsage':
        return parseSessionTokenUsageMessage(value);
      case 'session.model-catalog':
        return parseModelCatalogMessage(value);
      case 'session.skills':
        return parseSessionSkillsMessage(value);
      case 'session.plugins':
        return parseSessionPluginsMessage(value);
      case 'session.mcp':
        return parseSessionMcpMessage(value);
      case 'session.commands':
        return parseSessionCommandsMessage(value);
      case 'mcp.auth':
        return parseMcpAuth(value);
      case 'session.archived':
        return parseSessionArchivedMessage(value);
      case 'session.running':
        return parseSessionRunningMessage(value);
      case 'session.searchResults':
        return parseSessionSearchMessage(value);
      case 'session.attachments':
        return parseSessionAttachmentsMessage(value);
      case 'session.editAttachments':
        return parseSessionEditAttachmentsMessage(value);
      case 'turn.editResendRejected':
        return parseTurnEditResendRejected(value);
      case 'workspace.files':
        return parseWorkspaceFiles(value);
      case 'workspace.imageData':
        return parseWorkspaceImageData(value);
      case 'rewind.info':
        return parseRewindInfo(value);
      case 'assistant.delta':
        return parseAssistantDelta(value);
      case 'thinking.delta':
        return parseThinkingDelta(value);
      case 'thinking.complete':
        return parseThinkingComplete(value);
      case 'tool.activity':
        return parseToolActivity(value);
      case 'subagent.update':
        return parseSubagentUpdate(value);
      case 'subagent.activity':
        return parseSubagentActivityMessage(value) ?? undefined;
      case 'transcript.image':
        return parseTranscriptImage(value);
      case 'changes.update':
        return parseChangesUpdate(value);
      case 'git.status':
        return parseGitStatus(value);
      case 'git.branchDiff':
        return parseGitBranchDiff(value);
      case 'git.commitResult':
        return parseGitCommitResult(value);
      case 'runtime.diagnostic':
        return parseRuntimeDiagnostic(value);
      case 'turn.state':
        return parseTurnState(value);
      case 'user.message-meta':
        return parseUserMessageMeta(value);
      case 'turn.error':
        return parseTurnError(value);
      case 'interaction.request':
        return parseInteractionRequestMessage(value);
      case 'interaction.closed':
        return parseInteractionClosedMessage(value);
      case 'plan.document.state':
        return parsePlanDocumentStateMessage(value);
      case 'session.btw':
        return parseSessionBtw(value);
      case 'queue.state':
        return parseQueueState(value);
      case 'ui.theme':
        return parseUiTheme(value);
      case 'customModels.state':
      case 'customModels.discovery':
      case 'providerModels.state':
        // Delegated to the shared BYOK contract module; the panel's
        // flow hook applies the same parser to its window listener.
        return parseCustomModelsHostMessage(value) ?? undefined;
      case 'canvas.feedbackDraft':
        return parseCanvasFeedbackDraftMessage(value);
      case 'mission.snapshot':
      case 'mission.controlResult':
        return parseMissionHostMessage(value);
      default:
        return undefined;
    }
  } catch {
    return undefined;
  }
}

function parseHostSnapshot(
  value: UnknownRecord,
): Extract<HostToWebviewMessage, { type: 'host.snapshot' }> | undefined {
  if (
    !hasExactKeys(
      value,
      [
        'type',
        'sequence',
        'sessionId',
        'connection',
        'turn',
        'sessions',
        'settings',
        'context',
        'modelCatalog',
        'transcript',
        'historyStatus',
        'truncated',
      ],
      [
        'mission',
        'worktreeCreateAvailable',
        'btwAvailable',
        'backgroundTurnsAvailable',
        'tokenUsage',
        'workspaceRoot',
        'queue',
      ],
    ) ||
    !isSequence(value.sequence) ||
    !isNullableId(value.sessionId) ||
    !isSessionHistoryStatus(value.historyStatus) ||
    typeof value.truncated !== 'boolean' ||
    // Hosts omit the flag when unavailable instead of sending false.
    (value.worktreeCreateAvailable !== undefined &&
      value.worktreeCreateAvailable !== true) ||
    // Same omit-when-unavailable contract as worktreeCreateAvailable.
    (value.btwAvailable !== undefined && value.btwAvailable !== true) ||
    // Same omit-when-unavailable contract (daemon-backed switching).
    (value.backgroundTurnsAvailable !== undefined &&
      value.backgroundTurnsAvailable !== true) ||
    // Hosts omit the root when no usable workspace exists.
    (value.workspaceRoot !== undefined &&
      (!isNonEmptyBoundedString(value.workspaceRoot, MAX_OPEN_PATH_LENGTH) ||
        /[\u0000-\u001f\u007f]/.test(value.workspaceRoot)))
  ) {
    return undefined;
  }
  const mission =
    value.mission === undefined
      ? undefined
      : parseSessionMission(value.mission);
  if (value.mission !== undefined && mission === undefined) {
    return undefined;
  }
  // A mission summary describes the active session only.
  if (mission !== undefined && value.sessionId === null) {
    return undefined;
  }
  const tokenUsage =
    value.tokenUsage === undefined
      ? undefined
      : parseSessionTokenUsageState(value.tokenUsage);
  if (
    (value.tokenUsage !== undefined && tokenUsage === undefined) ||
    // Usage describes the active session only.
    (tokenUsage !== undefined && value.sessionId === null)
  ) {
    return undefined;
  }
  const queue: SessionQueueState | undefined =
    value.queue === undefined
      ? undefined
      : (parseSessionQueueState(value.queue) ?? undefined);
  if (
    (value.queue !== undefined && queue === undefined) ||
    // A queue describes the active session only.
    (queue !== undefined && value.sessionId === null)
  ) {
    return undefined;
  }

  const connection = parseConnection(value.connection);
  if (connection === undefined) {
    return undefined;
  }
  const turn = parseSnapshotTurn(value.turn);
  const sessions = parseSessionCatalog(
    value.sessions,
    value.sessionId,
    // The host marks a catalog row active only once a runtime owns the
    // session. Early recovery snapshots ('connecting') and failed
    // activations ('unavailable') legitimately carry a sessionId with
    // no active row yet; rejecting them silently killed recovery
    // speed-up (the whole snapshot was dropped).
    connection.status !== 'connected',
  );
  const settings = parseSessionSettings(value.settings);
  const context = parseSessionContext(value.context);
  const modelCatalog = parseModelCatalog(value.modelCatalog);
  const transcript = parseSessionTranscript(value.transcript);
  if (
    turn === undefined ||
    sessions === undefined ||
    settings === undefined ||
    context === undefined ||
    modelCatalog === undefined ||
    transcript === undefined ||
    (value.sessionId === null &&
      (turn !== null ||
        transcript.length > 0 ||
        value.historyStatus !== 'unavailable')) ||
    (value.historyStatus === 'unavailable' &&
      (transcript.length > 0 || value.truncated))
  ) {
    return undefined;
  }

  return {
    type: 'host.snapshot',
    sequence: value.sequence,
    sessionId: value.sessionId,
    connection,
    turn,
    sessions,
    settings,
    context,
    modelCatalog,
    transcript,
    historyStatus: value.historyStatus,
    truncated: value.truncated,
    ...(mission === undefined ? {} : { mission }),
    ...(value.worktreeCreateAvailable === undefined
      ? {}
      : { worktreeCreateAvailable: true }),
    ...(value.btwAvailable === undefined ? {} : { btwAvailable: true }),
    ...(value.backgroundTurnsAvailable === undefined
      ? {}
      : { backgroundTurnsAvailable: true }),
    ...(tokenUsage === undefined ? {} : { tokenUsage }),
    ...(queue === undefined ? {} : { queue }),
    ...(value.workspaceRoot === undefined
      ? {}
      : { workspaceRoot: value.workspaceRoot }),
  };
}

function parseSessionMission(
  value: unknown,
): SessionMissionSummary | undefined {
  if (
    !isStrictRecord(value) ||
    !hasExactKeys(value, ['state', 'role']) ||
    (value.state !== null && !isMissionState(value.state)) ||
    (value.role !== null && !isMissionSessionRole(value.role)) ||
    // An all-null summary carries no information; the host omits the
    // field instead.
    (value.state === null && value.role === null)
  ) {
    return undefined;
  }
  return { state: value.state, role: value.role };
}

function isMissionState(value: unknown): value is MissionState {
  return (
    typeof value === 'string' &&
    MISSION_STATE_SET.has(value as MissionState)
  );
}

function isMissionSessionRole(
  value: unknown,
): value is MissionSessionRole {
  return (
    typeof value === 'string' &&
    MISSION_SESSION_ROLE_SET.has(value as MissionSessionRole)
  );
}

function parseSessionSettingsMessage(
  value: UnknownRecord,
): Extract<HostToWebviewMessage, { type: 'session.settings' }> | undefined {
  if (
    !hasExactKeys(value, ['type', 'sequence', 'sessionId', 'settings']) ||
    !isSequence(value.sequence) ||
    !isId(value.sessionId)
  ) {
    return undefined;
  }
  const settings = parseSessionSettings(value.settings);
  return settings === undefined
    ? undefined
    : {
        type: 'session.settings',
        sequence: value.sequence,
        sessionId: value.sessionId,
        settings,
      };
}

function parseSessionContextMessage(
  value: UnknownRecord,
): Extract<HostToWebviewMessage, { type: 'session.context' }> | undefined {
  if (
    !hasExactKeys(value, ['type', 'sequence', 'sessionId', 'context']) ||
    !isSequence(value.sequence) ||
    !isId(value.sessionId)
  ) {
    return undefined;
  }
  const context = parseSessionContext(value.context);
  return context === undefined
    ? undefined
    : {
        type: 'session.context',
        sequence: value.sequence,
        sessionId: value.sessionId,
        context,
      };
}

function parseSessionTokenUsageMessage(
  value: UnknownRecord,
):
  | Extract<HostToWebviewMessage, { type: 'session.tokenUsage' }>
  | undefined {
  if (
    !hasExactKeys(value, [
      'type',
      'sequence',
      'sessionId',
      'tokenUsage',
    ]) ||
    !isSequence(value.sequence) ||
    !isId(value.sessionId)
  ) {
    return undefined;
  }
  const tokenUsage = parseSessionTokenUsageState(value.tokenUsage);
  return tokenUsage === undefined
    ? undefined
    : {
        type: 'session.tokenUsage',
        sequence: value.sequence,
        sessionId: value.sessionId,
        tokenUsage,
      };
}

function parseSessionTokenUsageState(
  value: unknown,
): SessionTokenUsageState | undefined {
  if (
    !isStrictRecord(value) ||
    !hasExactKeys(value, ['cumulative', 'lastTurn'])
  ) {
    return undefined;
  }
  const cumulative =
    value.cumulative === null
      ? null
      : parseTokenUsageBreakdown(value.cumulative);
  const lastTurn =
    value.lastTurn === null
      ? null
      : parseTokenUsageBreakdown(value.lastTurn);
  if (cumulative === undefined || lastTurn === undefined) {
    return undefined;
  }
  return { cumulative, lastTurn };
}

function parseTokenUsageBreakdown(
  value: unknown,
): TokenUsageBreakdown | undefined {
  if (
    !isStrictRecord(value) ||
    !hasExactKeys(
      value,
      [
        'inputTokens',
        'outputTokens',
        'cacheReadTokens',
        'cacheCreationTokens',
        'thinkingTokens',
      ],
      ['factoryCredits'],
    ) ||
    !isTokenCount(value.inputTokens) ||
    !isTokenCount(value.outputTokens) ||
    !isTokenCount(value.cacheReadTokens) ||
    !isTokenCount(value.cacheCreationTokens) ||
    !isTokenCount(value.thinkingTokens) ||
    (value.factoryCredits !== undefined &&
      (typeof value.factoryCredits !== 'number' ||
        !Number.isFinite(value.factoryCredits) ||
        value.factoryCredits < 0))
  ) {
    return undefined;
  }
  return {
    inputTokens: value.inputTokens,
    outputTokens: value.outputTokens,
    cacheReadTokens: value.cacheReadTokens,
    cacheCreationTokens: value.cacheCreationTokens,
    thinkingTokens: value.thinkingTokens,
    ...(value.factoryCredits === undefined
      ? {}
      : { factoryCredits: value.factoryCredits }),
  };
}

function isTokenCount(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0
  );
}

function parseModelCatalogMessage(
  value: UnknownRecord,
): Extract<
  HostToWebviewMessage,
  { type: 'session.model-catalog' }
> | undefined {
  if (
    !hasExactKeys(value, [
      'type',
      'sequence',
      'sessionId',
      'modelCatalog',
    ]) ||
    !isSequence(value.sequence) ||
    !isId(value.sessionId)
  ) {
    return undefined;
  }
  const modelCatalog = parseModelCatalog(value.modelCatalog);
  return modelCatalog === undefined
    ? undefined
    : {
        type: 'session.model-catalog',
        sequence: value.sequence,
        sessionId: value.sessionId,
        modelCatalog,
      };
}

function parseHostConnection(
  value: UnknownRecord,
): Extract<HostToWebviewMessage, { type: 'host.connection' }> | undefined {
  if (
    !hasExactKeys(value, ['type', 'sequence', 'sessionId', 'connection']) ||
    !isSequence(value.sequence) ||
    !isNullableId(value.sessionId)
  ) {
    return undefined;
  }

  const connection = parseConnection(value.connection);
  if (connection === undefined) {
    return undefined;
  }

  return {
    type: 'host.connection',
    sequence: value.sequence,
    sessionId: value.sessionId,
    connection,
  };
}

function parseAssistantDelta(
  value: UnknownRecord,
): Extract<HostToWebviewMessage, { type: 'assistant.delta' }> | undefined {
  if (
    !hasExactKeys(value, [
      'type',
      'sequence',
      'sessionId',
      'turnId',
      'delta',
    ]) ||
    !hasTurnIdentity(value) ||
    !isNonEmptyBoundedString(value.delta, MAX_ASSISTANT_TEXT_LENGTH)
  ) {
    return undefined;
  }

  return {
    type: 'assistant.delta',
    sequence: value.sequence,
    sessionId: value.sessionId,
    turnId: value.turnId,
    delta: value.delta,
  };
}

function parseThinkingDelta(
  value: UnknownRecord,
): Extract<HostToWebviewMessage, { type: 'thinking.delta' }> | undefined {
  if (
    !hasExactKeys(value, [
      'type',
      'sequence',
      'sessionId',
      'turnId',
      'delta',
      'truncated',
      'segmentIndex',
    ]) ||
    !hasTurnIdentity(value) ||
    !isBoundedString(value.delta, MAX_THINKING_DELTA_LENGTH) ||
    typeof value.truncated !== 'boolean' ||
    !isSequence(value.segmentIndex)
  ) {
    return undefined;
  }

  return {
    type: 'thinking.delta',
    sequence: value.sequence,
    sessionId: value.sessionId,
    turnId: value.turnId,
    delta: value.delta,
    truncated: value.truncated,
    segmentIndex: value.segmentIndex,
  };
}

function parseThinkingComplete(
  value: UnknownRecord,
): Extract<HostToWebviewMessage, { type: 'thinking.complete' }> | undefined {
  if (
    !hasExactKeys(value, [
      'type',
      'sequence',
      'sessionId',
      'turnId',
      'durationMs',
      'segmentIndex',
    ]) ||
    !hasTurnIdentity(value) ||
    (value.durationMs !== null && !isSequence(value.durationMs)) ||
    !isSequence(value.segmentIndex)
  ) {
    return undefined;
  }

  return {
    type: 'thinking.complete',
    sequence: value.sequence,
    sessionId: value.sessionId,
    turnId: value.turnId,
    durationMs: value.durationMs,
    segmentIndex: value.segmentIndex,
  };
}

function parseToolActivity(
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
        'backgroundHint',
        'subagent',
      ],
    ) ||
    !hasTurnIdentity(value) ||
    !isId(value.toolUseId) ||
    !isNonEmptyBoundedString(value.toolName, MAX_TOOL_NAME_LENGTH) ||
    !isNonEmptyBoundedString(
      value.action,
      MAX_TOOL_ACTION_SUMMARY_LENGTH,
    ) ||
    !isToolActivityStatus(value.status) ||
    !isBoundedToolProgressCount(value.progressCount) ||
    !isNullableToolActivityUpdateKind(value.latestUpdateKind) ||
    !hasConsistentToolProgress(
      value.progressCount,
      value.latestUpdateKind,
    ) ||
    (value.durationMs !== undefined && !isSequence(value.durationMs)) ||
    (value.filePath !== undefined &&
      !isSafeWorkspaceRelativePath(value.filePath)) ||
    !hasValidAdditionalFileCount(value) ||
    !hasValidToolDetail(value) ||
    !isValidToolTarget(value.target) ||
    !hasValidToolErrorMessage(value) ||
    !hasValidToolOutputTail(value)
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
    value.subagent === undefined
      ? undefined
      : parseToolSubagent(value.subagent);
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
    ...(value.durationMs === undefined
      ? {}
      : { durationMs: value.durationMs }),
    ...(value.filePath === undefined
      ? {}
      : { filePath: value.filePath }),
    ...(value.additionalFileCount === undefined
      ? {}
      : { additionalFileCount: value.additionalFileCount as number }),
    ...(value.detailKind === undefined
      ? {}
      : {
          detailKind: value.detailKind as ToolDetailKind,
          detail: value.detail as string,
        }),
    ...(value.target === undefined ? {} : { target: value.target as string }),
    ...(value.errorMessage === undefined
      ? {}
      : { errorMessage: value.errorMessage as string }),
    ...(value.outputTail === undefined
      ? {}
      : { outputTail: value.outputTail as string }),
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
function parseSubagentUpdate(
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
function parseToolBackgroundHint(
  value: unknown,
): ToolBackgroundHint | undefined {
  if (
    !isStrictRecord(value) ||
    !hasExactKeys(value, ['fireAndForget']) ||
    typeof value.fireAndForget !== 'boolean'
  ) {
    return undefined;
  }
  return { fireAndForget: value.fireAndForget };
}

function parseToolSubagent(
  value: unknown,
): ToolSubagentSummary | undefined {
  if (
    !isStrictRecord(value) ||
    !hasExactKeys(
      value,
      ['type', 'description'],
      ['status', 'toolUseCount', 'durationMs'],
    ) ||
    !isNonEmptyBoundedString(value.type, MAX_SUBAGENT_TYPE_LENGTH) ||
    hasControlCharacter(value.type) ||
    !isBoundedString(
      value.description,
      MAX_SUBAGENT_DESCRIPTION_LENGTH,
    ) ||
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
    ...(value.toolUseCount === undefined
      ? {}
      : { toolUseCount: value.toolUseCount }),
    ...(value.durationMs === undefined
      ? {}
      : { durationMs: value.durationMs }),
  };
}

function isSubagentStatus(value: unknown): value is SubagentStatus {
  return (
    typeof value === 'string' &&
    SUBAGENT_STATUS_SET.has(value as SubagentStatus)
  );
}

function parseTranscriptImage(
  value: UnknownRecord,
):
  | Extract<HostToWebviewMessage, { type: 'transcript.image' }>
  | undefined {
  if (
    !hasExactKeys(value, [
      'type',
      'sequence',
      'sessionId',
      'turnId',
      'item',
    ]) ||
    !hasTurnIdentity(value)
  ) {
    return undefined;
  }
  const item = parseImageTranscriptItem(value.item);
  if (item === undefined || item.turnId !== value.turnId) {
    return undefined;
  }
  return {
    type: 'transcript.image',
    sequence: value.sequence,
    sessionId: value.sessionId,
    turnId: value.turnId,
    item,
  };
}

const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;

function parseImageTranscriptItem(
  value: unknown,
): ImageTranscriptItem | undefined {
  if (
    !isStrictRecord(value) ||
    !hasExactKeys(value, [
      'id',
      'kind',
      'turnId',
      'origin',
      'mediaType',
      'data',
      'generated',
      'byteLength',
    ]) ||
    value.kind !== 'image' ||
    !isId(value.id) ||
    !isId(value.turnId) ||
    !isImageOrigin(value.origin) ||
    !isImageMediaType(value.mediaType) ||
    typeof value.data !== 'string' ||
    value.data.length > MAX_IMAGE_DATA_LENGTH ||
    !BASE64_PATTERN.test(value.data) ||
    typeof value.generated !== 'boolean' ||
    !isCount(value.byteLength)
  ) {
    return undefined;
  }
  return {
    id: value.id,
    kind: 'image',
    turnId: value.turnId,
    origin: value.origin,
    mediaType: value.mediaType,
    data: value.data,
    generated: value.generated,
    byteLength: value.byteLength,
  };
}

function isImageOrigin(value: unknown): value is ImageOrigin {
  return (
    typeof value === 'string' &&
    (IMAGE_ORIGINS as readonly string[]).includes(value)
  );
}

function isImageMediaType(value: unknown): value is ImageMediaType {
  return (
    typeof value === 'string' &&
    (IMAGE_MEDIA_TYPES as readonly string[]).includes(value)
  );
}

const CHANGES_UPDATE_STATE_SET = new Set<string>(
  CHANGES_UPDATE_STATES,
);

function parseChangesUpdate(
  value: UnknownRecord,
): Extract<HostToWebviewMessage, { type: 'changes.update' }> | undefined {
  if (
    !hasExactKeys(value, [
      'type',
      'sequence',
      'sessionId',
      'turnId',
      'state',
      'files',
    ]) ||
    !hasTurnIdentity(value) ||
    typeof value.state !== 'string' ||
    !CHANGES_UPDATE_STATE_SET.has(value.state)
  ) {
    return undefined;
  }
  const files = parseChangedFiles(value.files);
  if (files === undefined) {
    return undefined;
  }

  return {
    type: 'changes.update',
    sequence: value.sequence,
    sessionId: value.sessionId,
    turnId: value.turnId,
    state: value.state as ChangesUpdateState,
    files,
  };
}

function parseChangedFiles(
  value: unknown,
): ChangedFileSummary[] | undefined {
  if (!isExactArray(value, 1, MAX_CHANGED_FILES_PER_TURN)) {
    return undefined;
  }
  const files: ChangedFileSummary[] = [];
  const paths = new Set<string>();
  for (const fileValue of value) {
    if (
      !isStrictRecord(fileValue) ||
      !hasExactKeys(fileValue, ['path', 'additions', 'deletions']) ||
      !isSafeWorkspaceRelativePath(fileValue.path) ||
      paths.has(fileValue.path) ||
      !isNullableCount(fileValue.additions) ||
      !isNullableCount(fileValue.deletions)
    ) {
      return undefined;
    }
    paths.add(fileValue.path);
    files.push({
      path: fileValue.path,
      additions: fileValue.additions,
      deletions: fileValue.deletions,
    });
  }
  return files;
}

function isNullableCount(value: unknown): value is number | null {
  return value === null || isCount(value);
}

const GIT_FILE_STATUS_SET = new Set<string>(GIT_FILE_STATUSES);

function isGitFileStatus(value: unknown): value is GitFileStatus {
  return (
    typeof value === 'string' && GIT_FILE_STATUS_SET.has(value)
  );
}

const GIT_UNAVAILABLE_REASON_SET = new Set<string>(
  GIT_UNAVAILABLE_REASONS,
);

function isGitUnavailableReason(
  value: unknown,
): value is GitUnavailableReason {
  return (
    typeof value === 'string' &&
    GIT_UNAVAILABLE_REASON_SET.has(value)
  );
}

function parseGitStatus(
  value: UnknownRecord,
): Extract<HostToWebviewMessage, { type: 'git.status' }> | undefined {
  if (
    !hasExactKeys(
      value,
      ['type', 'sequence', 'sessionId', 'turnId', 'branch', 'files'],
      ['committedHash', 'unavailableReason'],
    ) ||
    !isSequence(value.sequence) ||
    !isId(value.sessionId) ||
    !isId(value.turnId)
  ) {
    return undefined;
  }
  const branch = value.branch;
  if (
    branch !== null &&
    !isNonEmptyBoundedString(branch, MAX_GIT_BRANCH_LENGTH)
  ) {
    return undefined;
  }
  const reason = value.unavailableReason;
  if (reason !== undefined && !isGitUnavailableReason(reason)) {
    return undefined;
  }
  const committedHash = value.committedHash;
  if (
    committedHash !== undefined &&
    (!isGitCommitHashEcho(committedHash) || committedHash === '')
  ) {
    return undefined;
  }
  const files = parseGitStatusFiles(value.files);
  // An unavailable report must not smuggle repository data.
  if (
    files === undefined ||
    (reason !== undefined &&
      (files.length > 0 ||
        branch !== null ||
        committedHash !== undefined))
  ) {
    return undefined;
  }

  return {
    type: 'git.status',
    sequence: value.sequence,
    sessionId: value.sessionId,
    turnId: value.turnId,
    branch,
    files,
    ...(committedHash === undefined ? {} : { committedHash }),
    ...(reason === undefined ? {} : { unavailableReason: reason }),
  };
}

function parseGitStatusFiles(
  value: unknown,
): GitStatusFile[] | undefined {
  if (!isExactArray(value, 0, MAX_GIT_STATUS_FILES)) {
    return undefined;
  }
  const files: GitStatusFile[] = [];
  const paths = new Set<string>();
  for (const fileValue of value) {
    if (
      !isStrictRecord(fileValue) ||
      !hasExactKeys(fileValue, [
        'path',
        'status',
        'staged',
        'inTurn',
      ]) ||
      !isSafeWorkspaceRelativePath(fileValue.path) ||
      paths.has(fileValue.path) ||
      !isGitFileStatus(fileValue.status) ||
      typeof fileValue.staged !== 'boolean' ||
      typeof fileValue.inTurn !== 'boolean'
    ) {
      return undefined;
    }
    paths.add(fileValue.path);
    files.push({
      path: fileValue.path,
      status: fileValue.status,
      staged: fileValue.staged,
      inTurn: fileValue.inTurn,
    });
  }
  return files;
}

function parseGitCommitResult(
  value: UnknownRecord,
):
  | Extract<HostToWebviewMessage, { type: 'git.commitResult' }>
  | undefined {
  if (value.ok === true) {
    if (
      !hasExactKeys(value, [
        'type',
        'sequence',
        'sessionId',
        'turnId',
        'ok',
        'hash',
        'subject',
      ]) ||
      !isSequence(value.sequence) ||
      !isId(value.sessionId) ||
      !isId(value.turnId) ||
      !isGitCommitHashEcho(value.hash) ||
      !isBoundedString(value.subject, MAX_GIT_COMMIT_SUBJECT_LENGTH)
    ) {
      return undefined;
    }
    return {
      type: 'git.commitResult',
      sequence: value.sequence,
      sessionId: value.sessionId,
      turnId: value.turnId,
      ok: true,
      hash: value.hash,
      subject: value.subject,
    };
  }
  if (value.ok === false) {
    if (
      !hasExactKeys(value, [
        'type',
        'sequence',
        'sessionId',
        'turnId',
        'ok',
        'error',
      ]) ||
      !isSequence(value.sequence) ||
      !isId(value.sessionId) ||
      !isId(value.turnId) ||
      !isNonEmptyBoundedString(
        value.error,
        MAX_GIT_COMMIT_ERROR_LENGTH,
      )
    ) {
      return undefined;
    }
    return {
      type: 'git.commitResult',
      sequence: value.sequence,
      sessionId: value.sessionId,
      turnId: value.turnId,
      ok: false,
      error: value.error,
    };
  }
  return undefined;
}

function parseRuntimeDiagnostic(
  value: UnknownRecord,
): Extract<HostToWebviewMessage, { type: 'runtime.diagnostic' }> | undefined {
  if (
    !hasExactKeys(
      value,
      [
        'type',
        'sequence',
        'sessionId',
        'turnId',
        'severity',
        'code',
        'message',
      ],
      ['relatedSessionId'],
    ) ||
    !isSequence(value.sequence) ||
    !isNullableId(value.sessionId) ||
    !isNullableId(value.turnId) ||
    !isDiagnosticSeverity(value.severity) ||
    !isBoundedString(value.code, MAX_STRING_LENGTH) ||
    !isBoundedString(value.message, MAX_STRING_LENGTH) ||
    (value.relatedSessionId !== undefined &&
      !isId(value.relatedSessionId))
  ) {
    return undefined;
  }

  return {
    type: 'runtime.diagnostic',
    sequence: value.sequence,
    sessionId: value.sessionId,
    turnId: value.turnId,
    severity: value.severity,
    code: value.code,
    message: value.message,
    ...(value.relatedSessionId === undefined
      ? {}
      : { relatedSessionId: value.relatedSessionId }),
  };
}

function parseTurnState(
  value: UnknownRecord,
): Extract<HostToWebviewMessage, { type: 'turn.state' }> | undefined {
  if (
    !hasExactKeys(value, [
      'type',
      'sequence',
      'sessionId',
      'turnId',
      'status',
    ]) ||
    !hasTurnIdentity(value) ||
    !isTurnStatus(value.status)
  ) {
    return undefined;
  }

  return {
    type: 'turn.state',
    sequence: value.sequence,
    sessionId: value.sessionId,
    turnId: value.turnId,
    status: value.status,
  };
}

function parseUserMessageMeta(
  value: UnknownRecord,
): Extract<
  HostToWebviewMessage,
  { type: 'user.message-meta' }
> | undefined {
  if (
    !hasExactKeys(value, [
      'type',
      'sequence',
      'sessionId',
      'turnId',
      'messageId',
    ]) ||
    !hasTurnIdentity(value) ||
    !isId(value.messageId)
  ) {
    return undefined;
  }

  return {
    type: 'user.message-meta',
    sequence: value.sequence,
    sessionId: value.sessionId,
    turnId: value.turnId,
    messageId: value.messageId,
  };
}

function parseTurnError(
  value: UnknownRecord,
): Extract<HostToWebviewMessage, { type: 'turn.error' }> | undefined {
  if (
    !hasExactKeys(value, [
      'type',
      'sequence',
      'sessionId',
      'turnId',
      'code',
      'message',
      'retryable',
    ]) ||
    !hasTurnIdentity(value) ||
    !isBoundedString(value.code, MAX_STRING_LENGTH) ||
    !isBoundedString(value.message, MAX_STRING_LENGTH) ||
    typeof value.retryable !== 'boolean'
  ) {
    return undefined;
  }

  return {
    type: 'turn.error',
    sequence: value.sequence,
    sessionId: value.sessionId,
    turnId: value.turnId,
    code: value.code,
    message: value.message,
    retryable: value.retryable,
  };
}

function parseInteractionRequestMessage(
  value: UnknownRecord,
):
  | Extract<HostToWebviewMessage, { type: 'interaction.request' }>
  | undefined {
  if (
    !hasExactKeys(value, [
      'type',
      'sequence',
      'sessionId',
      'turnId',
      'request',
    ]) ||
    !hasTurnIdentity(value)
  ) {
    return undefined;
  }

  const request = parseInteractionRequest(value.request);
  if (request === undefined) {
    return undefined;
  }

  return {
    type: 'interaction.request',
    sequence: value.sequence,
    sessionId: value.sessionId,
    turnId: value.turnId,
    request,
  };
}

function parseSessionBtw(
  value: UnknownRecord,
): SessionBtwMessage | undefined {
  // The shared parser owns the shape and content bounds; the
  // non-negative safe-integer sequence contract is this module's.
  const message = parseSessionBtwMessage(value);
  return message !== null && isSequence(message.sequence)
    ? message
    : undefined;
}

function parseQueueState(
  value: UnknownRecord,
): QueueStateMessage | undefined {
  // The shared parser owns the shape and content bounds; the
  // non-negative safe-integer sequence contract is this module's.
  const message = parseQueueStateMessage(value);
  return message !== null && isSequence(message.sequence)
    ? message
    : undefined;
}

/** Sequence-free view theme push, applied outside the session store. */
function parseUiTheme(
  value: UnknownRecord,
): Extract<HostToWebviewMessage, { type: 'ui.theme' }> | undefined {
  if (
    !hasExactKeys(value, ['type', 'preference', 'resolved']) ||
    typeof value.preference !== 'string' ||
    !(THEME_PREFERENCES as readonly string[]).includes(value.preference) ||
    (value.resolved !== 'light' && value.resolved !== 'dark')
  ) {
    return undefined;
  }
  return {
    type: 'ui.theme',
    preference: value.preference as ThemePreference,
    resolved: value.resolved,
  };
}

function parseInteractionRequest(
  value: unknown,
): InteractionRequest | undefined {
  if (!isStrictRecord(value) || typeof value.kind !== 'string') {
    return undefined;
  }

  switch (value.kind) {
    case 'permission':
      return parsePermissionRequest(value);
    case 'ask-user':
      return parseAskUserRequest(value);
    default:
      return undefined;
  }
}

function parsePermissionRequest(
  value: UnknownRecord,
): PermissionInteractionRequest | undefined {
  if (
    !hasExactKeys(
      value,
      ['requestId', 'kind', 'tools', 'options'],
      ['editableSpecContent'],
    ) ||
    !isId(value.requestId) ||
    !isExactArray(value.tools, 1, MAX_PERMISSION_TOOLS) ||
    !isExactArray(value.options, 1, MAX_PERMISSION_OPTIONS) ||
    (value.editableSpecContent !== undefined &&
      !isBoundedString(
        value.editableSpecContent,
        MAX_EDITED_SPEC_LENGTH,
      ))
  ) {
    return undefined;
  }

  const tools: PermissionToolSummary[] = [];
  for (const toolValue of value.tools) {
    const tool = parsePermissionTool(toolValue);
    if (tool === undefined) {
      return undefined;
    }
    tools.push(tool);
  }

  const options: PermissionOption[] = [];
  for (const optionValue of value.options) {
    const option = parsePermissionOption(optionValue);
    if (option === undefined) {
      return undefined;
    }
    options.push(option);
  }

  const hasEditableSpecTool = tools.some(
    ({ confirmationKind }) => confirmationKind === 'exit_spec_mode',
  );
  if (
    (value.editableSpecContent !== undefined && !hasEditableSpecTool) ||
    (options.some(({ requiresEditedSpec }) => requiresEditedSpec) &&
      (value.editableSpecContent === undefined || !hasEditableSpecTool))
  ) {
    return undefined;
  }

  return value.editableSpecContent === undefined
    ? {
        requestId: value.requestId,
        kind: 'permission',
        tools,
        options,
      }
    : {
        requestId: value.requestId,
        kind: 'permission',
        tools,
        options,
        editableSpecContent: value.editableSpecContent,
      };
}

function parsePermissionTool(
  value: unknown,
): PermissionToolSummary | undefined {
  if (
    !isStrictRecord(value) ||
    !hasExactKeys(
      value,
      [
        'toolUseId',
        'toolName',
        'confirmationKind',
        'title',
      ],
      ['detail', 'riskNote'],
    ) ||
    !isId(value.toolUseId) ||
    !isNonEmptyBoundedString(
      value.toolName,
      MAX_PERMISSION_TOOL_NAME_LENGTH,
    ) ||
    !isPermissionConfirmationKind(value.confirmationKind) ||
    !isNonEmptyBoundedString(value.title, MAX_INTERACTION_TITLE_LENGTH) ||
    // ExitSpecMode carries the full plan as its detail, which routinely
    // exceeds the generic detail cap; it gets the dedicated plan cap.
    (value.detail !== undefined &&
      !isBoundedString(
        value.detail,
        value.confirmationKind === 'exit_spec_mode'
          ? MAX_SPEC_PLAN_LENGTH
          : MAX_INTERACTION_DETAIL_LENGTH,
      )) ||
    (value.riskNote !== undefined &&
      !isBoundedString(
        value.riskNote,
        MAX_PERMISSION_RISK_NOTE_LENGTH,
      ))
  ) {
    return undefined;
  }

  return {
    toolUseId: value.toolUseId,
    toolName: value.toolName,
    confirmationKind: value.confirmationKind,
    title: value.title,
    ...(value.detail === undefined ? {} : { detail: value.detail }),
    ...(value.riskNote === undefined ? {} : { riskNote: value.riskNote }),
  };
}

function parsePermissionOption(
  value: unknown,
): PermissionOption | undefined {
  if (
    !isStrictRecord(value) ||
    !hasExactKeys(value, ['label', 'value', 'requiresEditedSpec']) ||
    !isNonEmptyBoundedString(
      value.label,
      MAX_PERMISSION_OPTION_LABEL_LENGTH,
    ) ||
    !isNonEmptyBoundedString(
      value.value,
      MAX_PERMISSION_OPTION_VALUE_LENGTH,
    ) ||
    typeof value.requiresEditedSpec !== 'boolean'
  ) {
    return undefined;
  }

  return {
    label: value.label,
    value: value.value,
    requiresEditedSpec: value.requiresEditedSpec,
  };
}

function parseAskUserRequest(
  value: UnknownRecord,
): AskUserInteractionRequest | undefined {
  if (
    !hasExactKeys(value, [
      'requestId',
      'kind',
      'toolCallId',
      'questions',
    ]) ||
    !isId(value.requestId) ||
    !isId(value.toolCallId) ||
    !isExactArray(value.questions, 1, MAX_ASK_USER_QUESTIONS)
  ) {
    return undefined;
  }

  const questions: AskUserQuestion[] = [];
  const indices = new Set<number>();
  for (const questionValue of value.questions) {
    const question = parseAskUserQuestion(questionValue);
    if (question === undefined || indices.has(question.index)) {
      return undefined;
    }
    indices.add(question.index);
    questions.push(question);
  }

  return {
    requestId: value.requestId,
    kind: 'ask-user',
    toolCallId: value.toolCallId,
    questions,
  };
}

function parseAskUserQuestion(
  value: unknown,
): AskUserQuestion | undefined {
  if (
    !isStrictRecord(value) ||
    !hasExactKeys(value, [
      'index',
      'topic',
      'question',
      'options',
      'multiSelect',
    ]) ||
    !isSequence(value.index) ||
    !isBoundedString(value.topic, MAX_ASK_USER_TOPIC_LENGTH) ||
    !isNonEmptyBoundedString(
      value.question,
      MAX_ASK_USER_QUESTION_LENGTH,
    ) ||
    !isExactArray(value.options, 0, MAX_ASK_USER_OPTIONS) ||
    typeof value.multiSelect !== 'boolean' ||
    !value.options.every((option) =>
      isNonEmptyBoundedString(option, MAX_ASK_USER_OPTION_LENGTH),
    )
  ) {
    return undefined;
  }

  return {
    index: value.index,
    topic: value.topic,
    question: value.question,
    options: [...value.options],
    multiSelect: value.multiSelect,
  };
}

function parseSessionSettings(
  value: unknown,
): SessionSettingsState | undefined {
  if (!isStrictRecord(value)) {
    return undefined;
  }
  const status = readStringDataProperty(value, 'status');
  if (status === undefined) {
    return undefined;
  }

  if (status === 'error') {
    if (
      !hasExactKeys(value, ['status', 'value', 'message']) ||
      !isBoundedString(value.message, MAX_STRING_LENGTH)
    ) {
      return undefined;
    }
    const confirmed =
      value.value === null ? null : parseConfirmedSettings(value.value);
    return confirmed === undefined
      ? undefined
      : {
          status: 'error',
          value: confirmed,
          message: value.message,
        };
  }

  if (
    (status !== 'loading' &&
      status !== 'ready' &&
      status !== 'updating') ||
    !hasExactKeys(value, ['status', 'value'])
  ) {
    return undefined;
  }
  const confirmed =
    value.value === null ? null : parseConfirmedSettings(value.value);
  if (
    confirmed === undefined ||
    ((status === 'ready' || status === 'updating') &&
      confirmed === null)
  ) {
    return undefined;
  }
  if (status === 'loading') {
    return { status: 'loading', value: confirmed };
  }
  if (confirmed === null) {
    return undefined;
  }
  return status === 'ready'
    ? { status: 'ready', value: confirmed }
    : { status: 'updating', value: confirmed };
}

function parseConfirmedSettings(
  value: unknown,
): Exclude<SessionSettingsState['value'], null> | undefined {
  if (
    !isStrictRecord(value) ||
    !hasExactKeys(value, [
      'interactionMode',
      'modelId',
      'reasoningEffort',
      'autonomyLevel',
      'specModeModelId',
      'specModeReasoningEffort',
    ]) ||
    !isSessionInteractionMode(value.interactionMode) ||
    !isSafeModelId(value.modelId) ||
    !isSessionReasoningEffort(value.reasoningEffort) ||
    !isSessionAutonomyLevel(value.autonomyLevel) ||
    (value.specModeModelId !== null &&
      !isSafeModelId(value.specModeModelId)) ||
    (value.specModeReasoningEffort !== null &&
      !isSessionReasoningEffort(value.specModeReasoningEffort))
  ) {
    return undefined;
  }
  return {
    interactionMode: value.interactionMode,
    modelId: value.modelId,
    reasoningEffort: value.reasoningEffort,
    autonomyLevel: value.autonomyLevel,
    specModeModelId: value.specModeModelId,
    specModeReasoningEffort: value.specModeReasoningEffort,
  };
}

function parseModelCatalog(value: unknown): ModelCatalogState | undefined {
  if (!isStrictRecord(value)) {
    return undefined;
  }
  const status = readStringDataProperty(value, 'status');
  if (status === undefined) {
    return undefined;
  }

  if (status === 'ready') {
    if (
      !hasExactKeys(value, ['status', 'items']) ||
      !isExactArray(value.items, 0, MAX_MODEL_CATALOG_ITEMS)
    ) {
      return undefined;
    }
    const items: ModelCatalogItem[] = [];
    const ids = new Set<string>();
    for (const itemValue of value.items) {
      const item = parseModelCatalogItem(itemValue);
      if (item === undefined || ids.has(item.id)) {
        return undefined;
      }
      ids.add(item.id);
      items.push(item);
    }
    return { status: 'ready', items };
  }

  if (
    status !== 'loading' &&
    status !== 'error' &&
    status !== 'unsupported'
  ) {
    return undefined;
  }
  const expectsMessage =
    status === 'error' || status === 'unsupported';
  if (
    !hasExactKeys(
      value,
      expectsMessage ? ['status', 'items', 'message'] : ['status', 'items'],
    ) ||
    !isExactArray(value.items, 0, 0) ||
    (expectsMessage &&
      !isBoundedString(value.message, MAX_STRING_LENGTH))
  ) {
    return undefined;
  }
  return status === 'loading'
    ? { status: 'loading', items: [] }
    : status === 'error'
      ? { status: 'error', items: [], message: value.message as string }
      : {
          status: 'unsupported',
          items: [],
          message: value.message as string,
        };
}

function parseSessionAttachmentsMessage(
  value: UnknownRecord,
):
  | Extract<HostToWebviewMessage, { type: 'session.attachments' }>
  | undefined {
  if (
    !hasExactKeys(value, [
      'type',
      'sequence',
      'sessionId',
      'attachments',
    ]) ||
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

function parseSessionEditAttachmentsMessage(
  value: UnknownRecord,
):
  | Extract<HostToWebviewMessage, { type: 'session.editAttachments' }>
  | undefined {
  if (
    !hasExactKeys(value, [
      'type',
      'sequence',
      'sessionId',
      'messageId',
      'attachments',
    ]) ||
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
    if (
      !isStrictRecord(itemValue) ||
      typeof itemValue.restorable !== 'boolean'
    ) {
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

function parseTurnEditResendRejected(
  value: UnknownRecord,
):
  | Extract<HostToWebviewMessage, { type: 'turn.editResendRejected' }>
  | undefined {
  if (
    !hasExactKeys(value, [
      'type',
      'sequence',
      'sessionId',
      'messageId',
      'reason',
    ]) ||
    !isSequence(value.sequence) ||
    !isId(value.sessionId) ||
    !isId(value.messageId) ||
    typeof value.reason !== 'string' ||
    !(EDIT_RESEND_REJECT_REASONS as readonly string[]).includes(
      value.reason,
    )
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

function parseWorkspaceFiles(
  value: UnknownRecord,
):
  | Extract<HostToWebviewMessage, { type: 'workspace.files' }>
  | undefined {
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

function isWorkspaceFilesStatus(
  value: unknown,
): value is WorkspaceFilesStatus {
  return (
    typeof value === 'string' &&
    (WORKSPACE_FILES_STATUSES as readonly string[]).includes(value)
  );
}

function parseWorkspaceImageData(
  value: UnknownRecord,
):
  | Extract<HostToWebviewMessage, { type: 'workspace.imageData' }>
  | undefined {
  if (
    !hasExactKeys(value, [
      'type',
      'sequence',
      'sessionId',
      'path',
      'status',
      'mediaType',
      'data',
    ]) ||
    !isSequence(value.sequence) ||
    !isId(value.sessionId) ||
    typeof value.path !== 'string' ||
    value.path.length === 0 ||
    value.path.length > MAX_IMAGE_PATH_LENGTH ||
    typeof value.status !== 'string' ||
    !(WORKSPACE_IMAGE_STATUSES as readonly string[]).includes(
      value.status,
    ) ||
    typeof value.data !== 'string' ||
    value.data.length > MAX_IMAGE_DATA_LENGTH ||
    !BASE64_PATTERN.test(value.data)
  ) {
    return undefined;
  }
  const mediaType = value.mediaType;
  if (
    mediaType !== null &&
    (typeof mediaType !== 'string' ||
      !(IMAGE_MEDIA_TYPES as readonly string[]).includes(mediaType))
  ) {
    return undefined;
  }
  // Bytes require an ok status with a concrete media type.
  if (
    value.status === 'ok' &&
    (mediaType === null || value.data.length === 0)
  ) {
    return undefined;
  }
  if (value.status !== 'ok' && value.data.length > 0) {
    return undefined;
  }
  return {
    type: 'workspace.imageData',
    sequence: value.sequence,
    sessionId: value.sessionId,
    path: value.path,
    status: value.status as WorkspaceImageStatus,
    mediaType: mediaType as ImageMediaType | null,
    data: value.data,
  };
}

function parseRewindInfo(
  value: UnknownRecord,
):
  | Extract<HostToWebviewMessage, { type: 'rewind.info' }>
  | undefined {
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
    ]) ||
    !isSequence(value.sequence) ||
    !isId(value.sessionId) ||
    !isId(value.messageId) ||
    !isCount(value.restorableCount) ||
    !isCount(value.createdCount)
  ) {
    return undefined;
  }
  const restorablePaths = parseRewindPaths(value.restorablePaths);
  const createdPaths = parseRewindPaths(value.createdPaths);
  const evictedFiles = parseRewindEvictedFiles(value.evictedFiles);
  if (restorablePaths === undefined || createdPaths === undefined ||
      evictedFiles === undefined) {
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
  };
}

function parseRewindPaths(value: unknown): string[] | undefined {
  return isExactArray(value, 0, MAX_REWIND_INFO_FILES) &&
    value.every((path) => isSafeWorkspaceRelativePath(path))
    ? (value as string[])
    : undefined;
}

function parseRewindEvictedFiles(
  value: unknown,
): RewindEvictedFile[] | undefined {
  return isExactArray(value, 0, MAX_REWIND_INFO_FILES) &&
    value.every(isRewindEvictedFile)
    ? (value as RewindEvictedFile[])
    : undefined;
}

function isRewindEvictedFile(value: unknown): value is RewindEvictedFile {
  return (
    isStrictRecord(value) &&
    hasExactKeys(value, ['path', 'reason']) &&
    isSafeWorkspaceRelativePath(value.path) &&
    typeof value.reason === 'string' &&
    value.reason.length <= MAX_REWIND_EVICTED_REASON_LENGTH
  );
}

function parseAttachmentSummary(
  value: unknown,
): AttachmentSummary | undefined {
  if (
    !isStrictRecord(value) ||
    !hasExactKeys(value, [
      'id',
      'kind',
      'name',
      'sizeBytes',
      'truncated',
    ]) ||
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

function parseSessionSkillsMessage(
  value: UnknownRecord,
): Extract<HostToWebviewMessage, { type: 'session.skills' }> | undefined {
  if (
    !hasExactKeys(value, ['type', 'sequence', 'sessionId', 'skills']) ||
    !isSequence(value.sequence) ||
    !isId(value.sessionId)
  ) {
    return undefined;
  }
  const skills = parseSessionSkills(value.skills);
  return skills === undefined
    ? undefined
    : {
        type: 'session.skills',
        sequence: value.sequence,
        sessionId: value.sessionId,
        skills,
      };
}

function parseSessionSkills(
  value: unknown,
): SessionSkillsState | undefined {
  if (!isStrictRecord(value)) {
    return undefined;
  }
  const status = readStringDataProperty(value, 'status');
  if (status === undefined) {
    return undefined;
  }

  if (status === 'unsupported') {
    if (
      !hasExactKeys(value, ['status', 'items', 'message']) ||
      !isExactArray(value.items, 0, 0) ||
      !isBoundedString(value.message, MAX_STRING_LENGTH)
    ) {
      return undefined;
    }
    return {
      status: 'unsupported',
      items: [],
      message: value.message as string,
    };
  }

  if (status !== 'loading' && status !== 'ready' && status !== 'error') {
    return undefined;
  }
  if (
    !hasExactKeys(
      value,
      status === 'error'
        ? ['status', 'items', 'message']
        : ['status', 'items'],
    ) ||
    !isExactArray(value.items, 0, MAX_SKILL_ITEMS) ||
    (status === 'error' &&
      !isBoundedString(value.message, MAX_STRING_LENGTH))
  ) {
    return undefined;
  }
  const items: SkillSummary[] = [];
  const names = new Set<string>();
  for (const itemValue of value.items) {
    const item = parseSkillSummary(itemValue);
    if (item === undefined || names.has(item.name)) {
      return undefined;
    }
    names.add(item.name);
    items.push(item);
  }
  return status === 'error'
    ? { status: 'error', items, message: value.message as string }
    : status === 'loading'
      ? { status: 'loading', items }
      : { status: 'ready', items };
}

function parseSkillSummary(value: unknown): SkillSummary | undefined {
  if (
    !isStrictRecord(value) ||
    !hasExactKeys(value, [
      'name',
      'description',
      'location',
      'enabled',
      'userInvocable',
    ]) ||
    !isNonEmptyBoundedString(value.name, MAX_SKILL_NAME_LENGTH) ||
    (value.description !== null &&
      !isNonEmptyBoundedString(
        value.description,
        MAX_SKILL_DESCRIPTION_LENGTH,
      )) ||
    !isSkillLocation(value.location) ||
    typeof value.enabled !== 'boolean' ||
    typeof value.userInvocable !== 'boolean'
  ) {
    return undefined;
  }
  return {
    name: value.name,
    description: value.description,
    location: value.location,
    enabled: value.enabled,
    userInvocable: value.userInvocable,
  };
}

function isSkillLocation(value: unknown): value is SkillLocation {
  return (
    typeof value === 'string' &&
    (SKILL_LOCATIONS as readonly string[]).includes(value)
  );
}

function parseSessionPluginsMessage(
  value: UnknownRecord,
):
  | Extract<HostToWebviewMessage, { type: 'session.plugins' }>
  | undefined {
  if (
    !hasExactKeys(value, ['type', 'sequence', 'sessionId', 'plugins']) ||
    !isSequence(value.sequence) ||
    !isId(value.sessionId)
  ) {
    return undefined;
  }
  const plugins = parseSessionPlugins(value.plugins);
  return plugins === undefined
    ? undefined
    : {
        type: 'session.plugins',
        sequence: value.sequence,
        sessionId: value.sessionId,
        plugins,
      };
}

function parseSessionPlugins(
  value: unknown,
): SessionPluginsState | undefined {
  if (!isStrictRecord(value)) {
    return undefined;
  }
  const status = readStringDataProperty(value, 'status');
  if (status === undefined) {
    return undefined;
  }

  if (status === 'unsupported') {
    if (
      !hasExactKeys(value, ['status', 'items', 'message']) ||
      !isExactArray(value.items, 0, 0) ||
      !isBoundedString(value.message, MAX_STRING_LENGTH)
    ) {
      return undefined;
    }
    return {
      status: 'unsupported',
      items: [],
      message: value.message as string,
    };
  }

  if (status !== 'loading' && status !== 'ready' && status !== 'error') {
    return undefined;
  }
  if (
    !hasExactKeys(
      value,
      status === 'error'
        ? ['status', 'items', 'message']
        : status === 'ready'
          ? ['status', 'items', 'marketplaceCount']
          : ['status', 'items'],
    ) ||
    !isExactArray(value.items, 0, MAX_PLUGIN_ITEMS) ||
    (status === 'error' &&
      !isBoundedString(value.message, MAX_STRING_LENGTH)) ||
    (status === 'ready' &&
      (!isCount(value.marketplaceCount) ||
        (value.marketplaceCount as number) >
          MAX_PLUGIN_MARKETPLACE_COUNT))
  ) {
    return undefined;
  }
  const items: PluginSummary[] = [];
  const ids = new Set<string>();
  for (const itemValue of value.items) {
    const item = parsePluginSummary(itemValue);
    if (item === undefined || ids.has(item.id)) {
      return undefined;
    }
    ids.add(item.id);
    items.push(item);
  }
  return status === 'error'
    ? { status: 'error', items, message: value.message as string }
    : status === 'loading'
      ? { status: 'loading', items }
      : {
          status: 'ready',
          items,
          marketplaceCount: value.marketplaceCount as number,
        };
}

function parsePluginSummary(value: unknown): PluginSummary | undefined {
  if (
    !isStrictRecord(value) ||
    !hasExactKeys(value, ['id', 'scope', 'version', 'active']) ||
    !isNonEmptyBoundedString(value.id, MAX_PLUGIN_ID_LENGTH) ||
    hasControlCharacter(value.id) ||
    !isPluginScope(value.scope) ||
    !isBoundedString(value.version, MAX_PLUGIN_VERSION_LENGTH) ||
    hasControlCharacter(value.version) ||
    typeof value.active !== 'boolean'
  ) {
    return undefined;
  }
  return {
    id: value.id,
    scope: value.scope,
    version: value.version as string,
    active: value.active,
  };
}

function isPluginScope(value: unknown): value is PluginScope {
  return (
    typeof value === 'string' &&
    (PLUGIN_SCOPES as readonly string[]).includes(value)
  );
}

function parseSessionCommandsMessage(
  value: UnknownRecord,
):
  | Extract<HostToWebviewMessage, { type: 'session.commands' }>
  | undefined {
  if (
    !hasExactKeys(value, ['type', 'sequence', 'sessionId', 'commands']) ||
    !isSequence(value.sequence) ||
    !isId(value.sessionId)
  ) {
    return undefined;
  }
  const commands = parseSessionCommands(value.commands);
  return commands === undefined
    ? undefined
    : {
        type: 'session.commands',
        sequence: value.sequence,
        sessionId: value.sessionId,
        commands,
      };
}

function parseSessionCommands(
  value: unknown,
): SessionCommandsState | undefined {
  if (!isStrictRecord(value)) {
    return undefined;
  }
  const status = readStringDataProperty(value, 'status');
  if (status === undefined) {
    return undefined;
  }

  if (status === 'unsupported') {
    if (
      !hasExactKeys(value, ['status', 'items', 'recent', 'message']) ||
      !isExactArray(value.items, 0, 0) ||
      !isExactArray(value.recent, 0, 0) ||
      !isBoundedString(value.message, MAX_STRING_LENGTH)
    ) {
      return undefined;
    }
    return {
      status: 'unsupported',
      items: [],
      recent: [],
      message: value.message as string,
    };
  }

  if (status !== 'loading' && status !== 'ready' && status !== 'error') {
    return undefined;
  }
  if (
    !hasExactKeys(
      value,
      status === 'error'
        ? ['status', 'items', 'recent', 'message']
        : ['status', 'items', 'recent'],
    ) ||
    !isExactArray(value.items, 0, MAX_COMMAND_ITEMS) ||
    !isExactArray(value.recent, 0, MAX_RECENT_COMMANDS) ||
    (status === 'error' &&
      !isBoundedString(value.message, MAX_STRING_LENGTH))
  ) {
    return undefined;
  }
  const items: CommandSummary[] = [];
  const names = new Set<string>();
  for (const itemValue of value.items) {
    const item = parseCommandSummary(itemValue);
    if (item === undefined || names.has(item.name)) {
      return undefined;
    }
    names.add(item.name);
    items.push(item);
  }
  const recent: string[] = [];
  const recentNames = new Set<string>();
  for (const name of value.recent) {
    if (!isSafeCommandName(name) || recentNames.has(name)) {
      return undefined;
    }
    recentNames.add(name);
    recent.push(name);
  }
  return status === 'error'
    ? { status: 'error', items, recent, message: value.message as string }
    : status === 'loading'
      ? { status: 'loading', items, recent }
      : { status: 'ready', items, recent };
}

function parseCommandSummary(
  value: unknown,
): CommandSummary | undefined {
  if (
    !isStrictRecord(value) ||
    !hasExactKeys(value, [
      'name',
      'description',
      'argumentHint',
      'isExecutable',
    ]) ||
    !isSafeCommandName(value.name) ||
    (value.description !== null &&
      !isNonEmptyBoundedString(
        value.description,
        MAX_COMMAND_DESCRIPTION_LENGTH,
      )) ||
    (value.argumentHint !== null &&
      !isNonEmptyBoundedString(
        value.argumentHint,
        MAX_COMMAND_ARGUMENT_HINT_LENGTH,
      )) ||
    typeof value.isExecutable !== 'boolean'
  ) {
    return undefined;
  }
  return {
    name: value.name,
    description: value.description,
    argumentHint: value.argumentHint,
    isExecutable: value.isExecutable,
  };
}

function parseSessionMcpMessage(
  value: UnknownRecord,
): Extract<HostToWebviewMessage, { type: 'session.mcp' }> | undefined {
  if (
    !hasExactKeys(value, ['type', 'sequence', 'sessionId', 'mcp']) ||
    !isSequence(value.sequence) ||
    !isId(value.sessionId)
  ) {
    return undefined;
  }
  const mcp = parseSessionMcp(value.mcp);
  return mcp === undefined
    ? undefined
    : {
        type: 'session.mcp',
        sequence: value.sequence,
        sessionId: value.sessionId,
        mcp,
      };
}

function parseSessionMcp(value: unknown): SessionMcpState | undefined {
  if (!isStrictRecord(value)) {
    return undefined;
  }
  const status = readStringDataProperty(value, 'status');
  if (status === undefined) {
    return undefined;
  }

  if (status === 'unsupported') {
    if (
      !hasExactKeys(value, ['status', 'items', 'message']) ||
      !isExactArray(value.items, 0, 0) ||
      !isBoundedString(value.message, MAX_STRING_LENGTH)
    ) {
      return undefined;
    }
    return {
      status: 'unsupported',
      items: [],
      message: value.message as string,
    };
  }

  if (status !== 'loading' && status !== 'ready' && status !== 'error') {
    return undefined;
  }
  if (
    !hasExactKeys(
      value,
      status === 'error'
        ? ['status', 'items', 'message']
        : ['status', 'items'],
    ) ||
    !isExactArray(value.items, 0, MAX_MCP_SERVERS) ||
    (status === 'error' &&
      !isBoundedString(value.message, MAX_STRING_LENGTH))
  ) {
    return undefined;
  }
  const items: McpServerSummary[] = [];
  const names = new Set<string>();
  for (const itemValue of value.items) {
    const item = parseMcpServerSummary(itemValue);
    if (item === undefined || names.has(item.name)) {
      return undefined;
    }
    names.add(item.name);
    items.push(item);
  }
  return status === 'error'
    ? { status: 'error', items, message: value.message as string }
    : status === 'loading'
      ? { status: 'loading', items }
      : { status: 'ready', items };
}

function parseMcpServerSummary(
  value: unknown,
): McpServerSummary | undefined {
  if (
    !isStrictRecord(value) ||
    !hasExactKeys(value, [
      'name',
      'status',
      'toolCount',
      'requiresAuth',
      'hasAuthTokens',
      'tools',
    ]) ||
    !isNonEmptyBoundedString(value.name, MAX_MCP_NAME_LENGTH) ||
    !isMcpServerStatus(value.status) ||
    (value.toolCount !== null && !isCount(value.toolCount)) ||
    typeof value.requiresAuth !== 'boolean' ||
    typeof value.hasAuthTokens !== 'boolean' ||
    !isExactArray(value.tools, 0, MAX_MCP_TOOLS_PER_SERVER)
  ) {
    return undefined;
  }
  const tools: McpToolSummary[] = [];
  const names = new Set<string>();
  for (const toolValue of value.tools) {
    const tool = parseMcpToolSummary(toolValue);
    if (tool === undefined || names.has(tool.name)) {
      return undefined;
    }
    names.add(tool.name);
    tools.push(tool);
  }
  return {
    name: value.name,
    status: value.status,
    toolCount: value.toolCount,
    requiresAuth: value.requiresAuth,
    hasAuthTokens: value.hasAuthTokens,
    tools,
  };
}

function parseMcpToolSummary(value: unknown): McpToolSummary | undefined {
  if (
    !isStrictRecord(value) ||
    !hasExactKeys(value, ['name', 'description', 'enabled', 'readOnly']) ||
    !isNonEmptyBoundedString(value.name, MAX_MCP_NAME_LENGTH) ||
    (value.description !== null &&
      !isNonEmptyBoundedString(
        value.description,
        MAX_MCP_TOOL_DESCRIPTION_LENGTH,
      )) ||
    typeof value.enabled !== 'boolean' ||
    typeof value.readOnly !== 'boolean'
  ) {
    return undefined;
  }
  return {
    name: value.name,
    description: value.description,
    enabled: value.enabled,
    readOnly: value.readOnly,
  };
}

function isMcpServerStatus(value: unknown): value is McpServerStatus {
  return (
    typeof value === 'string' &&
    (MCP_SERVER_STATUSES as readonly string[]).includes(value)
  );
}

function parseMcpAuth(
  value: UnknownRecord,
): Extract<HostToWebviewMessage, { type: 'mcp.auth' }> | undefined {
  if (
    !hasExactKeys(value, [
      'type',
      'sequence',
      'sessionId',
      'serverName',
      'phase',
      'message',
    ]) ||
    !isSequence(value.sequence) ||
    !isId(value.sessionId) ||
    !isNonEmptyBoundedString(value.serverName, MAX_MCP_NAME_LENGTH) ||
    !isMcpAuthPhase(value.phase) ||
    (value.message !== null &&
      !isNonEmptyBoundedString(
        value.message,
        MAX_MCP_AUTH_MESSAGE_LENGTH,
      ))
  ) {
    return undefined;
  }
  return {
    type: 'mcp.auth',
    sequence: value.sequence,
    sessionId: value.sessionId,
    serverName: value.serverName,
    phase: value.phase,
    message: value.message,
  };
}

function isMcpAuthPhase(value: unknown): value is McpAuthPhase {
  return (
    typeof value === 'string' &&
    (MCP_AUTH_PHASES as readonly string[]).includes(value)
  );
}

function isCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function parseModelCatalogItem(
  value: unknown,
): ModelCatalogItem | undefined {
  if (
    !isStrictRecord(value) ||
    !hasExactKeys(value, [
      'id',
      'displayName',
      'supportedReasoningEfforts',
    ]) ||
    !isSafeModelId(value.id) ||
    !isSafeDisplayName(value.displayName) ||
    !isExactArray(
      value.supportedReasoningEfforts,
      1,
      SESSION_REASONING_EFFORTS.length,
    )
  ) {
    return undefined;
  }
  const efforts: SessionReasoningEffort[] = [];
  const seen = new Set<SessionReasoningEffort>();
  for (const effort of value.supportedReasoningEfforts) {
    if (!isSessionReasoningEffort(effort) || seen.has(effort)) {
      return undefined;
    }
    seen.add(effort);
    efforts.push(effort);
  }
  return {
    id: value.id,
    displayName: value.displayName,
    supportedReasoningEfforts: efforts,
  };
}

function parseSessionCatalog(
  value: unknown,
  activeSessionId: string | null,
  allowPendingActive: boolean,
): SessionCatalogState | undefined {
  if (
    !isStrictRecord(value) ||
    !hasExactKeys(value, ['status', 'items'], ['message']) ||
    !isSessionCatalogStatus(value.status) ||
    !isExactArray(value.items, 0, MAX_SESSION_CATALOG_ITEMS) ||
    (value.message !== undefined &&
      !isBoundedString(value.message, MAX_STRING_LENGTH))
  ) {
    return undefined;
  }

  const items: SessionSummary[] = [];
  const ids = new Set<string>();
  let activeItemId: string | null = null;
  for (const itemValue of value.items) {
    const item = parseSessionSummary(itemValue);
    if (
      item === undefined ||
      ids.has(item.id) ||
      (item.active && activeItemId !== null)
    ) {
      return undefined;
    }
    ids.add(item.id);
    if (item.active) {
      activeItemId = item.id;
    }
    items.push(item);
  }

  if (
    activeItemId !== activeSessionId &&
    !(
      allowPendingActive &&
      activeItemId === null &&
      activeSessionId !== null
    )
  ) {
    return undefined;
  }

  return value.message === undefined
    ? { status: value.status, items }
    : { status: value.status, items, message: value.message };
}

function parseSessionSummary(value: unknown): SessionSummary | undefined {
  if (
    !isStrictRecord(value) ||
    !hasExactKeys(
      value,
      ['id', 'title', 'messageCount', 'modifiedTime', 'active'],
      ['isFavorite', 'missionRole', 'worktree', 'running'],
    ) ||
    !isId(value.id) ||
    !isBoundedString(value.title, MAX_SESSION_TITLE_LENGTH) ||
    hasControlCharacter(value.title) ||
    !isSequence(value.messageCount) ||
    !isIsoDate(value.modifiedTime) ||
    typeof value.active !== 'boolean' ||
    (value.isFavorite !== undefined &&
      typeof value.isFavorite !== 'boolean') ||
    (value.missionRole !== undefined &&
      !isMissionSessionRole(value.missionRole)) ||
    // Hosts omit the flag instead of sending false.
    (value.running !== undefined && value.running !== true)
  ) {
    return undefined;
  }
  const worktree =
    value.worktree === undefined
      ? undefined
      : parseSessionWorktree(value.worktree);
  if (value.worktree !== undefined && worktree === undefined) {
    return undefined;
  }

  return {
    id: value.id,
    title: value.title,
    messageCount: value.messageCount,
    modifiedTime: value.modifiedTime,
    active: value.active,
    isFavorite: value.isFavorite === true,
    ...(value.missionRole === undefined
      ? {}
      : { missionRole: value.missionRole }),
    ...(worktree === undefined ? {} : { worktree }),
    ...(value.running === true ? { running: true } : {}),
  };
}

function parseSessionWorktree(
  value: unknown,
): SessionWorktreeInfo | undefined {
  if (
    !isStrictRecord(value) ||
    !hasExactKeys(value, ['branch', 'path']) ||
    // Branch may be '' (host-side git recovery failed); the path is
    // the worktree identity and must be present.
    !isBoundedString(value.branch, MAX_WORKTREE_BRANCH_LENGTH) ||
    hasControlCharacter(value.branch) ||
    !isNonEmptyBoundedString(value.path, MAX_WORKTREE_PATH_LENGTH) ||
    hasControlCharacter(value.path)
  ) {
    return undefined;
  }
  return { branch: value.branch, path: value.path };
}

function parseSessionArchivedMessage(
  value: UnknownRecord,
):
  | Extract<HostToWebviewMessage, { type: 'session.archived' }>
  | undefined {
  if (
    !hasExactKeys(value, ['type', 'sequence', 'archived']) ||
    !isSequence(value.sequence)
  ) {
    return undefined;
  }
  const archived = parseSessionArchivedState(value.archived);
  return archived === undefined
    ? undefined
    : {
        type: 'session.archived',
        sequence: value.sequence,
        archived,
      };
}

function parseSessionRunningMessage(
  value: UnknownRecord,
):
  | Extract<HostToWebviewMessage, { type: 'session.running' }>
  | undefined {
  if (
    !hasExactKeys(value, [
      'type',
      'sequence',
      'sessionId',
      'running',
    ]) ||
    !isSequence(value.sequence) ||
    !isId(value.sessionId) ||
    typeof value.running !== 'boolean'
  ) {
    return undefined;
  }
  return {
    type: 'session.running',
    sequence: value.sequence,
    sessionId: value.sessionId,
    running: value.running,
  };
}

function parseSessionArchivedState(
  value: unknown,
): SessionArchivedState | undefined {
  if (!isStrictRecord(value)) {
    return undefined;
  }
  const status = readStringDataProperty(value, 'status');
  if (
    status !== 'loading' &&
    status !== 'ready' &&
    status !== 'error'
  ) {
    return undefined;
  }
  if (
    !hasExactKeys(
      value,
      status === 'error'
        ? ['status', 'items', 'message']
        : ['status', 'items'],
    ) ||
    !isExactArray(value.items, 0, MAX_ARCHIVED_SESSION_ITEMS) ||
    (status === 'error' &&
      !isBoundedString(value.message, MAX_STRING_LENGTH))
  ) {
    return undefined;
  }
  const items: ArchivedSessionSummary[] = [];
  const ids = new Set<string>();
  for (const itemValue of value.items) {
    const item = parseArchivedSessionSummary(itemValue);
    if (item === undefined || ids.has(item.id)) {
      return undefined;
    }
    ids.add(item.id);
    items.push(item);
  }
  return status === 'error'
    ? { status: 'error', items, message: value.message as string }
    : status === 'loading'
      ? { status: 'loading', items }
      : { status: 'ready', items };
}

function parseArchivedSessionSummary(
  value: unknown,
): ArchivedSessionSummary | undefined {
  if (
    !isStrictRecord(value) ||
    !hasExactKeys(value, [
      'id',
      'title',
      'modifiedTime',
      'archivedTime',
    ]) ||
    !isId(value.id) ||
    !isBoundedString(value.title, MAX_SESSION_TITLE_LENGTH) ||
    hasControlCharacter(value.title) ||
    !isIsoDate(value.modifiedTime) ||
    !isIsoDate(value.archivedTime)
  ) {
    return undefined;
  }
  return {
    id: value.id,
    title: value.title,
    modifiedTime: value.modifiedTime,
    archivedTime: value.archivedTime,
  };
}

function parseSessionSearchMessage(
  value: UnknownRecord,
):
  | Extract<HostToWebviewMessage, { type: 'session.searchResults' }>
  | undefined {
  if (
    !hasExactKeys(value, ['type', 'sequence', 'search']) ||
    !isSequence(value.sequence)
  ) {
    return undefined;
  }
  const search = parseSessionSearchState(value.search);
  return search === undefined
    ? undefined
    : {
        type: 'session.searchResults',
        sequence: value.sequence,
        search,
      };
}

function parseSessionSearchState(
  value: unknown,
): SessionSearchState | undefined {
  if (!isStrictRecord(value)) {
    return undefined;
  }
  const status = readStringDataProperty(value, 'status');
  if (status !== 'ready' && status !== 'error') {
    return undefined;
  }
  const query = readStringDataProperty(value, 'query');
  if (
    query === undefined ||
    query.length === 0 ||
    query.length > MAX_SESSION_SEARCH_QUERY_LENGTH ||
    hasControlCharacter(query)
  ) {
    return undefined;
  }

  if (status === 'error') {
    if (
      !hasExactKeys(value, ['status', 'query', 'items', 'message']) ||
      !isExactArray(value.items, 0, 0) ||
      !isBoundedString(value.message, MAX_STRING_LENGTH)
    ) {
      return undefined;
    }
    return {
      status: 'error',
      query,
      items: [],
      message: value.message as string,
    };
  }

  if (
    !hasExactKeys(value, ['status', 'query', 'items']) ||
    !isExactArray(value.items, 0, MAX_SESSION_SEARCH_RESULTS)
  ) {
    return undefined;
  }
  const items: SessionSearchHit[] = [];
  const ids = new Set<string>();
  for (const itemValue of value.items) {
    const item = parseSessionSearchHit(itemValue);
    if (item === undefined || ids.has(item.id)) {
      return undefined;
    }
    ids.add(item.id);
    items.push(item);
  }
  return { status: 'ready', query, items };
}

function parseSessionSearchHit(
  value: unknown,
): SessionSearchHit | undefined {
  if (
    !isStrictRecord(value) ||
    !hasExactKeys(value, [
      'id',
      'title',
      'modifiedTime',
      'snippet',
    ]) ||
    !isId(value.id) ||
    !isBoundedString(value.title, MAX_SESSION_TITLE_LENGTH) ||
    hasControlCharacter(value.title) ||
    (value.modifiedTime !== null && !isIsoDate(value.modifiedTime)) ||
    (value.snippet !== null &&
      (!isNonEmptyBoundedString(
        value.snippet,
        MAX_SESSION_SEARCH_SNIPPET_LENGTH,
      ) ||
        hasControlCharacter(value.snippet)))
  ) {
    return undefined;
  }
  return {
    id: value.id,
    title: value.title,
    modifiedTime: value.modifiedTime,
    snippet: value.snippet,
  };
}

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
  return transcriptTextUnits(items) <=
    MAX_SESSION_TRANSCRIPT_TEXT_UNITS &&
    transcriptImageDataUnits(items) <= MAX_SESSION_IMAGE_DATA_UNITS
    ? items
    : undefined;
}

function parseSessionTranscriptItem(
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

function parseChangesTranscriptItem(
  value: UnknownRecord,
): Extract<SessionTranscriptItem, { kind: 'changes' }> | undefined {
  if (
    !hasExactKeys(value, ['id', 'kind', 'turnId', 'files']) ||
    !isId(value.id) ||
    !isId(value.turnId)
  ) {
    return undefined;
  }
  const files = parseChangedFiles(value.files);
  return files === undefined
    ? undefined
    : {
        id: value.id,
        kind: 'changes',
        turnId: value.turnId,
        files,
      };
}

function parseUserTranscriptItem(
  value: UnknownRecord,
): Extract<SessionTranscriptItem, { kind: 'user' }> | undefined {
  if (
    !hasExactKeys(
      value,
      ['id', 'kind', 'text'],
      ['messageId', 'attachments'],
    ) ||
    !isId(value.id) ||
    !isBoundedString(value.text, MAX_TURN_TEXT_LENGTH) ||
    (value.messageId !== undefined && !isId(value.messageId))
  ) {
    return undefined;
  }
  let attachments: SentAttachmentSummary[] | undefined;
  if (value.attachments !== undefined) {
    if (
      !isExactArray(value.attachments, 0, MAX_PENDING_ATTACHMENTS)
    ) {
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
    ...(value.messageId === undefined
      ? {}
      : { messageId: value.messageId }),
    ...(attachments === undefined ? {} : { attachments }),
  };
}

function parseSentAttachmentSummary(
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

function parseAssistantTranscriptItem(
  value: UnknownRecord,
): Extract<SessionTranscriptItem, { kind: 'assistant' }> | undefined {
  if (
    !hasExactKeys(value, ['id', 'kind', 'turnId', 'text']) ||
    !isId(value.id) ||
    !isId(value.turnId) ||
    !isBoundedString(value.text, MAX_ASSISTANT_TEXT_LENGTH)
  ) {
    return undefined;
  }

  return {
    id: value.id,
    kind: 'assistant',
    turnId: value.turnId,
    text: value.text,
  };
}

function parseThinkingTranscriptItem(
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
    ...(value.durationMs === undefined
      ? {}
      : { durationMs: value.durationMs }),
    truncated: value.truncated,
  };
}

function parseToolTranscriptItem(
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
        'backgroundHint',
        'subagent',
      ],
    ) ||
    !isId(value.id) ||
    !isId(value.turnId) ||
    !isId(value.toolUseId) ||
    !isNonEmptyBoundedString(value.toolName, MAX_TOOL_NAME_LENGTH) ||
    !isNonEmptyBoundedString(
      value.action,
      MAX_TOOL_ACTION_SUMMARY_LENGTH,
    ) ||
    !isTranscriptToolStatus(value.status) ||
    !isBoundedToolProgressCount(value.progressCount) ||
    !isNullableToolActivityUpdateKind(value.latestUpdateKind) ||
    !hasConsistentToolProgress(
      value.progressCount,
      value.latestUpdateKind,
    ) ||
    (value.durationMs !== undefined && !isSequence(value.durationMs)) ||
    (value.filePath !== undefined &&
      !isSafeWorkspaceRelativePath(value.filePath)) ||
    !hasValidAdditionalFileCount(value) ||
    !hasValidToolDetail(value) ||
    !isValidToolTarget(value.target) ||
    !hasValidToolErrorMessage(value) ||
    !hasValidToolOutputTail(value)
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
    value.subagent === undefined
      ? undefined
      : parseToolSubagent(value.subagent);
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
    ...(value.durationMs === undefined
      ? {}
      : { durationMs: value.durationMs }),
    ...(value.filePath === undefined
      ? {}
      : { filePath: value.filePath }),
    ...(value.additionalFileCount === undefined
      ? {}
      : { additionalFileCount: value.additionalFileCount as number }),
    ...(value.detailKind === undefined
      ? {}
      : {
          detailKind: value.detailKind as ToolDetailKind,
          detail: value.detail as string,
        }),
    ...(value.target === undefined ? {} : { target: value.target as string }),
    ...(value.errorMessage === undefined
      ? {}
      : { errorMessage: value.errorMessage as string }),
    ...(value.outputTail === undefined
      ? {}
      : { outputTail: value.outputTail as string }),
    ...(backgroundHint === undefined ? {} : { backgroundHint }),
    ...(subagent === undefined ? {} : { subagent }),
  };
}

function parseDiagnosticTranscriptItem(
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
    (value.relatedSessionId !== undefined &&
      !isId(value.relatedSessionId))
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

function parseConnection(value: unknown): ConnectionState | undefined {
  if (
    !isStrictRecord(value) ||
    !hasExactKeys(value, ['status'], ['message']) ||
    !isConnectionStatus(value.status) ||
    (value.message !== undefined &&
      !isBoundedString(value.message, MAX_STRING_LENGTH))
  ) {
    return undefined;
  }

  return value.message === undefined
    ? { status: value.status }
    : { status: value.status, message: value.message };
}

function parseSnapshotTurn(
  value: unknown,
):
  | {
      readonly turnId: string;
      readonly status: TurnStatus;
      readonly error?: string;
    }
  | null
  | undefined {
  if (value === null) {
    return null;
  }
  if (
    !isStrictRecord(value) ||
    !hasExactKeys(value, ['turnId', 'status'], ['error']) ||
    !isId(value.turnId) ||
    !isTurnStatus(value.status) ||
    (value.error !== undefined &&
      !isBoundedString(value.error, MAX_STRING_LENGTH))
  ) {
    return undefined;
  }

  return value.error === undefined
    ? { turnId: value.turnId, status: value.status }
    : { turnId: value.turnId, status: value.status, error: value.error };
}

function hasTurnIdentity(
  value: UnknownRecord,
): value is UnknownRecord & {
  sequence: number;
  sessionId: string;
  turnId: string;
} {
  return (
    isSequence(value.sequence) &&
    isId(value.sessionId) &&
    isId(value.turnId)
  );
}

function isSequence(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function hasValidAdditionalFileCount(value: UnknownRecord): boolean {
  return (
    value.additionalFileCount === undefined ||
    (value.filePath !== undefined &&
      isSequence(value.additionalFileCount) &&
      value.additionalFileCount > 0 &&
      value.additionalFileCount < MAX_CHANGED_FILES_PER_TURN)
  );
}

function readStringDataProperty(
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

function isNullableId(value: unknown): value is string | null {
  return value === null || isId(value);
}

function isId(value: unknown): value is string {
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

function isConnectionStatus(
  value: unknown,
): value is ConnectionState['status'] {
  return (
    typeof value === 'string' &&
    CONNECTION_STATUS_SET.has(value as ConnectionState['status'])
  );
}

function isTurnStatus(value: unknown): value is TurnStatus {
  return typeof value === 'string' && TURN_STATUS_SET.has(value as TurnStatus);
}

function isToolActivityStatus(
  value: unknown,
): value is ToolActivityMessage['status'] {
  return (
    typeof value === 'string' &&
    TOOL_ACTIVITY_STATUS_SET.has(
      value as ToolActivityMessage['status'],
    )
  );
}

/**
 * A tool detail is valid when absent entirely or when the kind and the
 * bounded non-empty text are both present.
 */
function hasValidToolDetail(value: UnknownRecord): boolean {
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

/** Optional failed tool_result excerpt; bounded non-empty when set. */
function hasValidToolErrorMessage(value: UnknownRecord): boolean {
  return (
    value['errorMessage'] === undefined ||
    isNonEmptyBoundedString(
      value['errorMessage'],
      MAX_TOOL_ERROR_MESSAGE_LENGTH,
    )
  );
}

/** Optional execute output tail; bounded non-empty when set. */
function hasValidToolOutputTail(value: UnknownRecord): boolean {
  return (
    value['outputTail'] === undefined ||
    isNonEmptyBoundedString(
      value['outputTail'],
      MAX_TOOL_OUTPUT_TAIL_LENGTH,
    )
  );
}

function isBoundedToolProgressCount(value: unknown): value is number {
  return (
    isSequence(value) &&
    value <= MAX_TOOL_PROGRESS_UPDATES_PER_TOOL
  );
}

function isNullableToolActivityUpdateKind(
  value: unknown,
): value is ToolActivityUpdateKind | null {
  return (
    value === null ||
    (typeof value === 'string' &&
      TOOL_ACTIVITY_UPDATE_KIND_SET.has(
        value as ToolActivityUpdateKind,
      ))
  );
}

function hasConsistentToolProgress(
  progressCount: unknown,
  latestUpdateKind: unknown,
): boolean {
  return (
    (progressCount === 0 && latestUpdateKind === null) ||
    (typeof progressCount === 'number' &&
      progressCount > 0 &&
      latestUpdateKind !== null)
  );
}

function isDiagnosticSeverity(
  value: unknown,
): value is DiagnosticSeverity {
  return (
    typeof value === 'string' &&
    DIAGNOSTIC_SEVERITY_SET.has(value as DiagnosticSeverity)
  );
}

function isPermissionConfirmationKind(
  value: unknown,
): value is PermissionConfirmationKind {
  return (
    typeof value === 'string' &&
    PERMISSION_CONFIRMATION_KIND_SET.has(
      value as PermissionConfirmationKind,
    )
  );
}

function isSessionInteractionMode(
  value: unknown,
): value is SessionInteractionMode {
  return (
    typeof value === 'string' &&
    SESSION_INTERACTION_MODE_SET.has(value as SessionInteractionMode)
  );
}

function isSessionAutonomyLevel(
  value: unknown,
): value is SessionAutonomyLevel {
  return (
    typeof value === 'string' &&
    SESSION_AUTONOMY_LEVEL_SET.has(value as SessionAutonomyLevel)
  );
}

function isSessionReasoningEffort(
  value: unknown,
): value is SessionReasoningEffort {
  return (
    typeof value === 'string' &&
    SESSION_REASONING_EFFORT_SET.has(value as SessionReasoningEffort)
  );
}

function isSessionCatalogStatus(
  value: unknown,
): value is SessionCatalogStatus {
  return (
    typeof value === 'string' &&
    SESSION_CATALOG_STATUS_SET.has(value as SessionCatalogStatus)
  );
}

function isSessionHistoryStatus(
  value: unknown,
): value is SessionHistoryStatus {
  return (
    typeof value === 'string' &&
    SESSION_HISTORY_STATUS_SET.has(value as SessionHistoryStatus)
  );
}

function isTranscriptThinkingStatus(
  value: unknown,
): value is TranscriptThinkingStatus {
  return (
    typeof value === 'string' &&
    TRANSCRIPT_THINKING_STATUS_SET.has(value as TranscriptThinkingStatus)
  );
}

function isTranscriptToolStatus(
  value: unknown,
): value is TranscriptToolStatus {
  return (
    typeof value === 'string' &&
    TRANSCRIPT_TOOL_STATUS_SET.has(value as TranscriptToolStatus)
  );
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false;
  }

  const timestamp = Date.parse(value);
  return (
    Number.isFinite(timestamp) &&
    new Date(timestamp).toISOString() === value
  );
}

function hasControlCharacter(value: string): boolean {
  return /[\u0000-\u001f\u007f-\u009f]/u.test(value);
}
