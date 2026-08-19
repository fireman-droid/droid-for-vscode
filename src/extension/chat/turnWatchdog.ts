// turnWatchdog: bounded self-healing for a main turn whose runtime
// stream stopped making progress (user report #32). Two failure modes
// are covered:
//
// 1. Stop pressed but the interrupt never settles the turn — the
//    Promise hangs or the terminal event never arrives, leaving the
//    turn in `stopping` forever, which blocks the queue, the composer
//    and every post-turn action (Fork/Regenerate).
// 2. The backend finished the turn but the local stream silently died
//    before delivering `turn-complete` (daemon sessions), so the turn
//    stays `streaming` while the daemon is already idle.
//
// Both settle the turn locally after a bounded window: the persisted
// session history is reloaded (best effort) so content the dead
// stream never delivered still lands, then the turn reaches a real
// terminal state and the dead stream is orphaned via the turn
// generation. The subagent zombie watch stays the authority for
// delegations; this watchdog only owns the main turn.
import type { RuntimeSessionWorkingState } from '../../runtime/DroidRuntime';
import { reconcileSessionHistory } from '../reconcileSessionHistory';
import { loadHistoryTimed } from './runtimeLifecycle';
import { flushRecoveryCheckpoint } from './recovery';
import { settleTurnSubagents } from './subagentWatch';
import { flushPendingThinking } from './thinkingBatch';
import {
  publishTurnChanges,
  refreshContextAfterTurn,
  setTurnStatus,
} from './turnFlow';
import { isTurnActive, type ChatControllerInternals } from './internals';

/** Tick cadence; each tick is cheap (state checks, one registry RPC). */
export const TURN_WATCHDOG_POLL_MS = 5_000;

/**
 * How long a Stop may sit in `stopping` before the turn is settled
 * locally as interrupted. A healthy interrupt settles in well under
 * a couple of seconds; past this window the stream is treated as
 * lost.
 */
export const STOP_FORCE_SETTLE_MS = 10_000;

/**
 * Age a turn must reach before idle probing starts, so a daemon that
 * has not yet attributed the fresh turn never reads as a false idle.
 */
export const TURN_IDLE_GRACE_MS = 30_000;

/**
 * Consecutive `idle` working-state reads required before a streaming
 * turn is declared lost. `running`/`waiting-for-user`/`unknown` all
 * reset the count (fail closed: `unknown` is never treated as done).
 */
export const TURN_IDLE_CONFIRM_READS = 3;

export const STOP_TIMEOUT_MESSAGE =
  'Droid did not confirm the stop in time, so the turn was closed. ' +
  'The task may still be finishing in the background.';

/** Watchdog state held on the controller while a turn is watched. */
export interface TurnWatchdogState {
  readonly sessionId: string;
  readonly turnId: string;
  readonly runtimeGeneration: number;
  readonly turnGeneration: number;
  readonly startedAt: number;
  readonly timer: ReturnType<typeof setInterval>;
  /** Deadline set by an accepted Stop; null before Stop. */
  stopDeadlineAt: number | null;
  /** Consecutive idle working-state reads observed. */
  idleReads: number;
  /** Serializes ticks so a slow read or settle never overlaps. */
  ticking: boolean;
}

/**
 * Arms (or re-arms) the watchdog for the turn that is current right
 * now. Called when a locally streamed turn starts; recovery turns are
 * covered lazily by `markStopRequested` because their idle handling
 * already lives in the recovery poll.
 */
export function armTurnWatchdog(
  ctl: ChatControllerInternals,
  sessionId: string,
  turnId: string,
): void {
  clearTurnWatchdog(ctl);
  ctl.turnWatchdog = {
    sessionId,
    turnId,
    runtimeGeneration: ctl.runtimeGeneration,
    turnGeneration: ctl.turnGeneration,
    startedAt: Date.now(),
    timer: setInterval(() => {
      void tickTurnWatchdog(ctl);
    }, TURN_WATCHDOG_POLL_MS),
    stopDeadlineAt: null,
    idleReads: 0,
    ticking: false,
  };
}

/**
 * Starts the stop-settle countdown for an accepted Stop. Arms the
 * watchdog first when none is running (recovery turns never pass
 * through `handleSend`).
 */
export function markStopRequested(
  ctl: ChatControllerInternals,
  sessionId: string,
  turnId: string,
): void {
  if (
    ctl.turnWatchdog === null ||
    ctl.turnWatchdog.turnId !== turnId
  ) {
    armTurnWatchdog(ctl, sessionId, turnId);
  }
  const watch = ctl.turnWatchdog;
  if (watch !== null && watch.stopDeadlineAt === null) {
    watch.stopDeadlineAt = Date.now() + STOP_FORCE_SETTLE_MS;
  }
}

export function clearTurnWatchdog(
  ctl: ChatControllerInternals,
): void {
  const watch = ctl.turnWatchdog;
  if (watch === null) {
    return;
  }
  ctl.turnWatchdog = null;
  clearInterval(watch.timer);
}

/** One watchdog tick. Exported for focused tests. */
export async function tickTurnWatchdog(
  ctl: ChatControllerInternals,
): Promise<void> {
  const watch = ctl.turnWatchdog;
  if (watch === null || watch.ticking) {
    return;
  }
  if (!isWatchedTurnCurrent(ctl, watch)) {
    clearTurnWatchdog(ctl);
    return;
  }
  const turn = ctl.turn;
  if (turn === null) {
    return;
  }

  if (turn.status === 'stopping') {
    if (
      watch.stopDeadlineAt === null ||
      Date.now() < watch.stopDeadlineAt
    ) {
      return;
    }
    watch.ticking = true;
    try {
      // One stronger backend-side stop attempt before closing the
      // turn locally: `interrupt()` rides the possibly-dead stream,
      // `interruptSession()` reaches the daemon directly.
      void ctl.runtime?.interruptSession?.().catch(() => undefined);
      await settleStuckTurn(ctl, watch, 'stop-timeout');
    } finally {
      if (ctl.turnWatchdog === watch) {
        watch.ticking = false;
      }
    }
    return;
  }

  // Idle probe for a streaming turn. Recovery turns keep their own
  // 500ms poll (pollRecoveredTurn); process sessions cannot report a
  // working state, so only daemon-backed turns are probed.
  const runtime = ctl.runtime;
  if (
    turn.recovery === true ||
    runtime === null ||
    typeof runtime.readSessionWorkingState !== 'function' ||
    Date.now() - watch.startedAt < TURN_IDLE_GRACE_MS
  ) {
    return;
  }
  watch.ticking = true;
  try {
    let state: RuntimeSessionWorkingState;
    try {
      state = await runtime.readSessionWorkingState();
    } catch {
      state = 'unknown';
    }
    if (
      ctl.turnWatchdog !== watch ||
      !isWatchedTurnCurrent(ctl, watch) ||
      ctl.turn?.status === 'stopping'
    ) {
      return;
    }
    if (state !== 'idle') {
      watch.idleReads = 0;
      return;
    }
    watch.idleReads += 1;
    if (watch.idleReads < TURN_IDLE_CONFIRM_READS) {
      return;
    }
    await settleStuckTurn(ctl, watch, 'stream-idle');
  } finally {
    if (ctl.turnWatchdog === watch) {
      watch.ticking = false;
    }
  }
}

function isWatchedTurnCurrent(
  ctl: ChatControllerInternals,
  watch: TurnWatchdogState,
): boolean {
  return (
    !ctl.disposed &&
    ctl.sessionId === watch.sessionId &&
    ctl.runtimeGeneration === watch.runtimeGeneration &&
    ctl.turnGeneration === watch.turnGeneration &&
    ctl.turn?.turnId === watch.turnId &&
    isTurnActive(ctl.turn)
  );
}

/**
 * Settles the watched turn at a real terminal state: reloads the
 * persisted history so content the dead stream never delivered still
 * lands, orphans the stream via the turn generation, then runs the
 * same completion side effects as a streamed terminal event
 * (changed-files reconcile, checkpoint flush, subagent settle, queue
 * settle via `emitTurnState`).
 */
async function settleStuckTurn(
  ctl: ChatControllerInternals,
  watch: TurnWatchdogState,
  reason: 'stop-timeout' | 'stream-idle',
): Promise<void> {
  const { sessionId, turnId } = watch;
  const cwd = ctl.activeRuntimeCwd;
  const loaded =
    cwd === null ? null : await loadHistoryTimed(ctl, cwd, sessionId);
  if (ctl.turnWatchdog !== watch || !isWatchedTurnCurrent(ctl, watch)) {
    return;
  }
  const turn = ctl.turn;
  if (turn === null) {
    return;
  }
  const interrupted = turn.status === 'stopping';
  flushPendingThinking(ctl, sessionId, turnId);
  // A late event or completion from the orphaned stream must never
  // double-settle: isCurrentTurn checks the turn generation.
  ctl.turnGeneration += 1;
  clearTurnWatchdog(ctl);
  ctl.recordHost({
    level: 'warn',
    name: 'host.turn.watchdog-settled',
    attributes: {
      reason,
      status: interrupted ? 'interrupted' : 'completed',
      historyReloaded: loaded?.status === 'available',
    },
  });
  if (reason === 'stop-timeout') {
    ctl.emit({
      type: 'runtime.diagnostic',
      sessionId,
      turnId,
      severity: 'warning',
      code: 'turn-stop-timeout',
      message: STOP_TIMEOUT_MESSAGE,
    });
  }
  ctl.interactions.endTurn(sessionId, turnId);
  ctl.terminalMirror?.settleAll();
  if (loaded?.status === 'available') {
    ctl.mission = loaded.mission ?? null;
    ctl.tokenUsage = {
      cumulative: loaded.tokenUsage ?? ctl.tokenUsage.cumulative,
      lastTurn: ctl.tokenUsage.lastTurn,
    };
    ctl.transcript = reconcileSessionHistory(
      loaded.state,
      ctl.transcript,
      { preserveLocalTail: true },
    );
  }
  publishTurnChanges(ctl, sessionId, turnId);
  setTurnStatus(
    ctl,
    sessionId,
    turnId,
    interrupted ? 'interrupted' : 'completed',
  );
  ctl.emitSnapshot();
  void flushRecoveryCheckpoint(ctl);
  settleTurnSubagents(ctl, sessionId, turnId);
  refreshContextAfterTurn(ctl, sessionId);
}
