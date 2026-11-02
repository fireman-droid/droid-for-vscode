import { MAX_TURN_TEXT_LENGTH } from '../../shared/protocol/bounds';
import type { AssistantWebviewState } from '../state/types';

export function getStatusMessage(
  state: Pick<AssistantWebviewState, 'turn' | 'connection'> & {
    readonly transcript?: AssistantWebviewState['transcript'];
  },
  draft: string,
): string | undefined {
  if (state.connection.status === 'unavailable') return state.connection.message ?? 'The local Droid connection is unavailable.';
  const turnErrorInTranscript =
    state.turn !== null &&
    state.transcript?.some(
      (item) =>
        item.kind === 'diagnostic' &&
        item.severity === 'error' &&
        (item.turnId === state.turn?.turnId ||
          (state.turn?.error !== undefined && item.message === state.turn.error)),
    ) === true;
  if (!turnErrorInTranscript) {
    if (state.turn?.error !== undefined) return state.turn.error;
    if (state.turn?.status === 'failed' && state.connection.status === 'connected') {
      return 'Reply failed. No error details are available.';
    }
  }
  if (state.connection.message !== undefined) return state.connection.message;
  if (draft.length > MAX_TURN_TEXT_LENGTH) {
    const excess = draft.length - MAX_TURN_TEXT_LENGTH;
    return `Message is too long. Remove ${excess.toLocaleString()} ${excess === 1 ? 'character' : 'characters'} to send.`;
  }
  let lastUserIndex = -1;
  if (state.transcript) {
    for (let index = state.transcript.length - 1; index >= 0; index -= 1) {
      if (state.transcript[index]!.kind === 'user') {
        lastUserIndex = index;
        break;
      }
    }
  }
  const turnStoppedInTranscript =
    state.turn?.status === 'interrupted' &&
    state.transcript
      ?.slice(lastUserIndex + 1)
      .some(
        (item) =>
          (item.kind === 'thinking' || item.kind === 'tool') &&
          (item.turnId === state.turn?.turnId ||
            item.status === 'stopping' ||
            item.status === 'stopped'),
      ) === true;
  switch (state.turn?.status) {
    case 'submitting': return 'Sending…';
    case 'streaming': return state.turn.compacting ? 'Compacting conversation…' : state.turn.activity === 'working' ? 'Droid is working…' : 'Droid is responding…';
    case 'stopping': return 'Stopping…';
    case 'interrupted': return turnStoppedInTranscript ? undefined : 'Stopped';
    default: return undefined;
  }
}

export function getHistoryNotice(historyStatus: AssistantWebviewState['historyStatus'], truncated: boolean): string | null {
  if (historyStatus === 'unavailable') return 'Earlier CLI messages are unavailable';
  if (historyStatus === 'partial') return truncated
    ? 'Earlier history partially omitted'
    : 'Some earlier content unavailable';
  return truncated ? 'Older messages trimmed' : null;
}
