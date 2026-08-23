import {
  MAX_BRIDGE_ID_LENGTH,
  type PlanDocumentOpenMessage,
} from './interactionProtocol';
import { hasExactKeys, isStrictRecord } from './strictValidation';

export function parsePlanDocumentOpen(
  value: unknown,
): PlanDocumentOpenMessage | undefined {
  if (
    !isStrictRecord(value) ||
    !hasExactKeys(value, ['type', 'sessionId', 'turnId', 'requestId']) ||
    !isId(value.sessionId) ||
    !isId(value.turnId) ||
    !isId(value.requestId)
  ) {
    return undefined;
  }
  return {
    type: 'plan.document.open',
    sessionId: value.sessionId,
    turnId: value.turnId,
    requestId: value.requestId,
  };
}

function isId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_BRIDGE_ID_LENGTH
  );
}
