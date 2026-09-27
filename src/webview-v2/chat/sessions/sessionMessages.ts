import { advance } from '../../state/turnIdentity';
import type { AssistantWebviewState, StoreHostMessage } from '../../state/types';

export function reduceSessionsMessage(
  state: AssistantWebviewState,
  event: Extract<
    StoreHostMessage,
    { type: 'session.running' | 'session.archived' | 'session.searchResults' }
  >,
): AssistantWebviewState {
  switch (event.type) {
    case 'session.running': {
      // Incremental running flag of one catalog row (detached daemon
      // turn); flips the drawer spinner without a catalog refresh.
      if (state.sessions.status !== 'ready') {
        return advance(state, event.sequence);
      }
      const items = state.sessions.items.map((item) =>
        item.id === event.sessionId
          ? event.running
            ? { ...item, running: true }
            : (({ running: _running, ...rest }) => rest)(item)
          : item,
      );
      return {
        ...state,
        sequence: event.sequence,
        sessions: { ...state.sessions, items },
      };
    }

    case 'session.archived': {
      // A refresh in flight sends 'loading' with no items; keep the
      // current list visible until the fresh one arrives.
      const archived =
        event.archived.status === 'loading' && state.archived.items.length > 0
          ? { status: 'loading' as const, items: state.archived.items }
          : event.archived;
      return { ...state, sequence: event.sequence, archived };
    }

    case 'session.searchResults':
      return {
        ...state,
        sequence: event.sequence,
        sessionSearch: event.search,
      };
  }
}
