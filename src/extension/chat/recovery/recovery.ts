import type { RecoveryPort } from './recoveryPort';
import { isDeepStrictEqual } from 'node:util';
import type {
  DroidRuntime,
  RuntimeSessionWorkingState,
} from '../../../runtime/DroidRuntime';
import type { SessionHistoryResult } from '../../../runtime/history/SessionHistory';
import { MAX_SESSION_TRANSCRIPT_ITEMS } from '../../../shared/bridgeMessages';
import { type TurnStatus } from '../../../shared/protocol/turns';
import {
  hasExactKeys,
  isExactArray,
  isStrictRecord,
} from '../../../shared/validation/strictValidation';
import type { HostTranscriptState } from '../../recovery/hostTranscriptState';
import { historyWithLocalChanges } from '../../recovery/historyWithLocalChanges';
import { dataValue, parseTranscriptItem } from '../../recovery/sessionRecoveryItems';
import { SESSION_RECOVERY_DEBOUNCE_MS } from '../../recovery/SessionRecoveryStore';
import { delay, isTurnActive } from '../internals';
import { captureSnapshotBeforeInBackground } from '../changes/snapshotCapture';
import { TURN_FAILURE_MESSAGE } from '../turns/turnSettlement';
import { recoveredHistoryForCurrentTurn } from './recoveredHistoryForCurrentTurn';
import { preservePendingRecoveredState, readRecoveredTurnOutcome } from './recoveredTurnOutcome';

export /**
 * Poll cadence for a daemon-side turn recovered after a reload. The
 * read is one in-memory registry RPC over the persistent daemon
 * connection, so a sub-second cadence keeps the completed-result
 * replacement snappy without measurable cost.
 */
const RECOVERED_TURN_POLL_MS = 500;

export const RECOVERY_CHECKPOINT_FAILED_MESSAGE =
  'Droid could not save the current session state.';

export type ActivationCheckpointOutcome = 'saved' | 'stale' | 'failed';

export /**
 * Consecutive `unknown` working-state reads tolerated before a
 * recovered turn fails. `unknown` means the daemon stopped attributing
 * a state to the session (connection loss, registry eviction) — never
 * a clean idle — so persisting it must surface as a failure, not a
 * silent completion.
 */
const RECOVERED_TURN_MAX_UNKNOWN_READS = 3;

const RECOVERED_TURN_UNCONFIRMED_MESSAGE =
  'Droid could not confirm whether the previous reply is still running. Retry to reconnect before sending another message.';

/**
 * History reloads while a recovered turn is still running. Reload
 * after this many working-state polls (~2s) so new assistant text
 * appears without waiting for Stop (live tokens are not re-streamed).
 */
const RECOVERED_TURN_HISTORY_REFRESH_POLLS = 4;

export const RECOVERED_HISTORY_FAILED_MESSAGE =
  'The turn finished in the background, but its result could not be ' +
  'reloaded. Open the session again from History to see it.';

export const RECOVERED_FINAL_HISTORY_TIMEOUT_MS = 10_000;

const RECOVERED_HISTORY_FAILED_CODE = 'recovered-turn-history-failed';

/**
 * Reload reconciliation for a resumed daemon session (A4 basic
 * tier). A daemon-side turn keeps running while the window reloads;
 * this probes the daemon's working state after activation and, when
 * the turn is still live, projects it as a synthesized recovery
 * turn: the transcript tail shows the existing generating indicator
 * and permissions the SDK replayed during resume surface again. The
 * poll loop reloads history every few seconds so growing text
 * appears before idle, then closes the turn once the daemon goes
 * idle with a final history reload (the basic tier does
 * not re-stream tokens). Process sessions resume on a fresh transport;
 * a persisted active reply is interrupted instead of being polled.
 */
export function reconcileDaemonTurn(
  ctl: RecoveryPort,
  runtime: DroidRuntime,
  generation: number,
  sessionId: string,
  cwd: string,
): void {
  const turnId = recoveryTurnId(ctl, generation, sessionId);
  if (!ctl.isCurrentSessionOperation(runtime, generation, sessionId, cwd)) return;
  // Process resume creates a fresh transport, so an old in-flight reply cannot
  // continue there. This capability check distinguishes it from a lost daemon.
  if (runtime.supportsBackgroundTurns?.() === false) {
    ctl.interactions.endTurn(sessionId, turnId);
    if (ctl.turnState.turn?.turnId === turnId && ctl.turnState.turn.recovery === true &&
        isTurnActive(ctl.turnState.turn)) {
      ctl.emitSessionDiagnostic('recovered-process-turn-interrupted',
        'The previous process reply cannot continue after reconnecting. Send another message to continue the conversation.', turnId);
      ctl.effects.setTurnStatus(sessionId, turnId, 'interrupted');
      ctl.emitSnapshot();
      flushRecoveryCheckpointInBackground(ctl);
    }
    return;
  }
  if (typeof runtime.readSessionWorkingState !== 'function') {
    ctl.interactions.endTurn(sessionId, turnId);
    return;
  }
  void (async () => {
    const state = await readInitialRecoveredWorkingState(ctl, runtime, generation, sessionId, cwd);
    if (state === null) return;
    const existingRecoveryTurn =
      ctl.turnState.turn?.turnId === turnId && ctl.turnState.turn.recovery === true
        ? ctl.turnState.turn
        : null;
    if (!ctl.isCurrentSessionOperation(runtime, generation, sessionId, cwd)) return;
    if (ctl.turnState.turn !== null && existingRecoveryTurn === null) {
      if (state === 'idle' && !isTurnActive(ctl.turnState.turn)) {
        ctl.effects.reconnectRecoveredIde(runtime, generation, sessionId, cwd);
      }
      return;
    }
    if (state === 'unknown') {
      // A failed status read says nothing about backend completion. Keep the
      // recovered execution lock and expose Retry without dispatching the queue.
      ctl.sessionState.connection = { status: 'unavailable', message: RECOVERED_TURN_UNCONFIRMED_MESSAGE };
      ctl.emitSessionDiagnostic('recovered-turn-unconfirmed', RECOVERED_TURN_UNCONFIRMED_MESSAGE, turnId);
      ctl.emitSnapshot();
      return;
    }
    const live =
      state === 'running' ||
      state === 'waiting-for-user';
    const failedTurnId = recoveredFailureTurnId(ctl, sessionId);
    if (!live && failedTurnId !== null) {
      ctl.interactions.endTurn(sessionId, turnId);
      ctl.effects.restoreTurn({
        turnId: failedTurnId,
        status: 'failed',
        error: TURN_FAILURE_MESSAGE,
        recovery: true,
      });
      ctl.effects.setSessionRunning(sessionId, false);
      ctl.emitSnapshot();
      if (state === 'idle') ctl.effects.reconnectRecoveredIde(runtime, generation, sessionId, cwd);
      return;
    }
    if (!live) {
      if (
        existingRecoveryTurn !== null &&
        (existingRecoveryTurn.status === 'submitting' ||
          existingRecoveryTurn.status === 'streaming' ||
          existingRecoveryTurn.status === 'stopping')
      ) {
        const settled = await finishRecoveredTurn(
          ctl,
          runtime,
          generation,
          ctl.turnState.turnGeneration,
          sessionId,
          cwd,
          turnId,
          state === 'idle',
        );
        if (settled === 'waiting') await pollRecoveredTurn(
          ctl, runtime, generation, ctl.turnState.turnGeneration, sessionId, cwd, turnId,
        );
      } else {
        ctl.interactions.endTurn(sessionId, turnId);
        if (state === 'idle') ctl.effects.reconnectRecoveredIde(runtime, generation, sessionId, cwd);
      }
      return;
    }

    const turnGeneration = existingRecoveryTurn === null
      ? ctl.effects.beginTurn({ turnId, status: 'streaming', recovery: true })
      : ctl.turnState.turnGeneration;
    if (existingRecoveryTurn === null) {
      void captureSnapshotBeforeInBackground(ctl, sessionId, turnId).then(() => {
        ctl.effects.startLiveChanges(sessionId, turnId);
      });
    } else {
      if (existingRecoveryTurn.status !== 'stopping') existingRecoveryTurn.status = 'streaming';
      ctl.effects.startLiveChanges(sessionId, turnId);
    }
    ctl.recordHost({
      level: 'info',
      name: 'host.reload.turn-recovered',
      attributes: { sessionId, workingState: state },
    });
    // The re-adopted turn owns the running flag again (it may have
    // been set while the session ran detached).
    ctl.effects.setSessionRunning(sessionId, true);
    // The webview adopts a turn from its own send or from a
    // snapshot; the recovery turn exists only host-side, so a
    // snapshot (not a bare turn.state) announces it.
    ctl.emitSnapshot();
    // Interactions replayed during resume were published before the
    // webview knew the recovery turn; publish them again now.
    ctl.interactions.replayPending();

    // Activation already loaded history. Only a live transport handoff needs an
    // immediate catch-up; do not delay the first idle check with a second read.
    if (existingRecoveryTurn?.transportRecovery) {
      await refreshRecoveredTurnTranscript(ctl, runtime, generation, turnGeneration, sessionId, cwd, turnId);
    }

    await pollRecoveredTurn(
      ctl,
      runtime,
      generation,
      turnGeneration,
      sessionId,
      cwd,
      turnId,
    );
  })();
}

async function readInitialRecoveredWorkingState(
  ctl: RecoveryPort,
  runtime: DroidRuntime,
  generation: number,
  sessionId: string,
  cwd: string,
): Promise<RuntimeSessionWorkingState | null> {
  for (let attempt = 0; attempt < RECOVERED_TURN_MAX_UNKNOWN_READS; attempt += 1) {
    if (attempt > 0) await delay(RECOVERED_TURN_POLL_MS);
    if (!ctl.isCurrentSessionOperation(runtime, generation, sessionId, cwd)) return null;
    let state: RuntimeSessionWorkingState;
    try {
      state = preservePendingRecoveredState(ctl, sessionId, await runtime.readSessionWorkingState!());
    } catch {
      state = 'unknown';
    }
    if (!ctl.isCurrentSessionOperation(runtime, generation, sessionId, cwd)) return null;
    if (state !== 'unknown') return state;
  }
  return 'unknown';
}

/**
 * Watches a recovered daemon-side turn until the daemon reports the
 * session idle, periodically reloading history so growing text
 * appears, then swaps the placeholder for the persisted result.
 * Repeated `unknown` reads fail the turn (fail closed: the daemon
 * lost track of the session, so the result may never arrive).
 */
export async function pollRecoveredTurn(
  ctl: RecoveryPort,
  runtime: DroidRuntime,
  runtimeGeneration: number,
  turnGeneration: number,
  sessionId: string,
  cwd: string,
  turnId: string,
): Promise<void> {
  let unknownReads = 0;
  let pollsSinceHistoryRefresh = 0;
  while (true) {
    await delay(RECOVERED_TURN_POLL_MS);
    if (
      !ctl.effects.isCurrentTurn(
        runtime,
        runtimeGeneration,
        turnGeneration,
        sessionId,
        turnId,
      )
    ) {
      return;
    }
    let state: RuntimeSessionWorkingState;
    try {
      state = preservePendingRecoveredState(ctl, sessionId, await runtime.readSessionWorkingState!());
    } catch {
      state = 'unknown';
    }
    if (
      !ctl.effects.isCurrentTurn(
        runtime,
        runtimeGeneration,
        turnGeneration,
        sessionId,
        turnId,
      )
    ) {
      return;
    }
    if (state === 'unknown') {
      unknownReads += 1;
      if (unknownReads >= RECOVERED_TURN_MAX_UNKNOWN_READS) {
        ctl.turnState.turn?.transportRecovery?.dispose();
        ctl.effects.failTurn(sessionId, turnId, 'recovered-turn-lost');
        return;
      }
      continue;
    }
    unknownReads = 0;
    if (state === 'idle') {
      const settled = await finishRecoveredTurn(
        ctl,
        runtime,
        runtimeGeneration,
        turnGeneration,
        sessionId,
        cwd,
        turnId,
        true,
      );
      if (settled !== 'waiting') return;
      continue;
    }
    pollsSinceHistoryRefresh += 1;
    if (pollsSinceHistoryRefresh >= RECOVERED_TURN_HISTORY_REFRESH_POLLS) {
      pollsSinceHistoryRefresh = 0;
      await refreshRecoveredTurnTranscript(
        ctl,
        runtime,
        runtimeGeneration,
        turnGeneration,
        sessionId,
        cwd,
        turnId,
      );
    }
  }
}

/**
 * Pulls persisted history into the live recovered transcript so the
 * webview shows growing results while the daemon is still running.
 */
async function refreshRecoveredTurnTranscript(
  ctl: RecoveryPort,
  runtime: DroidRuntime,
  runtimeGeneration: number,
  turnGeneration: number,
  sessionId: string,
  cwd: string,
  turnId: string,
): Promise<void> {
  const previous = ctl.recoveryState.transcript.transcript;
  const loaded = await loadBoundedRecoveryHistory(ctl, cwd, sessionId);
  if (
    !ctl.effects.isCurrentTurn(
      runtime,
      runtimeGeneration,
      turnGeneration,
      sessionId,
      turnId,
    ) ||
    loaded?.status !== 'available'
  ) {
    return;
  }
  const next = recoveredHistoryForCurrentTurn(ctl, historyWithLocalChanges(loaded.state,
    ctl.sessionState.conversationId === null ? undefined :
      ctl.recoveryStore.readConversation(ctl.sessionState.conversationId),
    ctl.recoveryState.transcript.transcript), loaded.messageAncestry);
  if (!recoveredTranscriptAdvanced(previous, next.transcript)) {
    return;
  }
  ctl.recoveryState.transcript = next;
  ctl.emitSnapshot();
}

function recoveredTranscriptAdvanced(
  previous: readonly {
    readonly id: string;
    readonly kind: string;
    readonly text?: string;
  }[],
  next: readonly { readonly id: string; readonly kind: string; readonly text?: string }[],
): boolean {
  // Tool status, output and pending interaction changes can keep both ids and
  // transcript length unchanged. They still need to reach a recovered view.
  return !isDeepStrictEqual(previous, next);
}

/**
 * Terminal step of a recovered turn: the daemon went idle, so the
 * completed content now lives in the session file. Reload it and
 * reconcile against the live transcript so the generating
 * placeholder is replaced by the full result in one snapshot.
 */
export async function finishRecoveredTurn(
  ctl: RecoveryPort,
  runtime: DroidRuntime,
  runtimeGeneration: number,
  turnGeneration: number,
  sessionId: string,
  cwd: string,
  turnId: string,
  confirmedIdle: boolean,
): Promise<'waiting' | void> {
  const recovering = ctl.turnState.turn;
  if (recovering === null || recovering.turnId !== turnId) return;
  const outcome = await readRecoveredTurnOutcome(runtime, recovering);
  if (!ctl.effects.isCurrentTurn(runtime, runtimeGeneration, turnGeneration, sessionId, turnId)) return;
  // Loading the exact outcome can restore a pending approval that the registry
  // did not report. Keep that request answerable and resume polling afterwards.
  if (outcome.status !== 'confirmed' && recovering.status !== 'stopping' &&
      preservePendingRecoveredState(ctl, sessionId, 'idle') === 'waiting-for-user') {
    ctl.interactions.replayPending();
    return 'waiting';
  }
  const loaded = await loadBoundedRecoveryHistory(ctl, cwd, sessionId);
  if (
    !ctl.effects.isCurrentTurn(
      runtime,
      runtimeGeneration,
      turnGeneration,
      sessionId,
      turnId,
    )
  ) {
    return;
  }
  // Stop pressed while the history loaded still ends as interrupted.
  const interrupted = ctl.turnState.turn?.status === 'stopping';
  ctl.interactions.endTurn(sessionId, turnId);
  if (isFinalRecoveredHistory(loaded)) {
    ctl.missionState.mission = loaded.mission ?? null;
    ctl.metadata.tokenUsage = {
      cumulative: loaded.tokenUsage ?? ctl.metadata.tokenUsage.cumulative,
      lastTurn: ctl.metadata.tokenUsage.lastTurn,
    };
    ctl.recoveryState.transcript = recoveredHistoryForCurrentTurn(ctl, historyWithLocalChanges(loaded.state,
      ctl.sessionState.conversationId === null ? undefined :
        ctl.recoveryStore.readConversation(ctl.sessionState.conversationId),
      ctl.recoveryState.transcript.transcript), loaded.messageAncestry);
  } else if (!interrupted) {
    ctl.effects.failTurn(
      sessionId,
      turnId,
      RECOVERED_HISTORY_FAILED_CODE,
      RECOVERED_HISTORY_FAILED_MESSAGE,
    );
    ctl.emitSnapshot();
    flushRecoveryCheckpointInBackground(ctl);
    return;
  }
  const transportRecovery = ctl.turnState.turn?.transportRecovery;
  transportRecovery?.dispose();
  if (outcome.status === 'confirmed' && !interrupted) {
    ctl.effects.handleTurnComplete(sessionId, turnId, outcome.completion);
  } else if (outcome.status === 'unconfirmed' && !interrupted) {
    ctl.effects.failTurn(sessionId, turnId, 'recovered-turn-outcome-unconfirmed',
      'The conversation was restored, but this reply’s final result could not be confirmed.');
  } else {
    if (transportRecovery && !interrupted) ctl.emit({
      type: 'runtime.diagnostic', sessionId, turnId, severity: 'info',
      code: 'transport-recovered-outcome-unconfirmed',
      message: 'The connection and session history were restored. This turn has ended, but its completion status was not received.',
    });
    if (transportRecovery) ctl.effects.publishTurnChanges(sessionId, turnId, interrupted ? 'interrupted' : 'completed');
    ctl.effects.setTurnStatus(sessionId, turnId, interrupted ? 'interrupted' : 'completed');
  }
  ctl.emitSnapshot();
  flushRecoveryCheckpointInBackground(ctl);
  ctl.effects.refreshContextAfterTurn(sessionId);
  if (confirmedIdle) ctl.effects.reconnectRecoveredIde(runtime, runtimeGeneration, sessionId, cwd);
}

async function loadBoundedRecoveryHistory(
  ctl: RecoveryPort,
  cwd: string,
  sessionId: string,
): Promise<SessionHistoryResult | null> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      ctl.effects.loadHistoryTimed(cwd, sessionId),
      new Promise<null>((resolve) => {
        timeout = setTimeout(() => resolve(null), RECOVERED_FINAL_HISTORY_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeout !== null) {
      clearTimeout(timeout);
    }
  }
}

function isFinalRecoveredHistory(
  loaded: unknown,
): loaded is Extract<SessionHistoryResult, { status: 'available' }> {
  if (!isStrictRecord(loaded) || dataValue(loaded, 'status') !== 'available') {
    return false;
  }
  const state = dataValue(loaded, 'state');
  if (
    !isStrictRecord(state) ||
    !hasExactKeys(state, ['transcript', 'historyStatus', 'truncated']) ||
    dataValue(state, 'historyStatus') !== 'complete' ||
    dataValue(state, 'truncated') !== false
  ) {
    return false;
  }
  const transcript = dataValue(state, 'transcript');
  if (!isExactArray(transcript, 0, MAX_SESSION_TRANSCRIPT_ITEMS)) {
    return false;
  }

  const ids = new Set<string>();
  for (const value of transcript) {
    const item = parseTranscriptItem(value);
    if (item === undefined || ids.has(item.id)) {
      return false;
    }
    ids.add(item.id);
  }
  return true;
}

function recoveredFailureTurnId(ctl: RecoveryPort, sessionId: string): string | null {
  const conversationId = ctl.recoveryStore.resolveConversationId(sessionId);
  const turn = conversationId === undefined ? undefined : ctl.recoveryStore.readDisplay(conversationId)?.turn;
  return turn?.status === 'failed' ? turn.turnId : null;
}

export function scheduleRecoveryCheckpoint(ctl: RecoveryPort): void {
  const sessionId = ctl.sessionState.sessionId;
  const conversationId = ctl.sessionState.conversationId;
  if (sessionId === null || conversationId === null) {
    return;
  }
  ctl.recoveryState.pendingRecoveryCheckpoint = {
    conversationId,
    sessionId,
  };
  if (ctl.recoveryState.recoveryCheckpointTimer !== null) {
    return;
  }
  ctl.recoveryState.recoveryCheckpointTimer = setTimeout(() => {
    ctl.recoveryState.recoveryCheckpointTimer = null;
    const checkpoint = ctl.recoveryState.pendingRecoveryCheckpoint;
    ctl.recoveryState.pendingRecoveryCheckpoint = null;
    if (checkpoint) {
      ctl.recoveryStore.writeActiveDisplay(
        checkpoint.conversationId,
        checkpoint.sessionId,
        ctl.recoveryState.transcript,
        displayTurn(ctl),
      );
    }
  }, SESSION_RECOVERY_DEBOUNCE_MS);
}

export function checkpointRecoveryTranscript(ctl: RecoveryPort): void {
  if (ctl.recoveryState.recoveryCheckpointTimer !== null) {
    clearTimeout(ctl.recoveryState.recoveryCheckpointTimer);
    ctl.recoveryState.recoveryCheckpointTimer = null;
  }
  ctl.recoveryState.pendingRecoveryCheckpoint = null;
  if (ctl.sessionState.sessionId !== null && ctl.sessionState.conversationId !== null) {
    ctl.recoveryStore.writeActiveDisplay(
      ctl.sessionState.conversationId,
      ctl.sessionState.sessionId,
      ctl.recoveryState.transcript,
      displayTurn(ctl),
    );
  }
}

export function flushRecoveryCheckpoint(ctl: RecoveryPort): Promise<void> {
  checkpointRecoveryTranscript(ctl);
  return ctl.recoveryStore.flush();
}

export function flushRecoveryCheckpointInBackground(ctl: RecoveryPort): void {
  checkpointRecoveryTranscript(ctl);
  ctl.recoveryStore.flushInBackground();
}

export function reportRecoveryCheckpointFailure(ctl: RecoveryPort): void {
  ctl.emitSessionDiagnostic(
    'recovery-checkpoint-failed',
    RECOVERY_CHECKPOINT_FAILED_MESSAGE,
  );
}

export function markRecoveryCheckpointUnavailable(
  ctl: RecoveryPort,
  message: string,
): void {
  ctl.sessionState.connection = { status: 'unavailable', message };
  reportRecoveryCheckpointFailure(ctl);
  ctl.emitSnapshot();
}

export async function flushRecoveryCheckpointOrReport(
  ctl: RecoveryPort,
): Promise<boolean> {
  try {
    await flushRecoveryCheckpoint(ctl);
    return true;
  } catch {
    reportRecoveryCheckpointFailure(ctl);
    return false;
  }
}

export async function persistActivationRecoveryCheckpoint(
  ctl: RecoveryPort,
  sessionId: string,
  transcript: HostTranscriptState,
  turn: {
    readonly turnId: string;
    readonly backendTurnId?: string;
    readonly status: TurnStatus;
    readonly error?: string;
  } | null,
  isCurrent: () => boolean,
): Promise<ActivationCheckpointOutcome> {
  let conversationId = ctl.recoveryStore.resolveConversationId(sessionId);
  if (conversationId === undefined) {
    conversationId = ctl.recoveryStore.createConversation(sessionId, transcript);
  }
  const accepted =
    conversationId !== undefined &&
    ctl.recoveryStore.writeActiveDisplay(conversationId, sessionId, transcript, turn);
  if (!accepted) {
    ctl.recordHost({
      level: 'warn',
      name: 'host.recovery.checkpoint-rejected',
      attributes: {
        sessionId,
        items: transcript.transcript.length,
        historyStatus: transcript.historyStatus,
      },
    });
    return 'failed';
  }
  const previousSelectedConversationId = ctl.recoveryStore.getSelectedConversationId();
  try {
    await ctl.recoveryStore.flush();
  } catch (error) {
    ctl.recordHost({
      level: 'error', name: 'host.recovery.metadata-write-failed',
      attributes: { sessionId, phase: 'checkpoint' },
      detail: error instanceof Error ? error.message : 'Unknown metadata persistence failure',
    });
    return 'failed';
  }
  if (!isCurrent()) {
    return 'stale';
  }
  if (conversationId === undefined) {
    return 'failed';
  }
  ctl.recoveryStore.selectConversation(conversationId);
  try {
    await ctl.recoveryStore.flush();
  } catch (error) {
    ctl.recordHost({
      level: 'error', name: 'host.recovery.metadata-write-failed',
      attributes: { sessionId, phase: 'selection' },
      detail: error instanceof Error ? error.message : 'Unknown metadata persistence failure',
    });
    ctl.recoveryStore.selectConversation(previousSelectedConversationId);
    return 'failed';
  }
  return isCurrent() ? 'saved' : 'stale';
}

function displayTurn(ctl: RecoveryPort): {
  readonly turnId: string;
  readonly backendTurnId?: string;
  readonly status: TurnStatus;
  readonly error?: string;
} | null {
  return ctl.turnState.turn === null
    ? null
    : {
        turnId: ctl.turnState.turn.turnId,
        ...(ctl.turnState.turn.backendTurnId === undefined ? {} : { backendTurnId: ctl.turnState.turn.backendTurnId }),
        status: ctl.turnState.turn.status,
        ...(ctl.turnState.turn.error === undefined
          ? {}
          : { error: ctl.turnState.turn.error }),
      };
}

export /**
 * Turn id synthesized for a daemon turn recovered after a reload. The
 * runtime generation is unique per activation, so recovery turns never
 * collide with each other or with webview-generated turn ids.
 */
function recoveryTurnId(
  ctl: RecoveryPort,
  generation: number,
  sessionId: string,
): string {
  if (ctl.turnState.turn?.recovery && ctl.turnState.turn.transportRecovery)
    return ctl.turnState.turn.turnId;
  const conversationId = ctl.recoveryStore.resolveConversationId(sessionId);
  const turn =
    conversationId === undefined
      ? undefined
      : ctl.recoveryStore.readDisplay(conversationId)?.turn;
  return turn !== undefined &&
    turn !== null &&
    (turn.status === 'submitting' ||
      turn.status === 'streaming' ||
      turn.status === 'stopping')
    ? turn.turnId
    : `recovery-${generation}`;
}
