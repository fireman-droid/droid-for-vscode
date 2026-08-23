import {
  type HostToWebviewMessage,
  type InteractionRequest,
  type PlanDocumentStatus,
  type SessionTranscriptItem,
} from '../../shared/bridgeMessages';
import { stableTranscriptId } from '../../shared/hostTranscriptState';
import {
  enforceTranscriptImageBudget,
  trimTranscriptToLimits,
} from '../../shared/transcriptLimits';
import type { AssistantWebviewState } from './store';

export interface PendingInteraction {
  readonly sessionId: string;
  readonly turnId: string;
  readonly request: InteractionRequest;
  readonly planDocument?: {
    readonly status: PlanDocumentStatus;
    readonly content?: string;
  };
}

export function reduceInteractionClosed(
  state: AssistantWebviewState,
  event: Extract<HostToWebviewMessage, { type: 'interaction.closed' }>,
): AssistantWebviewState {
  if (event.sessionId !== state.sessionId) {
    return { ...state, sequence: event.sequence };
  }
  const next = {
    ...state,
    sequence: event.sequence,
    interactions: state.interactions.filter(
      ({ request }) => request.requestId !== event.requestId,
    ),
  };
  if (event.result === undefined) {
    return next;
  }
  const id = stableTranscriptId(
    'ask-user-result',
    event.turnId,
    event.requestId,
  );
  if (state.transcript.some((item) => item.id === id)) {
    return next;
  }
  const item: SessionTranscriptItem =
    event.result.status === 'cancelled'
      ? {
          id,
          kind: 'ask-user-result',
          turnId: event.turnId,
          status: 'cancelled',
        }
      : {
          id,
          kind: 'ask-user-result',
          turnId: event.turnId,
          status: 'answered',
          answers: event.result.answers,
        };
  return boundTranscript(next, [...state.transcript, item]);
}

export function reducePlanDocumentState(
  state: AssistantWebviewState,
  event: Extract<HostToWebviewMessage, { type: 'plan.document.state' }>,
): AssistantWebviewState {
  if (event.sessionId !== state.sessionId) {
    return { ...state, sequence: event.sequence };
  }
  return {
    ...state,
    sequence: event.sequence,
    interactions: state.interactions.map((interaction) =>
      interaction.sessionId === event.sessionId &&
      interaction.turnId === event.turnId &&
      interaction.request.requestId === event.requestId &&
      interaction.request.kind === 'permission'
        ? {
            ...interaction,
            planDocument:
              event.status === 'ready'
                ? { status: 'ready' as const, content: event.content }
                : {
                    status: event.status,
                    ...(interaction.planDocument?.content === undefined
                      ? {}
                      : { content: interaction.planDocument.content }),
                  },
          }
        : interaction,
    ),
  };
}

function boundTranscript(
  state: AssistantWebviewState,
  transcript: readonly SessionTranscriptItem[],
): AssistantWebviewState {
  const bounded = trimTranscriptToLimits(transcript);
  const images = enforceTranscriptImageBudget(bounded.transcript);
  return bounded.trimmed
    ? {
        ...state,
        transcript: images.transcript,
        historyStatus: 'partial',
        truncated: true,
      }
    : { ...state, transcript: images.transcript };
}
