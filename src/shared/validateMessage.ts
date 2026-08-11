import {
  BRIDGE_PROTOCOL_VERSION,
  MAX_ASK_USER_ANSWERS,
  MAX_ASK_USER_ANSWER_LENGTH,
  MAX_BRIDGE_ID_LENGTH,
  MAX_EDITED_SPEC_LENGTH,
  MAX_MODEL_ID_LENGTH,
  MAX_PERMISSION_OPTION_VALUE_LENGTH,
  MAX_SESSION_TITLE_LENGTH,
  MAX_TURN_TEXT_LENGTH,
  SESSION_AUTONOMY_LEVELS,
  SESSION_INTERACTION_MODES,
  SESSION_REASONING_EFFORTS,
  type AskUserAnswer,
  type AskUserRespondMessage,
  type PermissionRespondMessage,
  type RuntimeRetryMessage,
  type SessionContextRefreshMessage,
  type SessionNewMessage,
  type SessionRenameMessage,
  type SessionSelectMessage,
  type SessionSettingUpdateMessage,
  type SessionsRefreshMessage,
  type TurnEditResendMessage,
  type TurnSendMessage,
  type TurnStopMessage,
  type WebviewReadyMessage,
  type WebviewToHostMessage,
} from './bridgeMessages';
import {
  hasExactKeys,
  isExactArray,
  isStrictRecord,
  type UnknownRecord,
} from './strictValidation';

export function parseWebviewMessage(
  value: unknown,
): WebviewToHostMessage | undefined {
  try {
    if (!isStrictRecord(value) || typeof value.type !== 'string') {
      return undefined;
    }

    switch (value.type) {
      case 'webview.ready':
        return parseWebviewReady(value);
      case 'turn.send':
        return parseTurnSend(value);
      case 'turn.stop':
        return parseTurnStop(value);
      case 'turn.editResend':
        return parseTurnEditResend(value);
      case 'runtime.retry':
        return parseRuntimeRetry(value);
      case 'permission.respond':
        return parsePermissionRespond(value);
      case 'ask-user.respond':
        return parseAskUserRespond(value);
      case 'sessions.refresh':
        return parseSessionsRefresh(value);
      case 'session.select':
        return parseSessionSelect(value);
      case 'session.new':
        return parseSessionNew(value);
      case 'session.rename':
        return parseSessionRename(value);
      case 'session.context.refresh':
        return parseSessionContextRefresh(value);
      case 'session.setting.update':
        return parseSessionSettingUpdate(value);
      default:
        return undefined;
    }
  } catch {
    return undefined;
  }
}

export function isWebviewToHostMessage(
  value: unknown,
): value is WebviewToHostMessage {
  return parseWebviewMessage(value) !== undefined;
}

function parseWebviewReady(
  value: UnknownRecord,
): WebviewReadyMessage | undefined {
  if (
    !hasExactKeys(value, ['type', 'protocolVersion']) ||
    value.protocolVersion !== BRIDGE_PROTOCOL_VERSION
  ) {
    return undefined;
  }

  return {
    type: 'webview.ready',
    protocolVersion: BRIDGE_PROTOCOL_VERSION,
  };
}

function parseTurnSend(value: UnknownRecord): TurnSendMessage | undefined {
  if (
    !hasExactKeys(value, ['type', 'sessionId', 'turnId', 'text']) ||
    !isId(value.sessionId) ||
    !isId(value.turnId) ||
    typeof value.text !== 'string' ||
    value.text.length === 0 ||
    value.text.length > MAX_TURN_TEXT_LENGTH
  ) {
    return undefined;
  }

  return {
    type: 'turn.send',
    sessionId: value.sessionId,
    turnId: value.turnId,
    text: value.text,
  };
}

function parseTurnStop(value: UnknownRecord): TurnStopMessage | undefined {
  if (
    !hasExactKeys(value, ['type', 'sessionId', 'turnId']) ||
    !isId(value.sessionId) ||
    !isId(value.turnId)
  ) {
    return undefined;
  }

  return {
    type: 'turn.stop',
    sessionId: value.sessionId,
    turnId: value.turnId,
  };
}

function parseTurnEditResend(
  value: UnknownRecord,
): TurnEditResendMessage | undefined {
  if (
    !hasExactKeys(value, [
      'type',
      'sessionId',
      'turnId',
      'messageId',
      'text',
    ]) ||
    !isId(value.sessionId) ||
    !isId(value.turnId) ||
    !isId(value.messageId) ||
    typeof value.text !== 'string' ||
    value.text.length === 0 ||
    value.text.length > MAX_TURN_TEXT_LENGTH
  ) {
    return undefined;
  }

  return {
    type: 'turn.editResend',
    sessionId: value.sessionId,
    turnId: value.turnId,
    messageId: value.messageId,
    text: value.text,
  };
}

function parseRuntimeRetry(
  value: UnknownRecord,
): RuntimeRetryMessage | undefined {
  if (
    !hasExactKeys(value, ['type', 'sessionId']) ||
    (value.sessionId !== null && !isId(value.sessionId))
  ) {
    return undefined;
  }

  return {
    type: 'runtime.retry',
    sessionId: value.sessionId,
  };
}

function parsePermissionRespond(
  value: UnknownRecord,
): PermissionRespondMessage | undefined {
  if (
    !hasExactKeys(
      value,
      ['type', 'sessionId', 'turnId', 'requestId', 'selectedOption'],
      ['editedSpecContent'],
    ) ||
    !isId(value.sessionId) ||
    !isId(value.turnId) ||
    !isId(value.requestId) ||
    !isNonEmptyBoundedString(
      value.selectedOption,
      MAX_PERMISSION_OPTION_VALUE_LENGTH,
    ) ||
    (value.editedSpecContent !== undefined &&
      !isBoundedString(
        value.editedSpecContent,
        MAX_EDITED_SPEC_LENGTH,
      ))
  ) {
    return undefined;
  }

  return value.editedSpecContent === undefined
    ? {
        type: 'permission.respond',
        sessionId: value.sessionId,
        turnId: value.turnId,
        requestId: value.requestId,
        selectedOption: value.selectedOption,
      }
    : {
        type: 'permission.respond',
        sessionId: value.sessionId,
        turnId: value.turnId,
        requestId: value.requestId,
        selectedOption: value.selectedOption,
        editedSpecContent: value.editedSpecContent,
      };
}

function parseAskUserRespond(
  value: UnknownRecord,
): AskUserRespondMessage | undefined {
  if (
    !hasExactKeys(value, [
      'type',
      'sessionId',
      'turnId',
      'requestId',
      'cancelled',
      'answers',
    ]) ||
    !isId(value.sessionId) ||
    !isId(value.turnId) ||
    !isId(value.requestId) ||
    typeof value.cancelled !== 'boolean' ||
    !isExactArray(value.answers, 0, MAX_ASK_USER_ANSWERS) ||
    (value.cancelled
      ? value.answers.length !== 0
      : value.answers.length === 0)
  ) {
    return undefined;
  }

  const answers: AskUserAnswer[] = [];
  const indices = new Set<number>();
  for (const answerValue of value.answers) {
    const answer = parseAskUserAnswer(answerValue);
    if (answer === undefined || indices.has(answer.index)) {
      return undefined;
    }
    indices.add(answer.index);
    answers.push(answer);
  }

  return {
    type: 'ask-user.respond',
    sessionId: value.sessionId,
    turnId: value.turnId,
    requestId: value.requestId,
    cancelled: value.cancelled,
    answers,
  };
}

function parseAskUserAnswer(value: unknown): AskUserAnswer | undefined {
  if (
    !isStrictRecord(value) ||
    !hasExactKeys(value, ['index', 'answer']) ||
    !isIndex(value.index) ||
    !isNonEmptyBoundedString(value.answer, MAX_ASK_USER_ANSWER_LENGTH)
  ) {
    return undefined;
  }

  return { index: value.index, answer: value.answer };
}

function parseSessionsRefresh(
  value: UnknownRecord,
): SessionsRefreshMessage | undefined {
  if (!hasExactKeys(value, ['type'])) {
    return undefined;
  }

  return { type: 'sessions.refresh' };
}

function parseSessionSelect(
  value: UnknownRecord,
): SessionSelectMessage | undefined {
  if (!hasExactKeys(value, ['type', 'sessionId']) || !isId(value.sessionId)) {
    return undefined;
  }

  return { type: 'session.select', sessionId: value.sessionId };
}

function parseSessionNew(
  value: UnknownRecord,
): SessionNewMessage | undefined {
  if (!hasExactKeys(value, ['type'])) {
    return undefined;
  }

  return { type: 'session.new' };
}

function parseSessionRename(
  value: UnknownRecord,
): SessionRenameMessage | undefined {
  if (
    !hasExactKeys(value, ['type', 'sessionId', 'title']) ||
    !isId(value.sessionId) ||
    !isNonEmptyBoundedString(value.title, MAX_SESSION_TITLE_LENGTH) ||
    value.title.trim().length === 0
  ) {
    return undefined;
  }

  return {
    type: 'session.rename',
    sessionId: value.sessionId,
    title: value.title,
  };
}

function parseSessionContextRefresh(
  value: UnknownRecord,
): SessionContextRefreshMessage | undefined {
  if (
    !hasExactKeys(value, ['type', 'sessionId']) ||
    !isId(value.sessionId)
  ) {
    return undefined;
  }

  return {
    type: 'session.context.refresh',
    sessionId: value.sessionId,
  };
}

function parseSessionSettingUpdate(
  value: UnknownRecord,
): SessionSettingUpdateMessage | undefined {
  if (
    !hasExactKeys(value, ['type', 'sessionId', 'field', 'value']) ||
    !isId(value.sessionId)
  ) {
    return undefined;
  }

  switch (value.field) {
    case 'interactionMode':
      return isEnumValue(value.value, SESSION_INTERACTION_MODES)
        ? {
            type: 'session.setting.update',
            sessionId: value.sessionId,
            field: 'interactionMode',
            value: value.value,
          }
        : undefined;
    case 'modelId':
      return isSafeModelId(value.value)
        ? {
            type: 'session.setting.update',
            sessionId: value.sessionId,
            field: 'modelId',
            value: value.value,
          }
        : undefined;
    case 'reasoningEffort':
      return isEnumValue(value.value, SESSION_REASONING_EFFORTS)
        ? {
            type: 'session.setting.update',
            sessionId: value.sessionId,
            field: 'reasoningEffort',
            value: value.value,
          }
        : undefined;
    case 'autonomyLevel':
      return isEnumValue(value.value, SESSION_AUTONOMY_LEVELS)
        ? {
            type: 'session.setting.update',
            sessionId: value.sessionId,
            field: 'autonomyLevel',
            value: value.value,
          }
        : undefined;
    default:
      return undefined;
  }
}

function isId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_BRIDGE_ID_LENGTH
  );
}

function isSafeModelId(value: unknown): value is string {
  return (
    isNonEmptyBoundedString(value, MAX_MODEL_ID_LENGTH) &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f-\u009f]/.test(value)
  );
}

function isEnumValue<const Values extends readonly string[]>(
  value: unknown,
  values: Values,
): value is Values[number] {
  return (
    typeof value === 'string' &&
    (values as readonly string[]).includes(value)
  );
}

function isIndex(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
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
