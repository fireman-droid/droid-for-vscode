import {
  MAX_ASSISTANT_TEXT_LENGTH,
  MAX_THINKING_TEXT_LENGTH,
} from '../../../shared/protocol/bounds';
import type { AssistantWebviewState, StoreHostMessage } from './types';

type StreamDelta = Extract<
  StoreHostMessage,
  { type: 'assistant.delta' | 'thinking.delta' }
>;
type ReduceMessage = (
  state: AssistantWebviewState,
  message: StoreHostMessage,
) => AssistantWebviewState;

function continuesStream(
  first: StreamDelta,
  next: StoreHostMessage,
): next is StreamDelta {
  return (
    next.type === first.type &&
    next.sessionId === first.sessionId &&
    next.turnId === first.turnId &&
    (first.type !== 'thinking.delta' ||
      (next.type === 'thinking.delta' && next.segmentIndex === first.segmentIndex))
  );
}

/**
 * Hidden webviews can deliver an entire stream backlog when shown again.
 * Preserve the first delta's identity, then reduce consecutive text once.
 * Lifecycle events and non-increasing sequences always end a run.
 */
export function reduceHostMessageBatch(
  state: AssistantWebviewState,
  messages: readonly StoreHostMessage[],
  reduce: ReduceMessage,
): AssistantWebviewState {
  let current = state;
  for (let index = 0; index < messages.length; index++) {
    const first = messages[index]!;
    const previousSequence = current.sequence;
    current = reduce(current, first);
    if (
      (first.type !== 'assistant.delta' && first.type !== 'thinking.delta') ||
      first.sequence <= previousSequence ||
      !Number.isFinite(first.sequence)
    )
      continue;
    const limit =
      first.type === 'assistant.delta'
        ? MAX_ASSISTANT_TEXT_LENGTH
        : MAX_THINKING_TEXT_LENGTH;
    const text: string[] = [];
    let length = 0;
    let last: StreamDelta = first;
    let truncated = first.type === 'thinking.delta' && first.truncated;
    while (index + 1 < messages.length) {
      const next = messages[index + 1]!;
      if (
        !continuesStream(first, next) ||
        !Number.isFinite(next.sequence) ||
        next.sequence <= last.sequence ||
        length + next.delta.length > limit
      )
        break;
      text.push(next.delta);
      length += next.delta.length;
      if (next.type === 'thinking.delta') truncated ||= next.truncated;
      last = next;
      index++;
    }
    if (text.length > 0) {
      const message: StreamDelta =
        last.type === 'thinking.delta'
          ? { ...last, delta: text.join(''), truncated }
          : { ...last, delta: text.join('') };
      current = reduce(current, message);
    }
  }
  return current;
}
