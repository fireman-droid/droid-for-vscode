import { advance } from '../state/turnIdentity';
import type { AssistantWebviewState, StoreHostMessage } from '../state/types';
import { reduceInteractionClosed, reducePlanDocumentState } from './interactionStore';

export function reduceInteractionsMessage(
  state: AssistantWebviewState,
  event: Extract<
    StoreHostMessage,
    { type: 'interaction.request' | 'interaction.closed' | 'plan.document.state' }
  >,
): AssistantWebviewState {
  switch (event.type) {
    case 'interaction.request':
      if (
        event.sessionId !== state.sessionId ||
        event.turnId === state.terminalTurnId ||
        state.interactions.some(
          ({ request }) => request.requestId === event.request.requestId,
        )
      ) {
        return advance(state, event.sequence);
      }
      return {
        ...state,
        sequence: event.sequence,
        interactions: [
          ...state.interactions,
          {
            sessionId: event.sessionId,
            turnId: event.turnId,
            request: event.request,
          },
        ],
      };

    case 'interaction.closed':
      return reduceInteractionClosed(state, event);

    case 'plan.document.state':
      return reducePlanDocumentState(state, event);
  }
}
