import { MAX_SESSION_TRANSCRIPT_ITEMS } from '../../shared/bridgeMessages';
import { enrichOperationDiff, type OperationDiff } from '../../shared/protocol/operationDiff';
import type { ConversationToolOperation } from './conversationRecoveryState';

export function mergeToolOperations(
  previous: readonly ConversationToolOperation[],
  incoming: readonly ConversationToolOperation[],
): readonly ConversationToolOperation[] {
  const operations = new Map<string, ConversationToolOperation>();
  const allByTool = new Map<string, Set<string>>();
  const unavailableByTool = new Map<string, Set<string>>();
  for (const operation of [...previous, ...incoming]) {
    const diff = operation.operationDiff;
    const identity = JSON.stringify([diff.status === 'ready' ? diff.sourceSessionId ?? '' : '',
      diff.status === 'ready' ? diff.callId ?? operation.toolUseId : operation.toolUseId]);
    const candidates = (diff.status === 'ready' ? unavailableByTool : allByTool).get(operation.toolUseId);
    const key = operations.has(identity) ? identity : candidates?.size === 1 ? candidates.values().next().value! : identity;
    const saved = operations.get(key);
    const merged = saved ? { ...saved, ...operation,
      operationDiff: enrichOperationDiff(saved.operationDiff, diff)! } : operation;
    if (saved) {
      allByTool.get(saved.toolUseId)?.delete(key);
      unavailableByTool.get(saved.toolUseId)?.delete(key);
    }
    operations.set(key, saved && sameOperation(saved, merged) ? saved : merged);
    indexKey(allByTool, merged.toolUseId, key);
    if (merged.operationDiff.status === 'unavailable') indexKey(unavailableByTool, merged.toolUseId, key);
  }
  const merged = [...operations.values()].slice(-MAX_SESSION_TRANSCRIPT_ITEMS);
  return merged.length === previous.length && merged.every((operation, index) => operation === previous[index])
    ? previous : merged;
}

function indexKey(index: Map<string, Set<string>>, toolUseId: string, key: string): void {
  let keys = index.get(toolUseId);
  if (!keys) index.set(toolUseId, keys = new Set());
  keys.add(key);
}

function sameOperation(left: ConversationToolOperation, right: ConversationToolOperation): boolean {
  return left.toolUseId === right.toolUseId && left.toolName === right.toolName &&
    left.executionPhase === right.executionPhase && sameDiff(left.operationDiff, right.operationDiff);
}

function sameDiff(left: OperationDiff, right: OperationDiff): boolean {
  if (left === right) return true;
  if (left.status !== 'ready') return right.status === 'unavailable' && left.reason === right.reason;
  if (right.status !== 'ready' || left.source !== right.source || left.callId !== right.callId ||
    left.sourceSessionId !== right.sourceSessionId || left.files.length !== right.files.length) return false;
  return left.files.every((file, index) => {
    const other = right.files[index]!;
    return file.path === other.path && file.previousPath === other.previousPath && file.kind === other.kind &&
      file.outcome === other.outcome && file.message === other.message && file.contentRestricted === other.contentRestricted &&
      file.reversible === other.reversible && file.patch === other.patch && file.submittedContent === other.submittedContent;
  });
}
