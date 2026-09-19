import { MAX_TURN_TEXT_LENGTH } from '../protocol/bounds';
import {
  type SessionCompactMessage,
  type SessionForkMessage,
} from '../protocol/sessions';
import { type RuntimeRetryMessage } from '../protocol/shell';
import {
  type RewindInfoRequestMessage,
  type TurnEditResendMessage,
  type TurnSendMessage,
  type TurnStopMessage,
} from '../protocol/turns';
import { hasExactKeys, type UnknownRecord } from './strictValidation';
import { isId } from './guards';

export function parseTurnSend(value: UnknownRecord): TurnSendMessage | undefined {
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

export function parseTurnStop(value: UnknownRecord): TurnStopMessage | undefined {
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

export function parseTurnEditResend(
  value: UnknownRecord,
): TurnEditResendMessage | undefined {
  if (
    !hasExactKeys(
      value,
      ['type', 'sessionId', 'turnId', 'messageId', 'text'],
      ['restoreFiles'],
    ) ||
    !isId(value.sessionId) ||
    !isId(value.turnId) ||
    !isId(value.messageId) ||
    typeof value.text !== 'string' ||
    value.text.length === 0 ||
    value.text.length > MAX_TURN_TEXT_LENGTH ||
    (value.restoreFiles !== undefined && typeof value.restoreFiles !== 'boolean')
  ) {
    return undefined;
  }

  return {
    type: 'turn.editResend',
    sessionId: value.sessionId,
    turnId: value.turnId,
    messageId: value.messageId,
    text: value.text,
    ...(value.restoreFiles === undefined ? {} : { restoreFiles: value.restoreFiles }),
  };
}

export function parseRewindInfoRequest(
  value: UnknownRecord,
): RewindInfoRequestMessage | undefined {
  if (
    !hasExactKeys(value, ['type', 'sessionId', 'messageId']) ||
    !isId(value.sessionId) ||
    !isId(value.messageId)
  ) {
    return undefined;
  }

  return {
    type: 'rewind.info',
    sessionId: value.sessionId,
    messageId: value.messageId,
  };
}

export function parseRuntimeRetry(value: UnknownRecord): RuntimeRetryMessage | undefined {
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

export function parseSessionCompact(
  value: UnknownRecord,
): SessionCompactMessage | undefined {
  if (!hasExactKeys(value, ['type', 'sessionId']) || !isId(value.sessionId)) {
    return undefined;
  }

  return { type: 'session.compact', sessionId: value.sessionId };
}

export function parseSessionFork(value: UnknownRecord): SessionForkMessage | undefined {
  if (!hasExactKeys(value, ['type', 'sessionId']) || !isId(value.sessionId)) {
    return undefined;
  }

  return { type: 'session.fork', sessionId: value.sessionId };
}
