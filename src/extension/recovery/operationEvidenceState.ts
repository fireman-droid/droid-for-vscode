import { MAX_SESSION_TRANSCRIPT_ITEMS } from '../../shared/bridgeMessages';
import { enrichOperationDiff } from '../../shared/protocol/operationDiff';
import type { ConversationToolOperation } from './conversationRecoveryState';

export function mergeToolOperations(
  previous: readonly ConversationToolOperation[],
  incoming: readonly ConversationToolOperation[],
): readonly ConversationToolOperation[] {
  const operations = new Map<string, ConversationToolOperation>();
  for (const operation of [...previous, ...incoming]) {
    const diff = operation.operationDiff;
    const identity = JSON.stringify([diff.status === 'ready' ? diff.sourceSessionId ?? '' : '',
      diff.status === 'ready' ? diff.callId ?? operation.toolUseId : operation.toolUseId]);
    const candidates = [...operations].filter(([, saved]) => saved.toolUseId === operation.toolUseId &&
      (saved.operationDiff.status !== 'ready' || diff.status !== 'ready'));
    const key = operations.has(identity) ? identity : candidates.length === 1 ? candidates[0]![0] : identity;
    const saved = operations.get(key);
    operations.set(key, saved ? { ...saved, ...operation,
      operationDiff: enrichOperationDiff(saved.operationDiff, diff)! } : operation);
  }
  return [...operations.values()].slice(-MAX_SESSION_TRANSCRIPT_ITEMS);
}
