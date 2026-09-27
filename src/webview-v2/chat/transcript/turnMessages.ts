import { MAX_IMAGES_PER_TURN } from '../../../shared/protocol/bounds';
import { TURN_SEND_REJECTED_CODE } from '../../../shared/protocol/turns';
import { isTransientRuntimeDiagnostic } from '../../../shared/protocol/transientDiagnostics';
import { stableTranscriptId } from '../../../shared/transcript/hostTranscriptState';
import { reconcileChangesTranscript } from '../../review/storeChanges';
import {
  acceptsActiveTurn,
  acceptsDiagnostic,
  acceptsTurnError,
  advance,
  isTerminalStatus,
  matchesTurn,
} from '../../state/turnIdentity';
import type { AssistantWebviewState, StoreHostMessage } from '../../state/types';
import { upsertTool } from './toolTranscript';
import {
  appendAssistantDelta,
  appendDiagnostic,
  appendThinkingDelta,
  boundTranscript,
  finalizeActivities,
  thinkingSegmentItemId,
} from './transcriptUpdates';

export function reduceTurnsMessage(
  state: AssistantWebviewState,
  event: Extract<
    StoreHostMessage,
    {
      type:
        | 'assistant.delta'
        | 'thinking.delta'
        | 'thinking.complete'
        | 'tool.activity'
        | 'subagent.update'
        | 'transcript.image'
        | 'changes.update'
        | 'runtime.diagnostic'
        | 'user.message-meta'
        | 'turn.state'
        | 'turn.error';
    }
  >,
): AssistantWebviewState {
  switch (event.type) {
    case 'assistant.delta':
      if (!acceptsActiveTurn(state, event.sessionId, event.turnId)) {
        return advance(state, event.sequence);
      }
      return boundTranscript(
        {
          ...state,
          sequence: event.sequence,
          turn: {
            ...state.turn,
            status: 'streaming',
            activity: 'responding',
          },
        },
        appendAssistantDelta(state.transcript, event.turnId, event.delta, event.sequence, event.timestamp),
      );

    case 'thinking.delta':
      if (!acceptsActiveTurn(state, event.sessionId, event.turnId)) {
        return advance(state, event.sequence);
      }
      return boundTranscript(
        {
          ...state,
          sequence: event.sequence,
          turn: {
            ...state.turn,
            status: 'streaming',
            activity: 'working',
          },
        },
        appendThinkingDelta(
          state.transcript,
          event.turnId,
          event.delta,
          event.truncated,
          event.segmentIndex,
        ),
      );

    case 'thinking.complete':
      if (!acceptsActiveTurn(state, event.sessionId, event.turnId)) {
        return advance(state, event.sequence);
      }
      return boundTranscript(
        { ...state, sequence: event.sequence },
        state.transcript.map((item) =>
          item.kind === 'thinking' &&
          item.id === thinkingSegmentItemId(event.turnId, event.segmentIndex)
            ? {
                ...item,
                status: 'complete',
                ...(event.durationMs === null ? {} : { durationMs: event.durationMs }),
              }
            : item,
        ),
      );

    case 'tool.activity':
      if (!acceptsActiveTurn(state, event.sessionId, event.turnId)) {
        return advance(state, event.sequence);
      }
      return boundTranscript(
        {
          ...state,
          sequence: event.sequence,
          turn: {
            ...state.turn,
            status: 'streaming',
            activity: 'working',
          },
        },
        upsertTool(state.transcript, event),
      );

    case 'subagent.update':
      // Out-of-band settlement of a background delegation: lands
      // after its turn reached a terminal state, so it deliberately
      // bypasses acceptsActiveTurn. Only the addressed row's
      // subagent field may change; everything else is immutable.
      if (event.sessionId !== state.sessionId) {
        return advance(state, event.sequence);
      }
      return {
        ...advance(state, event.sequence),
        transcript: state.transcript.map((item) =>
          item.kind === 'tool' &&
          item.turnId === event.turnId &&
          item.toolUseId === event.toolUseId &&
          item.subagent !== undefined
            ? { ...item, subagent: event.subagent }
            : item,
        ),
      };

    case 'transcript.image': {
      if (!acceptsActiveTurn(state, event.sessionId, event.turnId)) {
        return advance(state, event.sequence);
      }
      if (
        state.transcript.some((item) => item.id === event.item.id) ||
        state.transcript.filter(
          (item) => item.kind === 'image' && item.turnId === event.turnId,
        ).length >= MAX_IMAGES_PER_TURN
      ) {
        return advance(state, event.sequence);
      }
      return boundTranscript({ ...state, sequence: event.sequence }, [
        ...state.transcript,
        event.item,
      ]);
    }

    case 'changes.update': {
      // `writing` frames belong to the live turn only; the `settled`
      // reconciliation lands after the turn reached a terminal state
      // and therefore only gates on the session.
      if (
        event.state === 'writing'
          ? !acceptsActiveTurn(state, event.sessionId, event.turnId)
          : event.sessionId !== state.sessionId
      ) {
        return advance(state, event.sequence);
      }
      return boundTranscript(
        { ...state, sequence: event.sequence },
        reconcileChangesTranscript(state.transcript, event),
      );
    }

    case 'runtime.diagnostic':
      if (
        !acceptsDiagnostic(state, event.sessionId, event.turnId) ||
        isTransientRuntimeDiagnostic(event.code)
      ) {
        return advance(state, event.sequence);
      }
      return boundTranscript(
        { ...state, sequence: event.sequence },
        appendDiagnostic(state.transcript, {
          id: `diagnostic:${event.sequence}`,
          kind: 'diagnostic',
          turnId: event.turnId,
          severity: event.severity,
          code: event.code,
          message: event.message,
          ...(event.relatedSessionId === undefined
            ? {}
            : { relatedSessionId: event.relatedSessionId }),
        }),
      );

    case 'user.message-meta': {
      if (event.sessionId !== state.sessionId) {
        return advance(state, event.sequence);
      }
      // New sends and Host snapshots share the stable id; retain lookup of
      // legacy optimistic prompts already held by a live client.
      const promptIds = new Set([
        `user:${event.turnId}`,
        stableTranscriptId('user', event.turnId),
      ]);
      const index = state.transcript.findIndex(
        (item) => item.kind === 'user' && promptIds.has(item.id),
      );
      const item = state.transcript[index];
      if (
        item === undefined ||
        item.kind !== 'user' ||
        (item.messageId === event.messageId && (event.timestamp === undefined || item.timestamp === event.timestamp))
      ) {
        return advance(state, event.sequence);
      }
      return {
        ...state,
        sequence: event.sequence,
        transcript: state.transcript.map((entry, entryIndex) =>
          entryIndex === index ? { ...item, messageId: event.messageId,
            ...(event.timestamp === undefined ? {} : { timestamp: event.timestamp }) } : entry,
        ),
      };
    }

    case 'turn.state':
      if (event.sessionId !== state.sessionId) {
        return advance(state, event.sequence);
      }
      const turnStateBase: AssistantWebviewState = {
        ...state,
        sequence: event.sequence,
        terminalTurnId: isTerminalStatus(event.status)
          ? event.turnId
          : state.terminalTurnId === event.turnId
            ? state.terminalTurnId
            : null,
        interactions: isTerminalStatus(event.status)
          ? state.interactions.filter(
              (interaction) => interaction.turnId !== event.turnId,
            )
          : state.interactions,
      };
      if (!matchesTurn(state, event.sessionId, event.turnId)) {
        return turnStateBase;
      }
      if (
        (state.turn.status === 'stopping' || isTerminalStatus(state.turn.status)) &&
        !isTerminalStatus(event.status)
      ) {
        return turnStateBase;
      }
      return boundTranscript(
        {
          ...turnStateBase,
          turn: { ...state.turn, status: event.status, compacting: !isTerminalStatus(event.status) && event.compacting === true },
        },
        isTerminalStatus(event.status)
          ? finalizeActivities(state.transcript, event.turnId, event.status)
          : state.transcript,
      );

    case 'turn.error':
      if (event.sessionId !== state.sessionId ||
        (event.code === TURN_SEND_REJECTED_CODE && !matchesTurn(state, event.sessionId, event.turnId))) {
        return advance(state, event.sequence);
      }
      const turnErrorBase: AssistantWebviewState = {
        ...state,
        sequence: event.sequence,
        terminalTurnId: event.turnId,
        interactions: state.interactions.filter(
          (interaction) => interaction.turnId !== event.turnId,
        ),
      };
      if (!acceptsTurnError(state, event.sessionId, event.turnId)) {
        return turnErrorBase;
      }
      return boundTranscript(
        {
          ...turnErrorBase,
          turn: {
            turnId: event.turnId,
            status: 'failed',
            error: event.message,
          },
        },
        appendDiagnostic(finalizeActivities(state.transcript, event.turnId, 'failed'), {
          id: `diagnostic:${event.sequence}`,
          kind: 'diagnostic',
          turnId: event.turnId,
          severity: 'error',
          code: event.code,
          message: event.message,
        }),
      );
  }
}
