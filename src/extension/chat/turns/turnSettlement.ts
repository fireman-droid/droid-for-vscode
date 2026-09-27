import type { RuntimeEvent } from '../../../runtime/runtimeEvents';
import type { TurnStatus } from '../../../shared/protocol/turns';
import { isTurnActive } from '../internals';
import type { TurnCompletionPort, TurnFailurePort, TurnStopPort, TurnStatusPort, TurnContextPort } from './turnFlowPort';
import { isCurrentTurn } from './turnIdentity';
import { finishSpecHandoff } from './specHandoff';
import { STOP_TIMEOUT_MESSAGE } from './turnWatchdog';

export const TURN_FAILURE_MESSAGE = 'Droid could not complete this turn. Retry to start a fresh session.';

export function handleTurnComplete(
  ctl: TurnCompletionPort,
  sessionId: string,
  turnId: string,
  event: Extract<RuntimeEvent, { type: 'turn-complete' }>,
): void {
  ctl.interactions.endTurn(sessionId, turnId);
  ctl.terminalMirror?.settleAll();
  if (event.turnUsage !== undefined) {
    // Per-turn consumption regardless of outcome; interrupted and
    // failed turns still burned tokens.
    ctl.effects.updateTokenUsage(sessionId, { lastTurn: event.turnUsage });
  }
  switch (event.outcome) {
    case 'success':
      ctl.effects.publishTurnChanges(sessionId, turnId, 'completed');
      setTurnStatus(ctl, sessionId, turnId, 'completed');
      ctl.effects.settleTurnSubagents(sessionId, turnId);
      refreshContextAfterTurn(ctl, sessionId);
      finishSpecHandoff(ctl, sessionId, turnId);
      return;
    case 'interrupted':
      ctl.effects.publishTurnChanges(sessionId, turnId, 'interrupted');
      setTurnStatus(ctl, sessionId, turnId, 'interrupted');
      ctl.effects.settleTurnSubagents(sessionId, turnId);
      refreshContextAfterTurn(ctl, sessionId);
      finishSpecHandoff(ctl, sessionId, turnId);
      return;
    case 'error_during_execution':
      ctl.turnState.specHandoff = null;
      failTurn(ctl, sessionId, turnId, 'runtime-execution-failed');
      return;
    case 'error_structured_output':
      ctl.turnState.specHandoff = null;
      failTurn(ctl, sessionId, turnId, 'runtime-structured-output-failed');
      return;
  }
}

export function handleStop(ctl: TurnStopPort, sessionId: string, turnId: string): void {
  const runtime = ctl.sessionState.runtime;
  if (runtime !== null && !ctl.effects.ensureActiveRuntimeWorkspaceCurrent()) {
    return;
  }
  if (
    runtime === null ||
    sessionId !== ctl.sessionState.sessionId ||
    ctl.turnState.turn?.turnId !== turnId ||
    (ctl.turnState.turn.status !== 'submitting' &&
      ctl.turnState.turn.status !== 'streaming' &&
      ctl.turnState.turn.status !== 'stopping')
  ) {
    return;
  }

  const turnGeneration = ctl.turnState.turnGeneration;
  if (ctl.turnState.stopRequestGeneration === turnGeneration) return;
  ctl.turnState.stopRequestGeneration = turnGeneration;

  // A recovery turn runs daemon-side with no locally streaming turn;
  // interrupt() would no-op there, interruptSession() reaches the
  // daemon. The poll loop then observes idle and settles the turn.
  const interruptTurn =
    ctl.turnState.turn.recovery === true && typeof runtime.interruptSession === 'function'
      ? () => runtime.interruptSession!()
      : () => runtime.interrupt();
  ctl.effects.flushPendingThinking(sessionId, turnId);
  ctl.interactions.endTurn(sessionId, turnId);
  setTurnStatus(ctl, sessionId, turnId, 'stopping');
  ctl.effects.markStopRequested(sessionId, turnId); // stop-settle deadline (#32)
  const runtimeGeneration = ctl.sessionState.runtimeGeneration;
  void interruptTurn().catch(() => {
    if (
      isCurrentTurn(ctl, runtime, runtimeGeneration, turnGeneration, sessionId, turnId)
    ) {
      // Rejection does not establish that the backend stopped. Keep the
      // execution lock and watchdog until the stream releases ownership.
      ctl.emit({
        type: 'runtime.diagnostic', sessionId, turnId, severity: 'warning',
        code: 'turn-stop-unconfirmed', message: STOP_TIMEOUT_MESSAGE,
      });
    }
  }).finally(() => {
    if (ctl.turnState.stopRequestGeneration === turnGeneration) {
      ctl.turnState.stopRequestGeneration = null;
    }
  });
}

export function failTurn(
  ctl: TurnFailurePort,
  sessionId: string,
  turnId: string,
  code: string,
): void {
  ctl.effects.flushPendingThinking(sessionId, turnId);
  if (ctl.turnState.turn?.turnId !== turnId) {
    return;
  }

  if (ctl.turnState.specHandoff?.turnId === turnId) {
    ctl.turnState.specHandoff = null;
  }
  ctl.interactions.endTurn(sessionId, turnId);
  ctl.terminalMirror?.settleAll();
  ctl.turnState.turn.changesLedger?.cancel();
  ctl.turnState.turn.transportRecovery?.dispose();
  ctl.effects.publishTurnChanges(sessionId, turnId, 'failed');
  ctl.turnState.turn.status = 'failed';
  ctl.turnState.turn.compacting = false;
  ctl.turnState.turn.error = TURN_FAILURE_MESSAGE;
  ctl.emit({
    type: 'turn.error',
    sessionId,
    turnId,
    code,
    message: TURN_FAILURE_MESSAGE,
    retryable: true,
  });
  emitTurnState(ctl, sessionId, turnId, 'failed');
  refreshContextAfterTurn(ctl, sessionId);
}

export function setTurnStatus(
  ctl: TurnStatusPort,
  sessionId: string,
  turnId: string,
  status: TurnStatus,
): void {
  if (ctl.turnState.turn?.turnId !== turnId) {
    return;
  }

  ctl.turnState.turn.status = status;
  if (!isTurnActive(ctl.turnState.turn)) ctl.turnState.turn.compacting = false;
  emitTurnState(ctl, sessionId, turnId, status);
}

export function startStreaming(
  ctl: TurnStatusPort,
  sessionId: string,
  turnId: string,
): void {
  if (ctl.turnState.turn?.status === 'submitting') {
    setTurnStatus(ctl, sessionId, turnId, 'streaming');
  }
}

export function emitTurnState(
  ctl: TurnStatusPort,
  sessionId: string,
  turnId: string,
  status: TurnStatus,
): void {
  ctl.emit({
    type: 'turn.state',
    sessionId,
    turnId,
    status,
    ...(ctl.turnState.turn?.compacting === true ? { compacting: true } : {}),
  });
  ctl.recordHost({
    level: 'debug',
    name: 'host.turn.state',
    attributes: { status },
  });
  if (status === 'completed' || status === 'interrupted' || status === 'failed') {
    ctl.effects.clearTurnWatchdog();
    flushTurnIo(ctl);
    ctl.diagnostics?.endTurnScope?.();
    ctl.effects.settleQueueAfterTurn(sessionId, turnId, status);
    // Every terminal outcome clears the running indicator at once.
    ctl.effects.setSessionRunning(sessionId, false);
  } else {
    ctl.effects.setSessionRunning(sessionId, true);
  }
}

/** Emits the per-turn outbound Bridge message accounting (P5). */
export function flushTurnIo(ctl: TurnStatusPort): void {
  const io = ctl.turnState.turnIo;
  ctl.turnState.turnIo = null;
  if (io === null) {
    return;
  }
  const attributes: Record<string, number> = {
    bytesOut: io.bytes,
    messagesOut: [...io.counts.values()].reduce((sum, count) => sum + count, 0),
  };
  for (const [type, count] of io.counts) {
    attributes[`n_${type.replaceAll('.', '_')}`] = count;
  }
  ctl.recordHost({
    level: 'debug',
    name: 'host.perf.turn-io',
    attributes,
  });
}

export function refreshContextAfterTurn(ctl: TurnContextPort, sessionId: string): void {
  if (
    ctl.sessionState.runtime !== null &&
    ctl.sessionState.activeRuntimeCwd !== null &&
    ctl.sessionState.sessionId === sessionId &&
    ctl.sessionState.connection.status === 'connected'
  ) {
    ctl.effects.refreshContext(
      ctl.sessionState.runtime,
      ctl.sessionState.runtimeGeneration,
      sessionId,
      ctl.sessionState.activeRuntimeCwd,
    );
  }
}
