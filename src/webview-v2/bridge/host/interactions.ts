import {
  MAX_ASK_USER_OPTIONS,
  MAX_ASK_USER_OPTION_LENGTH,
  MAX_ASK_USER_QUESTIONS,
  MAX_ASK_USER_QUESTION_LENGTH,
  MAX_ASK_USER_TOPIC_LENGTH,
  MAX_EDITED_SPEC_LENGTH,
  MAX_INTERACTION_DETAIL_LENGTH,
  MAX_INTERACTION_TITLE_LENGTH,
  MAX_PERMISSION_OPTIONS,
  MAX_PERMISSION_OPTION_LABEL_LENGTH,
  MAX_PERMISSION_OPTION_VALUE_LENGTH,
  MAX_PERMISSION_RISK_NOTE_LENGTH,
  MAX_PERMISSION_TOOLS,
  MAX_PERMISSION_TOOL_NAME_LENGTH,
  MAX_SPEC_PLAN_LENGTH,
  type HostToWebviewMessage,
} from '../../../shared/bridgeMessages';
import {
  MAX_PENDING_INTERACTIONS,
  type AskUserInteractionRequest,
  type AskUserQuestion,
  type InteractionRequest,
  type PermissionInteractionRequest,
  type PermissionOption,
  type PermissionToolSummary,
  type PendingInteractionSnapshot,
} from '../../../shared/protocol/interactions';
import type { TurnStatus } from '../../../shared/protocol/turns';
import {
  hasExactKeys,
  isExactArray,
  isStrictRecord,
  type UnknownRecord,
} from '../../../shared/validation/strictValidation';
import {
  hasTurnIdentity,
  isBoundedString,
  isId,
  isNonEmptyBoundedString,
  isPermissionConfirmationKind,
  isSequence,
} from './guards';

export function parseInteractionRequestMessage(
  value: UnknownRecord,
): Extract<HostToWebviewMessage, { type: 'interaction.request' }> | undefined {
  if (
    !hasExactKeys(value, ['type', 'sequence', 'sessionId', 'turnId', 'request']) ||
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

export function parseInteractionRequest(value: unknown): InteractionRequest | undefined {
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

export function parsePendingInteractions(
  value: unknown,
  sessionId: string | null,
  turn: { readonly turnId: string; readonly status: TurnStatus } | null | undefined,
): PendingInteractionSnapshot[] | undefined {
  if (!isExactArray(value, 0, MAX_PENDING_INTERACTIONS) ||
      (value.length > 0 && (sessionId === null || !turn ||
        (turn.status !== 'submitting' && turn.status !== 'streaming')))) return undefined;
  const pending: PendingInteractionSnapshot[] = [];
  const requestIds = new Set<string>();
  for (const item of value) {
    if (!isStrictRecord(item) || !hasExactKeys(item, ['sessionId', 'turnId', 'request']) ||
        !isId(item.sessionId) || !isId(item.turnId) ||
        item.sessionId !== sessionId || item.turnId !== turn?.turnId) return undefined;
    const request = parseInteractionRequest(item.request);
    if (!request || requestIds.has(request.requestId)) return undefined;
    requestIds.add(request.requestId);
    pending.push({ sessionId: item.sessionId, turnId: item.turnId, request });
  }
  return pending;
}

export function parsePermissionRequest(
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
      !isBoundedString(value.editableSpecContent, MAX_EDITED_SPEC_LENGTH))
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

export function parsePermissionTool(value: unknown): PermissionToolSummary | undefined {
  if (
    !isStrictRecord(value) ||
    !hasExactKeys(
      value,
      ['toolUseId', 'toolName', 'confirmationKind', 'title'],
      ['detail', 'riskNote'],
    ) ||
    !isId(value.toolUseId) ||
    !isNonEmptyBoundedString(value.toolName, MAX_PERMISSION_TOOL_NAME_LENGTH) ||
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
      !isBoundedString(value.riskNote, MAX_PERMISSION_RISK_NOTE_LENGTH))
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

export function parsePermissionOption(value: unknown): PermissionOption | undefined {
  if (
    !isStrictRecord(value) ||
    !hasExactKeys(value, ['label', 'value', 'requiresEditedSpec']) ||
    !isNonEmptyBoundedString(value.label, MAX_PERMISSION_OPTION_LABEL_LENGTH) ||
    !isNonEmptyBoundedString(value.value, MAX_PERMISSION_OPTION_VALUE_LENGTH) ||
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

export function parseAskUserRequest(
  value: UnknownRecord,
): AskUserInteractionRequest | undefined {
  if (
    !hasExactKeys(value, ['requestId', 'kind', 'toolCallId', 'questions']) ||
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

export function parseAskUserQuestion(value: unknown): AskUserQuestion | undefined {
  if (
    !isStrictRecord(value) ||
    !hasExactKeys(value, ['index', 'topic', 'question', 'options', 'multiSelect']) ||
    !isSequence(value.index) ||
    !isBoundedString(value.topic, MAX_ASK_USER_TOPIC_LENGTH) ||
    !isNonEmptyBoundedString(value.question, MAX_ASK_USER_QUESTION_LENGTH) ||
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
