import { MAX_BRIDGE_ID_LENGTH } from '../../shared/bridgeMessages';
import { sessionMessageTurnId } from '../../shared/transcript/sessionMessageIdentity';
import { isStrictRecord } from '../../shared/validation/strictValidation';
import type { HistoryMessageAncestry } from './SessionHistory';

/** Uses the same bounded raw-message window as the visible history projection. */
export function historyMessageAncestry(
  messages: readonly unknown[], firstMessage: number, sessionId: string | undefined,
): readonly HistoryMessageAncestry[] | undefined {
  if (sessionId === undefined) return undefined;
  const ancestry: HistoryMessageAncestry[] = [];
  for (let index = firstMessage; index < messages.length; index += 1) {
    const message = messages[index];
    if (!isStrictRecord(message) || !identity(message.id) ||
        !['user', 'system', 'assistant', 'tool'].includes(String(message.role))) continue;
    ancestry.push({
      messageId: message.id,
      parentId: identity(message.parentId) ? message.parentId : null,
      projectedTurnId: sessionMessageTurnId(sessionId, message.id),
      startsTurn: message.role === 'user' || message.role === 'system',
    });
  }
  return ancestry;
}

function identity(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_BRIDGE_ID_LENGTH;
}
