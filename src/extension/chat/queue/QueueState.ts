import { emptyQueuedPromptsState, type QueuedPromptsState } from './queuedPromptsState';
import { type PendingAttachment } from '../internals';
export class QueueState {
  queuedPrompts: QueuedPromptsState<PendingAttachment> = emptyQueuedPromptsState();
  queueSendNowIntent: {
    readonly sessionId: string;
    readonly turnId: string;
    readonly queueId: string;
  } | null = null;
}
