import { type HostToWebviewMessage } from '../../../shared/bridgeMessages';
import {
  MAX_ASSISTANT_TEXT_LENGTH,
  MAX_THINKING_DELTA_LENGTH,
} from '../../../shared/protocol/bounds';
import {
  hasExactKeys,
  type UnknownRecord,
} from '../../../shared/validation/strictValidation';
import {
  MAX_STRING_LENGTH,
  hasTurnIdentity,
  isBoundedString,
  isDiagnosticSeverity,
  isId,
  isNonEmptyBoundedString,
  isNullableId,
  isSequence,
  isTurnStatus,
} from './guards';

export function parseAssistantDelta(
  value: UnknownRecord,
): Extract<HostToWebviewMessage, { type: 'assistant.delta' }> | undefined {
  if (
    !hasExactKeys(value, ['type', 'sequence', 'sessionId', 'turnId', 'delta']) ||
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

export function parseThinkingDelta(
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

export function parseThinkingComplete(
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

export function parseRuntimeDiagnostic(
  value: UnknownRecord,
): Extract<HostToWebviewMessage, { type: 'runtime.diagnostic' }> | undefined {
  if (
    !hasExactKeys(
      value,
      ['type', 'sequence', 'sessionId', 'turnId', 'severity', 'code', 'message'],
      ['relatedSessionId'],
    ) ||
    !isSequence(value.sequence) ||
    !isNullableId(value.sessionId) ||
    !isNullableId(value.turnId) ||
    !isDiagnosticSeverity(value.severity) ||
    !isBoundedString(value.code, MAX_STRING_LENGTH) ||
    !isBoundedString(value.message, MAX_STRING_LENGTH) ||
    (value.relatedSessionId !== undefined && !isId(value.relatedSessionId))
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

export function parseTurnState(
  value: UnknownRecord,
): Extract<HostToWebviewMessage, { type: 'turn.state' }> | undefined {
  if (
    !hasExactKeys(value, ['type', 'sequence', 'sessionId', 'turnId', 'status'], ['compacting']) ||
    !hasTurnIdentity(value) ||
    !isTurnStatus(value.status) ||
    (value.compacting !== undefined && typeof value.compacting !== 'boolean')
  ) {
    return undefined;
  }

  return {
    type: 'turn.state',
    sequence: value.sequence,
    sessionId: value.sessionId,
    turnId: value.turnId,
    status: value.status,
    ...(value.compacting === undefined ? {} : { compacting: value.compacting as boolean }),
  };
}

export function parseUserMessageMeta(
  value: UnknownRecord,
): Extract<HostToWebviewMessage, { type: 'user.message-meta' }> | undefined {
  if (
    !hasExactKeys(value, ['type', 'sequence', 'sessionId', 'turnId', 'messageId']) ||
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

export function parseTurnError(
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
