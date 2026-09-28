import type { RuntimeEvent } from '../../../runtime/runtimeEvents';
import type { HostToWebviewMessage } from '../../../shared/bridgeMessages';
import { attachUserMessageId, projectHostTranscriptMessage, stableTranscriptId } from '../../recovery/hostTranscriptState';
import { isTranscriptProjection } from '../internals';
import { applySubagentSettlement, projectAssistantDelta, projectSubagentStarted,
  projectThinkingComplete, projectThinkingDelta, projectToolEvent, thinkingSegmentKey } from './turnActivityState';
import type { TurnRuntimeEventPort, TurnTranscriptPort } from './turnFlowPort';
import { recordSpecHandoff } from './specHandoff';
import { emitTurnState, startStreaming } from './turnSettlement';
import { formatTurnErrorMessage } from './turnErrorMessage';

export const RUNTIME_EVENT_ERROR_MESSAGE =
  'Droid reported a runtime error while processing this turn.';

export const ASSISTANT_OUTPUT_TRUNCATED_MESSAGE =
  'Assistant output exceeded the display limit and was truncated.';

export function handleRuntimeEvent(
  ctl: TurnRuntimeEventPort,
  sessionId: string,
  turnId: string,
  event: Exclude<RuntimeEvent, { type: 'turn-complete' }>,
): void {
  if (event.type !== 'thinking-delta') {
    ctl.effects.flushPendingThinking(sessionId, turnId);
  }
  if (ctl.effects.handleMissionRuntimeEvent(event)) return;
  switch (event.type) {
    case 'text-delta': {
      const turn = ctl.turnState.turn;
      if (turn === null) {
        return;
      }
      const result = projectAssistantDelta(turn.activity, event.text);
      turn.activity = result.state;
      if (result.projection === null) {
        return;
      }
      if (result.projection.delta.length > 0) {
        startStreaming(ctl, sessionId, turnId);
        ctl.emit({
          type: 'assistant.delta',
          sessionId,
          turnId,
          delta: result.projection.delta,
          timestamp: Date.now(),
        });
      }
      if (result.projection.truncated) {
        ctl.emit({
          type: 'runtime.diagnostic',
          sessionId,
          turnId,
          severity: 'warning',
          code: 'assistant-output-truncated',
          message: ASSISTANT_OUTPUT_TRUNCATED_MESSAGE,
        });
      }
      return;
    }
    case 'thinking-delta': {
      startStreaming(ctl, sessionId, turnId);
      const turn = ctl.turnState.turn;
      if (turn === null) {
        return;
      }
      const result = projectThinkingDelta(
        turn.activity,
        event.text,
        thinkingSegmentKey(event),
      );
      turn.activity = result.state;
      if (result.projection !== null) {
        ctl.effects.queueThinkingProjection(sessionId, turnId, result.projection);
      }
      return;
    }
    case 'thinking-complete': {
      const turn = ctl.turnState.turn;
      if (turn === null) {
        return;
      }
      const projection = projectThinkingComplete(
        turn.activity,
        thinkingSegmentKey(event),
      );
      if (projection !== null) {
        ctl.emit({
          type: 'thinking.complete',
          sessionId,
          turnId,
          durationMs: event.durationMs,
          segmentIndex: projection.segmentIndex,
        });
      }
      return;
    }
    case 'tool-start':
    case 'tool-progress':
    case 'tool-result':
    case 'tool-execution-phase': {
      startStreaming(ctl, sessionId, turnId);
      const turn = ctl.turnState.turn;
      if (turn === null) {
        return;
      }
      if (event.type !== 'tool-execution-phase') {
        ctl.effects.mirrorExecuteEvent(sessionId, event);
      }
      const result = projectToolEvent(turn.activity, event);
      turn.activity = result.state;
      if (result.projection !== null) {
        ctl.emit({
          type: 'tool.activity',
          sessionId,
          turnId,
          ...result.projection,
        });
      }
      if (event.type === 'tool-result') {
        ctl.effects.recordLiveToolChanges(sessionId, turnId, event.toolUseId);
        ctl.reviewCoordinator?.refreshOperationsTurn(sessionId, turnId);
      }
      // A finished Task dispatch hands off to a child session the
      // stream no longer narrates; sync its row with the subagent
      // ledger so the delegation shows as running mid-turn.
      if (event.type === 'tool-result' && result.projection?.subagent !== undefined) {
        ctl.effects.scheduleLiveSubagentSync(sessionId, turnId);
      }
      return;
    }
    case 'image-block': {
      startStreaming(ctl, sessionId, turnId);
      ctl.emit({
        type: 'transcript.image',
        sessionId,
        turnId,
        item: {
          id: stableTranscriptId(
            'image',
            turnId,
            event.sourceId,
            String(event.blockIndex),
          ),
          kind: 'image',
          turnId,
          origin: event.origin,
          mediaType: event.mediaType,
          data: event.data,
          generated: event.generated,
          byteLength: event.byteLength,
        },
      });
      return;
    }
    case 'user-message': {
      ctl.recoveryState.transcript = attachUserMessageId(
        ctl.recoveryState.transcript,
        turnId,
        event.messageId,
      );
      ctl.effects.retainSentAttachments(turnId, event.messageId);
      ctl.effects.scheduleRecoveryCheckpoint();
      const user = ctl.recoveryState.transcript.transcript.find(
        (item) => item.kind === 'user' && item.id === stableTranscriptId('user', turnId),
      );
      ctl.emit({
        type: 'user.message-meta',
        sessionId,
        turnId,
        messageId: event.messageId,
        ...(user?.kind === 'user' && user.timestamp !== undefined
          ? { timestamp: user.timestamp } : {}),
      });
      return;
    }
    case 'subagent-started': {
      startStreaming(ctl, sessionId, turnId);
      const turn = ctl.turnState.turn;
      if (turn === null) {
        return;
      }
      const result = projectSubagentStarted(turn.activity, event);
      turn.activity = result.state;
      if (result.projection !== null) {
        ctl.emit({
          type: 'tool.activity',
          sessionId,
          turnId,
          ...result.projection,
        });
      }
      return;
    }
    case 'working-state': {
      const turn = ctl.turnState.turn;
      const compacting = event.compacting === true;
      const changed = turn !== null && (turn.compacting === true) !== compacting;
      if (turn !== null) turn.compacting = compacting;
      const submitting = turn?.status === 'submitting';
      if (event.isWorking) {
        startStreaming(ctl, sessionId, turnId);
      }
      if (changed && turn !== null && !(submitting && event.isWorking)) {
        emitTurnState(ctl, sessionId, turnId, turn.status);
      }
      return;
    }
    case 'token-usage':
      // Live cumulative totals are authoritative over any history
      // seed; the CLI pushes a few per turn.
      ctl.effects.updateTokenUsage(sessionId, {
        cumulative: event.cumulative,
      });
      return;
    case 'settings-updated':
      ctl.effects.refreshSettingsAfterRuntimeEvent(sessionId);
      return;
    case 'spec-handoff':
      recordSpecHandoff(ctl, sessionId, turnId, event.implementationSessionId);
      return;
    case 'error': {
      const message = formatTurnErrorMessage(event.message) ?? RUNTIME_EVENT_ERROR_MESSAGE;
      if (ctl.turnState.turn !== null) ctl.turnState.turn.runtimeError = message;
      ctl.emit({
        type: 'runtime.diagnostic',
        sessionId,
        turnId,
        severity: 'error',
        code: 'runtime-event-error',
        message,
      });
      return;
    }
  }
}

export function projectTranscript(ctl: TurnTranscriptPort, message: HostToWebviewMessage): void {
  if (
    ctl.sessionState.sessionId === null ||
    !isTranscriptProjection(message) ||
    message.sessionId !== ctl.sessionState.sessionId
  ) {
    return;
  }
  if (message.type === 'subagent.update' && ctl.turnState.turn?.turnId === message.turnId) {
    // Keep child lifecycle authoritative when late tool events replay this row.
    ctl.turnState.turn.activity = applySubagentSettlement(
      ctl.turnState.turn.activity, message.toolUseId, message.subagent);
  }
  ctl.recoveryState.transcript = projectHostTranscriptMessage(ctl.recoveryState.transcript, message);
  ctl.effects.scheduleRecoveryCheckpoint();
}
