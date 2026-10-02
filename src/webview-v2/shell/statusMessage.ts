import { MAX_TURN_TEXT_LENGTH } from '../../shared/protocol/bounds';
import type { AssistantWebviewState } from '../state/types';

export function getStatusMessage(state: Pick<AssistantWebviewState, 'turn' | 'connection'> & Partial<Pick<AssistantWebviewState, 'settings'>>, draft: string): string | undefined {
  if (state.connection.status === 'unavailable') return state.connection.message ?? 'The local Droid connection is unavailable.';
  if (state.turn?.error !== undefined) return state.turn.error;
  if (state.turn?.status === 'failed' && state.connection.status === 'connected') {
    return 'Reply failed. No error details are available.';
  }
  if (state.connection.message !== undefined) return state.connection.message;
  if (state.settings?.status === 'updating') return 'Updating session settings…';
  if (draft.length > MAX_TURN_TEXT_LENGTH) {
    const excess = draft.length - MAX_TURN_TEXT_LENGTH;
    return `Message is too long. Remove ${excess.toLocaleString()} ${excess === 1 ? 'character' : 'characters'} to send.`;
  }
  switch (state.turn?.status) {
    case 'submitting': return 'Sending…';
    case 'streaming': return state.turn.compacting ? 'Compacting conversation…' : state.turn.activity === 'working' ? 'Droid is working…' : 'Droid is responding…';
    case 'stopping': return 'Stopping…';
    case 'interrupted': return 'Stopped';
    default: return undefined;
  }
}

export function getHistoryNotice(historyStatus: AssistantWebviewState['historyStatus'], truncated: boolean): string | null {
  if (historyStatus === 'unavailable') return 'Earlier CLI messages are unavailable here. You can continue this session.';
  if (historyStatus === 'partial') return truncated
    ? 'Some earlier session content is unavailable, and older locally retained messages were trimmed.'
    : 'Some earlier session content is unavailable through the public Droid history.';
  return truncated ? 'Older messages were trimmed from the local display.' : null;
}
