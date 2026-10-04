import {
  EMPTY_SESSION_QUEUE_STATE,
  MAX_QUEUED_MESSAGES,
} from '../../shared/protocol/queueProtocol';
import { stableTranscriptId } from '../../shared/transcript/hostTranscriptState';
import { boundTranscript, markActivitiesStopping } from '../chat/transcript/transcriptUpdates';
import { isTurnActive } from './turnIdentity';
import type { AssistantWebviewAction, AssistantWebviewState } from './types';

export function reduceOptimisticIntent(
  state: AssistantWebviewState,
  action: Exclude<AssistantWebviewAction, { type: 'host.message' }>,
): AssistantWebviewState {
  if (action.type === 'turn.send') {
    if (state.sessionId === null || isTurnActive(state.turn)) {
      return state;
    }
    return boundTranscript(
      {
        ...state,
        turn: { turnId: action.turnId, status: 'submitting' },
        pendingTurnId: action.turnId,
        terminalTurnId: null,
      },
      [
        ...state.transcript,
        {
          // Completion snapshots must retain the same question and virtual row.
          id: stableTranscriptId('user', action.turnId),
          kind: 'user',
          text: action.text,
        },
      ],
    );
  }

  if (action.type === 'git.statusRequested') {
    return {
      ...state,
      git: {
        ...state.git,
        statusPending: true,
        snapshotId: null,
        statusTurnId: action.turnId,
      },
    };
  }

  if (action.type === 'git.commitRequested') {
    return {
      ...state,
      git: {
        ...state.git,
        commitPending: true,
        commitTurnId: action.turnId,
        lastResult: null,
      },
    };
  }

  if (action.type === 'queue.add') {
    if (
      state.sessionId === null ||
      state.queue.items.length >= MAX_QUEUED_MESSAGES ||
      state.queue.items.some((item) => item.queueId === action.queueId)
    ) {
      return state;
    }
    return {
      ...state,
      queue: {
        ...state.queue,
        items: [
          ...state.queue.items,
          {
            queueId: action.queueId,
            text: action.text,
            // The host consumes the staged attachments at enqueue
            // time; mirror that projection optimistically.
            attachments: state.attachments.map(({ kind, name, sizeBytes }) => ({
              kind,
              name,
              sizeBytes,
            })),
          },
        ],
      },
      attachments: [],
    };
  }

  if (action.type === 'queue.update') {
    return {
      ...state,
      queue: {
        ...state.queue,
        items: state.queue.items.map((item) =>
          item.queueId === action.queueId ? { ...item, text: action.text } : item,
        ),
      },
    };
  }

  if (action.type === 'queue.remove') {
    const items = state.queue.items.filter((item) => item.queueId !== action.queueId);
    return {
      ...state,
      queue: {
        items,
        paused: items.length === 0 ? null : state.queue.paused,
      },
      queueEditing:
        state.queueEditing?.queueId === action.queueId ? null : state.queueEditing,
    };
  }

  if (action.type === 'queue.promote') {
    const item = state.queue.items.find((entry) => entry.queueId === action.queueId);
    if (item === undefined) {
      return state;
    }
    // Mirrors the host: send-now reorders to the head and doubles as
    // a resume on a paused queue.
    return {
      ...state,
      queue: {
        items: [
          item,
          ...state.queue.items.filter((entry) => entry.queueId !== action.queueId),
        ],
        paused: null,
      },
    };
  }

  if (action.type === 'queue.resume') {
    return { ...state, queue: { ...state.queue, paused: null } };
  }

  if (action.type === 'queue.clear') {
    return {
      ...state,
      queue: EMPTY_SESSION_QUEUE_STATE,
      queueEditing: null,
    };
  }

  if (action.type === 'queue.editBegin') {
    if (!state.queue.items.some((item) => item.queueId === action.queueId)) {
      return state;
    }
    return {
      ...state,
      queueEditing: {
        queueId: action.queueId,
        seq: (state.queueEditing?.seq ?? 0) + 1,
      },
    };
  }

  if (action.type === 'queue.editEnd') {
    return state.queueEditing === null ? state : { ...state, queueEditing: null };
  }

  if (action.type === 'turn.stop') {
    if (
      state.turn === null ||
      (state.turn.status !== 'submitting' && state.turn.status !== 'streaming')
    ) {
      return state;
    }
    return boundTranscript(
      { ...state, turn: { ...state.turn, status: 'stopping' } },
      markActivitiesStopping(state.transcript, state.turn.turnId),
    );
  }
  return state;
}
