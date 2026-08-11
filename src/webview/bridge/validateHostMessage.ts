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
  MAX_INTERACTION_TITLE_LENGTH,
  MAX_MODEL_CATALOG_ITEMS,
  MAX_MODEL_DISPLAY_NAME_LENGTH,
  MAX_MODEL_ID_LENGTH,
  MAX_PERMISSION_OPTIONS,
  MAX_PERMISSION_OPTION_LABEL_LENGTH,
  MAX_PERMISSION_OPTION_VALUE_LENGTH,
  MAX_PERMISSION_RISK_NOTE_LENGTH,
  MAX_PERMISSION_TOOLS,
  MAX_PERMISSION_TOOL_NAME_LENGTH,
  MAX_SESSION_CATALOG_ITEMS,
  MAX_SESSION_TITLE_LENGTH,
  MAX_SESSION_TRANSCRIPT_ITEMS,
  MAX_MCP_NAME_LENGTH,
  MAX_MCP_SERVERS,
  MAX_MCP_TOOLS_PER_SERVER,
  MAX_MCP_TOOL_DESCRIPTION_LENGTH,
  MAX_SKILL_DESCRIPTION_LENGTH,
  MAX_SKILL_ITEMS,
  MAX_SKILL_NAME_LENGTH,
  MCP_SERVER_STATUSES,
  MAX_THINKING_TEXT_LENGTH,
  MAX_TOOL_ACTION_SUMMARY_LENGTH,
  MAX_TOOL_NAME_LENGTH,
  MAX_TOOL_PROGRESS_UPDATES_PER_TOOL,
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
  MAX_ATTACHMENT_NAME_LENGTH,
  MAX_CHANGED_FILES_PER_TURN,
  MAX_FILE_SEARCH_RESULTS,
  MAX_PENDING_ATTACHMENTS,
  SKILL_LOCATIONS,
  TRANSCRIPT_THINKING_STATUSES,
  TRANSCRIPT_TOOL_STATUSES,
  TURN_STATUSES,
  type AskUserInteractionRequest,
  type AskUserQuestion,
  type AttachmentKind,
  type AttachmentSummary,
  type ChangedFileSummary,
  type ConnectionState,
  type DiagnosticSeverity,
  type HostToWebviewMessage,
  type InteractionRequest,
  type PermissionConfirmationKind,
  type PermissionInteractionRequest,
  type PermissionOption,
  type PermissionToolSummary,
  type ModelCatalogItem,
  type ModelCatalogState,
  type SessionAutonomyLevel,
  type SessionCatalogState,
  type SessionCatalogStatus,
  type SessionContextState,
  type SessionInteractionMode,
  type SessionReasoningEffort,
  type SessionSettingsState,
  type McpServerStatus,
  type McpServerSummary,
  type McpToolSummary,
  type SessionMcpState,
  type SessionSkillsState,
  type SkillLocation,
  type SkillSummary,
  type SessionHistoryStatus,
  type SessionSummary,
  type SessionTranscriptItem,
  type ToolActivityMessage,
  type ToolActivityUpdateKind,
  type TranscriptThinkingStatus,
  type TranscriptToolStatus,
  type TurnStatus,
} from '../../shared/bridgeMessages';
import {
  hasExactKeys,
  isExactArray,
  isStrictRecord,
  type UnknownRecord,
} from '../../shared/strictValidation';
import { isSafeWorkspaceRelativePath } from '../../shared/validateMessage';
import {
  MAX_SESSION_TRANSCRIPT_TEXT_UNITS,
  transcriptTextUnits,
} from '../../shared/transcriptLimits';

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
      case 'session.model-catalog':
        return parseModelCatalogMessage(value);
      case 'session.skills':
        return parseSessionSkillsMessage(value);
      case 'session.mcp':
        return parseSessionMcpMessage(value);
      case 'session.attachments':
        return parseSessionAttachmentsMessage(value);
      case 'workspace.files':
        return parseWorkspaceFiles(value);
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
      case 'turn.changes':
        return parseTurnChanges(value);
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
        return parseInteractionClosed(value);
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
    !hasExactKeys(value, [
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
    ]) ||
    !isSequence(value.sequence) ||
    !isNullableId(value.sessionId) ||
    !isSessionHistoryStatus(value.historyStatus) ||
    typeof value.truncated !== 'boolean'
  ) {
    return undefined;
  }

  const connection = parseConnection(value.connection);
  const turn = parseSnapshotTurn(value.turn);
  const sessions = parseSessionCatalog(value.sessions, value.sessionId);
  const settings = parseSessionSettings(value.settings);
  const context = parseSessionContext(value.context);
  const modelCatalog = parseModelCatalog(value.modelCatalog);
  const transcript = parseSessionTranscript(value.transcript);
  if (
    connection === undefined ||
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
  };
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
    ]) ||
    !hasTurnIdentity(value) ||
    !isBoundedString(value.delta, MAX_THINKING_TEXT_LENGTH) ||
    typeof value.truncated !== 'boolean'
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
    ]) ||
    !hasTurnIdentity(value) ||
    (value.durationMs !== null && !isSequence(value.durationMs))
  ) {
    return undefined;
  }

  return {
    type: 'thinking.complete',
    sequence: value.sequence,
    sessionId: value.sessionId,
    turnId: value.turnId,
    durationMs: value.durationMs,
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
      ['durationMs', 'filePath'],
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
      !isSafeWorkspaceRelativePath(value.filePath))
  ) {
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
  };
}

function parseTurnChanges(
  value: UnknownRecord,
): Extract<HostToWebviewMessage, { type: 'turn.changes' }> | undefined {
  if (
    !hasExactKeys(value, [
      'type',
      'sequence',
      'sessionId',
      'turnId',
      'files',
    ]) ||
    !hasTurnIdentity(value)
  ) {
    return undefined;
  }
  const files = parseChangedFiles(value.files);
  if (files === undefined) {
    return undefined;
  }

  return {
    type: 'turn.changes',
    sequence: value.sequence,
    sessionId: value.sessionId,
    turnId: value.turnId,
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

function parseRuntimeDiagnostic(
  value: UnknownRecord,
): Extract<HostToWebviewMessage, { type: 'runtime.diagnostic' }> | undefined {
  if (
    !hasExactKeys(value, [
      'type',
      'sequence',
      'sessionId',
      'turnId',
      'severity',
      'code',
      'message',
    ]) ||
    !isSequence(value.sequence) ||
    !isNullableId(value.sessionId) ||
    !isNullableId(value.turnId) ||
    !isDiagnosticSeverity(value.severity) ||
    !isBoundedString(value.code, MAX_STRING_LENGTH) ||
    !isBoundedString(value.message, MAX_STRING_LENGTH)
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

function parseInteractionClosed(
  value: UnknownRecord,
):
  | Extract<HostToWebviewMessage, { type: 'interaction.closed' }>
  | undefined {
  if (
    !hasExactKeys(value, [
      'type',
      'sequence',
      'sessionId',
      'turnId',
      'requestId',
    ]) ||
    !hasTurnIdentity(value) ||
    !isId(value.requestId)
  ) {
    return undefined;
  }

  return {
    type: 'interaction.closed',
    sequence: value.sequence,
    sessionId: value.sessionId,
    turnId: value.turnId,
    requestId: value.requestId,
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
    (value.detail !== undefined &&
      !isBoundedString(value.detail, MAX_INTERACTION_DETAIL_LENGTH)) ||
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
    ]) ||
    !isSessionInteractionMode(value.interactionMode) ||
    !isSafeModelId(value.modelId) ||
    !isSessionReasoningEffort(value.reasoningEffort) ||
    !isSessionAutonomyLevel(value.autonomyLevel)
  ) {
    return undefined;
  }
  return {
    interactionMode: value.interactionMode,
    modelId: value.modelId,
    reasoningEffort: value.reasoningEffort,
    autonomyLevel: value.autonomyLevel,
  };
}

function parseSessionContext(
  value: unknown,
): SessionContextState | undefined {
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
    const context =
      value.value === null ? null : parseContextStats(value.value);
    return context === undefined
      ? undefined
      : { status: 'error', value: context, message: value.message };
  }
  if (
    (status !== 'loading' && status !== 'ready') ||
    !hasExactKeys(value, ['status', 'value'])
  ) {
    return undefined;
  }
  const context =
    value.value === null ? null : parseContextStats(value.value);
  if (
    context === undefined ||
    (status === 'ready' && context === null)
  ) {
    return undefined;
  }
  if (status === 'loading') {
    return { status: 'loading', value: context };
  }
  return context === null
    ? undefined
    : { status: 'ready', value: context };
}

function parseContextStats(
  value: unknown,
): Exclude<SessionContextState['value'], null> | undefined {
  if (
    !isStrictRecord(value) ||
    !hasExactKeys(value, ['used', 'remaining', 'limit', 'accuracy']) ||
    !isContextNumber(value.used) ||
    !isContextNumber(value.remaining) ||
    !isContextNumber(value.limit) ||
    (value.accuracy !== 'exact' && value.accuracy !== 'estimated')
  ) {
    return undefined;
  }
  return {
    used: value.used,
    remaining: value.remaining,
    limit: value.limit,
    accuracy: value.accuracy,
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
      'files',
    ]) ||
    !isSequence(value.sequence) ||
    !isId(value.sessionId) ||
    !isId(value.requestId) ||
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
    files,
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
    ]) ||
    !isSequence(value.sequence) ||
    !isId(value.sessionId) ||
    !isId(value.messageId) ||
    !isCount(value.restorableCount) ||
    !isCount(value.createdCount)
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
  };
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
      'tools',
    ]) ||
    !isNonEmptyBoundedString(value.name, MAX_MCP_NAME_LENGTH) ||
    !isMcpServerStatus(value.status) ||
    (value.toolCount !== null && !isCount(value.toolCount)) ||
    typeof value.requiresAuth !== 'boolean' ||
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

  if (activeItemId !== activeSessionId) {
    return undefined;
  }

  return value.message === undefined
    ? { status: value.status, items }
    : { status: value.status, items, message: value.message };
}

function parseSessionSummary(value: unknown): SessionSummary | undefined {
  if (
    !isStrictRecord(value) ||
    !hasExactKeys(value, [
      'id',
      'title',
      'messageCount',
      'modifiedTime',
      'active',
    ]) ||
    !isId(value.id) ||
    !isBoundedString(value.title, MAX_SESSION_TITLE_LENGTH) ||
    hasControlCharacter(value.title) ||
    !isSequence(value.messageCount) ||
    !isIsoDate(value.modifiedTime) ||
    typeof value.active !== 'boolean'
  ) {
    return undefined;
  }

  return {
    id: value.id,
    title: value.title,
    messageCount: value.messageCount,
    modifiedTime: value.modifiedTime,
    active: value.active,
  };
}

function parseSessionTranscript(
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
    MAX_SESSION_TRANSCRIPT_TEXT_UNITS
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
    case 'diagnostic':
      return parseDiagnosticTranscriptItem(value);
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
    !hasExactKeys(value, ['id', 'kind', 'text'], ['messageId']) ||
    !isId(value.id) ||
    !isBoundedString(value.text, MAX_TURN_TEXT_LENGTH) ||
    (value.messageId !== undefined && !isId(value.messageId))
  ) {
    return undefined;
  }

  return {
    id: value.id,
    kind: 'user',
    text: value.text,
    ...(value.messageId === undefined
      ? {}
      : { messageId: value.messageId }),
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
      ['durationMs', 'filePath'],
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
      !isSafeWorkspaceRelativePath(value.filePath))
  ) {
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
  };
}

function parseDiagnosticTranscriptItem(
  value: UnknownRecord,
): Extract<SessionTranscriptItem, { kind: 'diagnostic' }> | undefined {
  if (
    !hasExactKeys(value, [
      'id',
      'kind',
      'turnId',
      'severity',
      'code',
      'message',
    ]) ||
    !isId(value.id) ||
    !isNullableId(value.turnId) ||
    !isDiagnosticSeverity(value.severity) ||
    !isBoundedString(value.code, MAX_STRING_LENGTH) ||
    !isBoundedString(value.message, MAX_STRING_LENGTH)
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

function isContextNumber(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isSafeModelId(value: unknown): value is string {
  return (
    isNonEmptyBoundedString(value, MAX_MODEL_ID_LENGTH) &&
    value.trim() === value &&
    !hasControlCharacter(value)
  );
}

function isSafeDisplayName(value: unknown): value is string {
  return (
    isNonEmptyBoundedString(value, MAX_MODEL_DISPLAY_NAME_LENGTH) &&
    value.trim() === value &&
    !hasControlCharacter(value)
  );
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
