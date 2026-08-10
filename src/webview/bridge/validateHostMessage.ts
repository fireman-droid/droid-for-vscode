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
  MAX_PERMISSION_OPTIONS,
  MAX_PERMISSION_OPTION_LABEL_LENGTH,
  MAX_PERMISSION_OPTION_VALUE_LENGTH,
  MAX_PERMISSION_RISK_NOTE_LENGTH,
  MAX_PERMISSION_TOOLS,
  MAX_PERMISSION_TOOL_NAME_LENGTH,
  MAX_SESSION_CATALOG_ITEMS,
  MAX_SESSION_TITLE_LENGTH,
  MAX_SESSION_TRANSCRIPT_ITEMS,
  MAX_THINKING_TEXT_LENGTH,
  MAX_TOOL_NAME_LENGTH,
  MAX_TURN_TEXT_LENGTH,
  PERMISSION_CONFIRMATION_KINDS,
  SESSION_CATALOG_STATUSES,
  SESSION_HISTORY_STATUSES,
  TOOL_ACTIVITY_STATUSES,
  TRANSCRIPT_THINKING_STATUSES,
  TRANSCRIPT_TOOL_STATUSES,
  TURN_STATUSES,
  type AskUserInteractionRequest,
  type AskUserQuestion,
  type ConnectionState,
  type DiagnosticSeverity,
  type HostToWebviewMessage,
  type InteractionRequest,
  type PermissionConfirmationKind,
  type PermissionInteractionRequest,
  type PermissionOption,
  type PermissionToolSummary,
  type SessionCatalogState,
  type SessionCatalogStatus,
  type SessionHistoryStatus,
  type SessionSummary,
  type SessionTranscriptItem,
  type ToolActivityMessage,
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

const MAX_STRING_LENGTH = MAX_TURN_TEXT_LENGTH;
const CONNECTION_STATUS_SET = new Set<ConnectionState['status']>(
  CONNECTION_STATUSES,
);
const TURN_STATUS_SET = new Set<TurnStatus>(TURN_STATUSES);
const TOOL_ACTIVITY_STATUS_SET = new Set<ToolActivityMessage['status']>(
  TOOL_ACTIVITY_STATUSES,
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

export function readHostMessage(
  value: unknown,
): HostToWebviewMessage | undefined {
  try {
    if (!isStrictRecord(value) || typeof value.type !== 'string') {
      return undefined;
    }

    switch (value.type) {
      case 'host.snapshot':
        return parseHostSnapshot(value);
      case 'host.connection':
        return parseHostConnection(value);
      case 'assistant.delta':
        return parseAssistantDelta(value);
      case 'thinking.delta':
        return parseThinkingDelta(value);
      case 'thinking.complete':
        return parseThinkingComplete(value);
      case 'tool.activity':
        return parseToolActivity(value);
      case 'runtime.diagnostic':
        return parseRuntimeDiagnostic(value);
      case 'turn.state':
        return parseTurnState(value);
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
  const transcript = parseSessionTranscript(value.transcript);
  if (
    connection === undefined ||
    turn === undefined ||
    sessions === undefined ||
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
    transcript,
    historyStatus: value.historyStatus,
    truncated: value.truncated,
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
    !hasExactKeys(value, [
      'type',
      'sequence',
      'sessionId',
      'turnId',
      'toolUseId',
      'toolName',
      'status',
    ]) ||
    !hasTurnIdentity(value) ||
    !isId(value.toolUseId) ||
    !isNonEmptyBoundedString(value.toolName, MAX_TOOL_NAME_LENGTH) ||
    !isToolActivityStatus(value.status)
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
    status: value.status,
  };
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
    !isExactArray(value.options, 1, MAX_ASK_USER_OPTIONS) ||
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
  return items;
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
    case 'diagnostic':
      return parseDiagnosticTranscriptItem(value);
    default:
      return undefined;
  }
}

function parseUserTranscriptItem(
  value: UnknownRecord,
): Extract<SessionTranscriptItem, { kind: 'user' }> | undefined {
  if (
    !hasExactKeys(value, ['id', 'kind', 'text']) ||
    !isId(value.id) ||
    !isBoundedString(value.text, MAX_TURN_TEXT_LENGTH)
  ) {
    return undefined;
  }

  return { id: value.id, kind: 'user', text: value.text };
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
    !hasExactKeys(value, [
      'id',
      'kind',
      'turnId',
      'toolUseId',
      'toolName',
      'status',
    ]) ||
    !isId(value.id) ||
    !isId(value.turnId) ||
    !isId(value.toolUseId) ||
    !isNonEmptyBoundedString(value.toolName, MAX_TOOL_NAME_LENGTH) ||
    !isTranscriptToolStatus(value.status)
  ) {
    return undefined;
  }

  return {
    id: value.id,
    kind: 'tool',
    turnId: value.turnId,
    toolUseId: value.toolUseId,
    toolName: value.toolName,
    status: value.status,
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
