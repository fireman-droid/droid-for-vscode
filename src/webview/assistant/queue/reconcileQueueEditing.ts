import { type SessionQueueState } from '../../../shared/protocol/queueProtocol';
import type { AssistantWebviewState } from '../state/types';

/**
 * An edit session only makes sense while its prompt is still queued;
 * authoritative echoes that drop the prompt (dispatched, removed in
 * another view) end the edit.
 */
export function reconcileQueueEditing(
  editing: AssistantWebviewState['queueEditing'],
  queue: SessionQueueState,
): AssistantWebviewState['queueEditing'] {
  if (editing === null) {
    return null;
  }
  return queue.items.some((item) => item.queueId === editing.queueId) ? editing : null;
}
