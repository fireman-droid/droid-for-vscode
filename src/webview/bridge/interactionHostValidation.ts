import {
  MAX_ASK_USER_ANSWERS,
  MAX_ASK_USER_ANSWER_LENGTH,
  MAX_ASK_USER_TOPIC_LENGTH,
  MAX_ASK_USER_QUESTION_LENGTH,
  type AskUserResultAnswer,
  MAX_BRIDGE_ID_LENGTH,
  MAX_EDITED_SPEC_LENGTH,
  PLAN_DOCUMENT_STATUSES,
  type AskUserInteractionResult,
  type AskUserResultTranscriptItem,
  type InteractionClosedMessage,
  type PlanDocumentStateMessage,
} from '../../shared/bridgeMessages';
import {
  hasExactKeys,
  isExactArray,
  isStrictRecord,
  type UnknownRecord,
} from '../../shared/strictValidation';

export function parseInteractionClosedMessage(
  value: unknown,
): InteractionClosedMessage | undefined {
  if (
    !isStrictRecord(value) ||
    !hasExactKeys(
      value,
      ['type', 'sequence', 'sessionId', 'turnId', 'requestId'],
      ['result'],
    ) ||
    !isSequence(value.sequence) ||
    !isId(value.sessionId) ||
    !isId(value.turnId) ||
    !isId(value.requestId)
  ) {
    return undefined;
  }
  const result =
    value.result === undefined
      ? undefined
      : parseAskUserInteractionResult(value.result);
  if (value.result !== undefined && result === undefined) {
    return undefined;
  }
  return {
    type: 'interaction.closed',
    sequence: value.sequence,
    sessionId: value.sessionId,
    turnId: value.turnId,
    requestId: value.requestId,
    ...(result === undefined ? {} : { result }),
  };
}

export function parsePlanDocumentStateMessage(
  value: unknown,
): PlanDocumentStateMessage | undefined {
  if (
    !isStrictRecord(value) ||
    !hasExactKeys(
      value,
      ['type', 'sequence', 'sessionId', 'turnId', 'requestId', 'status'],
      ['content'],
    ) ||
    !isSequence(value.sequence) ||
    !isId(value.sessionId) ||
    !isId(value.turnId) ||
    !isId(value.requestId) ||
    typeof value.status !== 'string' ||
    !(PLAN_DOCUMENT_STATUSES as readonly string[]).includes(value.status)
  ) {
    return undefined;
  }
  if (value.status === 'ready') {
    return isBoundedString(value.content, MAX_EDITED_SPEC_LENGTH)
      ? {
          type: 'plan.document.state',
          sequence: value.sequence,
          sessionId: value.sessionId,
          turnId: value.turnId,
          requestId: value.requestId,
          status: 'ready',
          content: value.content,
        }
      : undefined;
  }
  return value.content === undefined
    ? {
        type: 'plan.document.state',
        sequence: value.sequence,
        sessionId: value.sessionId,
        turnId: value.turnId,
        requestId: value.requestId,
        status: value.status as 'too-large' | 'closed' | 'failed',
      }
    : undefined;
}

export function parseAskUserResultTranscriptItem(
  value: UnknownRecord,
): AskUserResultTranscriptItem | undefined {
  if (
    !hasExactKeys(
      value,
      ['id', 'kind', 'turnId', 'status'],
      ['answers'],
    ) ||
    !isId(value.id) ||
    !isId(value.turnId)
  ) {
    return undefined;
  }
  const result = parseAskUserInteractionResult({
    status: value.status,
    ...(value.answers === undefined ? {} : { answers: value.answers }),
  });
  if (result === undefined) {
    return undefined;
  }
  return result.status === 'cancelled'
    ? {
        id: value.id,
        kind: 'ask-user-result',
        turnId: value.turnId,
        status: 'cancelled',
      }
    : {
        id: value.id,
        kind: 'ask-user-result',
        turnId: value.turnId,
        status: 'answered',
        answers: result.answers,
      };
}

function parseAskUserInteractionResult(
  value: unknown,
): AskUserInteractionResult | undefined {
  if (!isStrictRecord(value) || typeof value.status !== 'string') {
    return undefined;
  }
  if (value.status === 'cancelled') {
    return hasExactKeys(value, ['status'])
      ? { status: 'cancelled' }
      : undefined;
  }
  if (
    value.status !== 'answered' ||
    !hasExactKeys(value, ['status', 'answers']) ||
    !isExactArray(value.answers, 1, MAX_ASK_USER_ANSWERS)
  ) {
    return undefined;
  }
  const answers: AskUserResultAnswer[] = [];
  for (const answer of value.answers) {
    if (
      !isStrictRecord(answer) ||
      !hasExactKeys(answer, ['topic', 'answer'], ['question']) ||
      !isNonEmptyBoundedString(answer.topic, MAX_ASK_USER_TOPIC_LENGTH) ||
      !isNonEmptyBoundedString(answer.answer, MAX_ASK_USER_ANSWER_LENGTH) ||
      (answer.question !== undefined &&
        !isNonEmptyBoundedString(answer.question, MAX_ASK_USER_QUESTION_LENGTH))
    ) {
      return undefined;
    }
    answers.push({
      topic: answer.topic,
      answer: answer.answer,
      ...(answer.question === undefined ? {} : { question: answer.question }),
    });
  }
  return { status: 'answered', answers };
}

function isSequence(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0
  );
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
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maximumLength
  );
}
