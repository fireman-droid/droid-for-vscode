import {
  createContext,
  useMemo,
  type ReactNode,
} from 'react';

import { currentProcessWaiting, type ProcessWaiting } from './activityPresentation';
import type { PendingInteraction } from '../interactions/interactionStore';
import { type AssistantWebviewState } from '../state/types';

export const ProcessWaitingContext = createContext<ProcessWaiting | null>(null);
export const ProcessConversationContext = createContext<string | null>(null);
export function ProcessInteractionProvider({
  conversationId,
  sessionId,
  turn,
  interactions,
  children,
}: {
  readonly conversationId: string | null;
  readonly sessionId: string | null;
  readonly turn: AssistantWebviewState['turn'];
  readonly interactions: readonly PendingInteraction[];
  readonly children: ReactNode;
}): React.JSX.Element {
  const waiting = useMemo(
    () => currentProcessWaiting(sessionId, turn, interactions),
    [sessionId, turn, interactions],
  );
  return (
    <ProcessConversationContext.Provider value={conversationId ?? sessionId}>
      <ProcessWaitingContext.Provider value={waiting}>
        {children}
      </ProcessWaitingContext.Provider>
    </ProcessConversationContext.Provider>
  );
}

export { ProcessPresentationProvider, ProcessGroupContext, useReducedMotion, useProcessDisclosure, useProcessSelection } from '@droidvisx/chat-ui/chat/processPresentation';
