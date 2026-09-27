import { useCallback, useLayoutEffect, useRef, type RefObject } from 'react';
import type { AskUserAnswer } from '../../shared/protocol/interactionProtocol';
import { stableTranscriptId } from '../../shared/transcript/hostTranscriptState';
import type { PendingInteraction } from './interactions/interactionStore';
import type { AssistantWebviewState } from '../state/types';

type AnswerState = Pick<AssistantWebviewState, 'conversationId' | 'sessionId' | 'turn' | 'connection' | 'transcript'>;
type AnswerHandler = (request: PendingInteraction, cancelled: boolean, answers: readonly AskUserAnswer[]) => void;

/** Follow an answer only after its Host result and closed card share a committed layout. */
export function useAnswerScroll({ state, blocked, transcript, onRespond }: {
  readonly state: AnswerState;
  readonly blocked: boolean;
  readonly transcript: RefObject<{ scrollToBottom(): void } | null>;
  readonly onRespond: AnswerHandler;
}): AnswerHandler {
  const pendingAnswer = useRef<{
    conversationId: string | null; sessionId: string; turnId: string; resultId: string;
  } | null>(null);

  useLayoutEffect(() => {
    const pending = pendingAnswer.current;
    if (pending === null) return;
    if (pending.conversationId !== state.conversationId || pending.sessionId !== state.sessionId ||
      pending.turnId !== state.turn?.turnId || state.connection.status !== 'connected' || blocked ||
      state.turn.status === 'stopping' || state.turn.status === 'interrupted' || state.turn.status === 'failed') {
      pendingAnswer.current = null;
      return;
    }
    const result = state.transcript.find((item) => item.id === pending.resultId);
    if (result?.kind !== 'ask-user-result') return;
    pendingAnswer.current = null;
    if (result.status === 'answered') transcript.current?.scrollToBottom();
  }, [state.conversationId, state.sessionId, state.turn, state.connection.status, state.transcript, blocked, transcript]);

  return useCallback((request, cancelled, answers) => {
    pendingAnswer.current = cancelled ? null : {
      conversationId: state.conversationId, sessionId: request.sessionId, turnId: request.turnId,
      resultId: stableTranscriptId('ask-user-result', request.turnId, request.request.requestId),
    };
    onRespond(request, cancelled, answers);
  }, [state.conversationId, onRespond]);
}
