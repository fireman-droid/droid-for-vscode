// recovery: moved verbatim from ChatController.ts (structure-only
// refactor; bodies unchanged except mechanical this. -> ctl.).
import type {
  DroidRuntime,
  RuntimeSessionWorkingState,
} from '../../runtime/DroidRuntime';
import { createTurnActivityState } from '../turnActivityState';
import { reconcileSessionHistory } from '../reconcileSessionHistory';
import { SESSION_RECOVERY_DEBOUNCE_MS } from '../SessionRecoveryStore';
import { setSessionRunning } from './sessionRunning';
import { loadHistoryTimed } from './runtimeLifecycle';
import {
  failTurn,
  isCurrentTurn,
  refreshContextAfterTurn,
  setTurnStatus,
} from './turnFlow';
import { delay, type ChatControllerInternals } from './internals';

export /**
 * Poll cadence for a daemon-side turn recovered after a reload. The
 * read is one in-memory registry RPC over the persistent daemon
 * connection, so a sub-second cadence keeps the completed-result
 * replacement snappy without measurable cost.
 */
const RECOVERED_TURN_POLL_MS = 500;

export /**
 * Consecutive `unknown` working-state reads tolerated before a
 * recovered turn fails. `unknown` means the daemon stopped attributing
 * a state to the session (connection loss, registry eviction) — never
 * a clean idle — so persisting it must surface as a failure, not a
 * silent completion.
 */
const RECOVERED_TURN_MAX_UNKNOWN_READS = 3;

/**
 * History reloads while a recovered turn is still running. Reload
 * after this many working-state polls (~2s) so new assistant text
 * appears without waiting for Stop (live tokens are not re-streamed).
 */
const RECOVERED_TURN_HISTORY_REFRESH_POLLS = 4;

export const RECOVERED_HISTORY_FAILED_MESSAGE =
  'The turn finished in the background, but its result could not be ' +
  'reloaded. Open the session again from History to see it.';

/**
 * Pushes the locally recovered checkpoint transcript to the webview
 * before the slow catalog/history/runtime activation completes, so a
 * reopened window paints content immediately. The connection stays
 * `connecting`, which keeps every mutating handler rejected until the
 * authoritative activation snapshot replaces this one wholesale.
 */
export function emitEarlyRecoverySnapshot(ctl: ChatControllerInternals): void {
    const sessionId = ctl.recoveryStore.getSelectedSessionId();
    if (sessionId === null) {
      return;
    }
    const checkpoint = ctl.recoveryStore.readSession(sessionId);
    if (
      checkpoint === undefined ||
      checkpoint.transcript.length === 0
    ) {
      return;
    }
    ctl.sessionId = sessionId;
    ctl.transcript = checkpoint;
    ctl.recordHost({
      level: 'info',
      name: 'host.perf.early-snapshot',
      attributes: {
        sessionId,
        items: checkpoint.transcript.length,
      },
    });
    ctl.emitSnapshot();
}

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
 * not re-stream tokens). Process sessions cannot report a working
 * state — the probe throws there — so process-mode recovery is
 * unchanged.
 */
export function reconcileDaemonTurn(
  ctl: ChatControllerInternals,
    runtime: DroidRuntime,
    generation: number,
    sessionId: string,
    cwd: string,
  ): void {
    const turnId = recoveryTurnId(generation);
    if (typeof runtime.readSessionWorkingState !== 'function') {
      ctl.interactions.endTurn(sessionId, turnId);
      return;
    }
    void (async () => {
      let state: RuntimeSessionWorkingState;
      try {
        state = await runtime.readSessionWorkingState!();
      } catch {
        ctl.interactions.endTurn(sessionId, turnId);
        return;
      }
      if (
        !ctl.isCurrentSessionOperation(
          runtime,
          generation,
          sessionId,
          cwd,
        ) ||
        ctl.turn !== null
      ) {
        return;
      }
      // `unknown` with a replayed interaction still means a live turn
      // (the daemon blocked on it before the state read went stale);
      // `unknown` without one has nothing to project, so stay quiet.
      const live =
        state === 'running' ||
        state === 'waiting-for-user' ||
        (state === 'unknown' && ctl.interactions.hasPending());
      if (!live) {
        ctl.interactions.endTurn(sessionId, turnId);
        return;
      }

      const turnGeneration = ++ctl.turnGeneration;
      ctl.diagnostics?.beginTurnScope?.(turnId);
      ctl.turnIo = { counts: new Map(), bytes: 0 };
      ctl.turn = {
        turnId,
        status: 'streaming',
        activity: createTurnActivityState(),
        recovery: true,
      };
      void ctl.turnSnapshots?.capture({ sessionId, turnId }, 'before');
      ctl.recordHost({
        level: 'info',
        name: 'host.reload.turn-recovered',
        attributes: { sessionId, workingState: state },
      });
      // The re-adopted turn owns the running flag again (it may have
      // been set while the session ran detached).
      setSessionRunning(ctl, sessionId, true);
      // The webview adopts a turn from its own send or from a
      // snapshot; the recovery turn exists only host-side, so a
      // snapshot (not a bare turn.state) announces it.
      ctl.emitSnapshot();
      // Interactions replayed during resume were published before the
      // webview knew the recovery turn; publish them again now.
      ctl.interactions.replayPending();

      await pollRecoveredTurn(ctl, 
        runtime,
        generation,
        turnGeneration,
        sessionId,
        cwd,
        turnId,
      );
    })();
}

/**
 * Watches a recovered daemon-side turn until the daemon reports the
 * session idle, periodically reloading history so growing text
 * appears, then swaps the placeholder for the persisted result.
 * Repeated `unknown` reads fail the turn (fail closed: the daemon
 * lost track of the session, so the result may never arrive).
 */
export async function pollRecoveredTurn(
  ctl: ChatControllerInternals,
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
        !isCurrentTurn(ctl, 
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
        state = await runtime.readSessionWorkingState!();
      } catch {
        state = 'unknown';
      }
      if (
        !isCurrentTurn(ctl, 
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
          failTurn(ctl, sessionId, turnId, 'recovered-turn-lost');
          return;
        }
        continue;
      }
      unknownReads = 0;
      if (state === 'idle') {
        await finishRecoveredTurn(ctl, 
          runtime,
          runtimeGeneration,
          turnGeneration,
          sessionId,
          cwd,
          turnId,
        );
        return;
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
  ctl: ChatControllerInternals,
  runtime: DroidRuntime,
  runtimeGeneration: number,
  turnGeneration: number,
  sessionId: string,
  cwd: string,
  turnId: string,
): Promise<void> {
  const previous = ctl.transcript.transcript;
  const loaded = await loadHistoryTimed(ctl, cwd, sessionId);
  if (
    !isCurrentTurn(ctl, 
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
  const next = reconcileSessionHistory(loaded.state, ctl.transcript);
  if (!recoveredTranscriptAdvanced(previous, next.transcript)) {
    return;
  }
  ctl.transcript = next;
  ctl.emitSnapshot();
}

function recoveredTranscriptAdvanced(
  previous: readonly { readonly id: string; readonly kind: string; readonly text?: string }[],
  next: readonly { readonly id: string; readonly kind: string; readonly text?: string }[],
): boolean {
  if (next.length !== previous.length) {
    return true;
  }
  const prevLast = previous.at(-1);
  const nextLast = next.at(-1);
  if (prevLast?.id !== nextLast?.id) {
    return true;
  }
  if (
    prevLast?.kind === 'assistant' &&
    nextLast?.kind === 'assistant'
  ) {
    return (nextLast.text?.length ?? 0) > (prevLast.text?.length ?? 0);
  }
  return false;
}

/**
 * Terminal step of a recovered turn: the daemon went idle, so the
 * completed content now lives in the session file. Reload it and
 * reconcile against the live transcript so the generating
 * placeholder is replaced by the full result in one snapshot.
 */
export async function finishRecoveredTurn(
  ctl: ChatControllerInternals,
    runtime: DroidRuntime,
    runtimeGeneration: number,
    turnGeneration: number,
    sessionId: string,
    cwd: string,
    turnId: string,
  ): Promise<void> {
    const loaded = await loadHistoryTimed(ctl, cwd, sessionId);
    if (
      !isCurrentTurn(ctl, 
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
    const interrupted = ctl.turn?.status === 'stopping';
    ctl.interactions.endTurn(sessionId, turnId);
    if (loaded?.status === 'available') {
      ctl.mission = loaded.mission ?? null;
      ctl.tokenUsage = {
        cumulative: loaded.tokenUsage ?? ctl.tokenUsage.cumulative,
        lastTurn: ctl.tokenUsage.lastTurn,
      };
      ctl.transcript = reconcileSessionHistory(
        loaded.state,
        ctl.transcript,
      );
    } else {
      ctl.emitSessionDiagnostic(
        'recovered-turn-history-failed',
        RECOVERED_HISTORY_FAILED_MESSAGE,
      );
    }
    setTurnStatus(ctl, 
      sessionId,
      turnId,
      interrupted ? 'interrupted' : 'completed',
    );
    ctl.emitSnapshot();
    void flushRecoveryCheckpoint(ctl);
    refreshContextAfterTurn(ctl, sessionId);
}

export function scheduleRecoveryCheckpoint(ctl: ChatControllerInternals): void {
    const sessionId = ctl.sessionId;
    if (sessionId === null) {
      return;
    }
    ctl.pendingRecoveryCheckpoint = {
      sessionId,
      cache: ctl.transcript,
    };
    if (ctl.recoveryCheckpointTimer !== null) {
      return;
    }
    ctl.recoveryCheckpointTimer = setTimeout(() => {
      ctl.recoveryCheckpointTimer = null;
      const checkpoint = ctl.pendingRecoveryCheckpoint;
      ctl.pendingRecoveryCheckpoint = null;
      if (checkpoint) {
        ctl.recoveryStore.writeSession(
          checkpoint.sessionId,
          checkpoint.cache,
        );
      }
    }, SESSION_RECOVERY_DEBOUNCE_MS);
}

export function checkpointRecoveryTranscript(ctl: ChatControllerInternals): void {
    if (ctl.recoveryCheckpointTimer !== null) {
      clearTimeout(ctl.recoveryCheckpointTimer);
      ctl.recoveryCheckpointTimer = null;
    }
    ctl.pendingRecoveryCheckpoint = null;
    if (ctl.sessionId !== null) {
      ctl.recoveryStore.writeSession(
        ctl.sessionId,
        ctl.transcript,
      );
    }
}

export function flushRecoveryCheckpoint(ctl: ChatControllerInternals): Promise<void> {
    checkpointRecoveryTranscript(ctl);
    return ctl.recoveryStore.flush();
}

export /**
 * Turn id synthesized for a daemon turn recovered after a reload. The
 * runtime generation is unique per activation, so recovery turns never
 * collide with each other or with webview-generated turn ids.
 */
function recoveryTurnId(generation: number): string {
  return `recovery-${generation}`;
}
