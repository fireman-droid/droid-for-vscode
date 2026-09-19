import type { TurnWatchdogPort } from './turnWatchdogPort';
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
// Streamed turns must release Runtime/daemon ownership before Host settlement.
// A missing terminal event is not proof of successful completion. Recovery
// turns have no local stream and may settle after a confirmed backend stop.
import type { RuntimeSessionWorkingState } from '../../../runtime/DroidRuntime';
import { reconcileSessionHistory } from '../../recovery/reconcileSessionHistory';
import { isTurnActive } from '../internals';

/** Tick cadence; each tick is cheap (state checks, one registry RPC). */
export const TURN_WATCHDOG_POLL_MS = 5_000;

/**
 * How long a Stop may sit in `stopping` before retrying the backend
 * interrupt. A timeout never grants permission to dispatch another turn.
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
  'Droid has not confirmed the stop. The turn remains blocked to avoid ' +
  'starting another task concurrently. Retry Stop or reconnect the session.';

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
  recoveryReported?: boolean;
}

/**
 * Arms (or re-arms) the watchdog for the turn that is current right
 * now. Called when a locally streamed turn starts; recovery turns are
 * covered lazily by `markStopRequested` because their idle handling
 * already lives in the recovery poll.
 */
export function armTurnWatchdog(
  ctl: TurnWatchdogPort,
  sessionId: string,
  turnId: string,
): void {
  clearTurnWatchdog(ctl);
  ctl.turnState.turnWatchdog = {
    sessionId,
    turnId,
    runtimeGeneration: ctl.sessionState.runtimeGeneration,
    turnGeneration: ctl.turnState.turnGeneration,
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
  ctl: TurnWatchdogPort,
  sessionId: string,
  turnId: string,
): void {
  if (
    ctl.turnState.turnWatchdog === null ||
    ctl.turnState.turnWatchdog.turnId !== turnId
  ) {
    armTurnWatchdog(ctl, sessionId, turnId);
  }
  const watch = ctl.turnState.turnWatchdog;
  if (watch !== null && watch.stopDeadlineAt === null) {
    watch.stopDeadlineAt = Date.now() + STOP_FORCE_SETTLE_MS;
  }
}

export function clearTurnWatchdog(ctl: TurnWatchdogPort): void {
  const watch = ctl.turnState.turnWatchdog;
  if (watch === null) {
    return;
  }
  ctl.turnState.turnWatchdog = null;
  clearInterval(watch.timer);
}

/** One watchdog tick. Exported for focused tests. */
export async function tickTurnWatchdog(ctl: TurnWatchdogPort): Promise<void> {
  const watch = ctl.turnState.turnWatchdog;
  if (watch === null || watch.ticking) {
    return;
  }
  if (!isWatchedTurnCurrent(ctl, watch)) {
    clearTurnWatchdog(ctl);
    return;
  }
  const turn = ctl.turnState.turn;
  if (turn === null) {
    return;
  }

  if (turn.status === 'stopping') {
    if (watch.stopDeadlineAt === null || Date.now() < watch.stopDeadlineAt) {
      return;
    }
    watch.ticking = true;
    try {
      const stopped = await interruptWatchedStream(ctl, watch, 'stop-timeout');
      if (stopped && turn.recovery === true) await settleStuckTurn(ctl, watch);
    } finally {
      if (ctl.turnState.turnWatchdog === watch) {
        watch.ticking = false;
      }
    }
    return;
  }

  // Idle probe for a streaming turn. Recovery turns keep their own
  // 500ms poll (pollRecoveredTurn); process sessions cannot report a
  // working state, so only daemon-backed turns are probed.
  const runtime = ctl.sessionState.runtime;
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
      ctl.turnState.turnWatchdog !== watch ||
      !isWatchedTurnCurrent(ctl, watch) ||
      ctl.turnState.turn?.status === 'stopping'
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
    await interruptWatchedStream(ctl, watch, 'stream-idle');
  } finally {
    if (ctl.turnState.turnWatchdog === watch) {
      watch.ticking = false;
    }
  }
}

async function interruptWatchedStream(
  ctl: TurnWatchdogPort, watch: TurnWatchdogState, reason: 'stop-timeout' | 'stream-idle',
): Promise<boolean> {
  const runtime = ctl.sessionState.runtime;
  if (!runtime || !isWatchedTurnCurrent(ctl, watch)) return false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      runtime.interruptSession ? runtime.interruptSession() : runtime.interrupt(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Runtime interrupt timed out')), STOP_FORCE_SETTLE_MS);
      }),
    ]);
    // consumeTurn, not this watchdog, settles locally streamed turns once
    // the generator's cleanup has released both ownership slots.
    return true;
  } catch {
    if (isWatchedTurnCurrent(ctl, watch) && !watch.recoveryReported) {
      watch.recoveryReported = true;
      ctl.recordHost({ level: 'warn', name: 'host.turn.watchdog-stop-unconfirmed',
        attributes: { sessionId: watch.sessionId, turnId: watch.turnId, reason } });
      ctl.emit({ type: 'runtime.diagnostic', sessionId: watch.sessionId, turnId: watch.turnId,
        severity: 'warning', code: 'turn-stop-unconfirmed', message: STOP_TIMEOUT_MESSAGE });
    }
    return false;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function isWatchedTurnCurrent(ctl: TurnWatchdogPort, watch: TurnWatchdogState): boolean {
  return (
    !ctl.sessionState.disposed &&
    ctl.sessionState.sessionId === watch.sessionId &&
    ctl.sessionState.runtimeGeneration === watch.runtimeGeneration &&
    ctl.turnState.turnGeneration === watch.turnGeneration &&
    ctl.turnState.turn?.turnId === watch.turnId &&
    isTurnActive(ctl.turnState.turn)
  );
}

/**
 * A recovered turn has no local iterator. After a confirmed stop, reload
 * available history and retire its recovery poll before terminal side effects.
 */
async function settleStuckTurn(
  ctl: TurnWatchdogPort,
  watch: TurnWatchdogState,
): Promise<void> {
  const { sessionId, turnId } = watch;
  const cwd = ctl.sessionState.activeRuntimeCwd;
  const loaded = cwd === null ? null : await ctl.effects.loadHistoryTimed(cwd, sessionId);
  if (ctl.turnState.turnWatchdog !== watch || !isWatchedTurnCurrent(ctl, watch)) {
    return;
  }
  const turn = ctl.turnState.turn;
  if (turn === null) {
    return;
  }
  if (turn.recovery !== true || turn.status !== 'stopping') return;
  ctl.effects.flushPendingThinking(sessionId, turnId);
  // A late recovery poll must not double-settle this confirmed stop.
  ctl.turnState.turnGeneration += 1;
  clearTurnWatchdog(ctl);
  ctl.recordHost({
    level: 'warn',
    name: 'host.turn.watchdog-settled',
    attributes: {
      reason: 'recovered-stop-confirmed',
      status: 'interrupted',
      historyReloaded: loaded?.status === 'available',
    },
  });
  ctl.interactions.endTurn(sessionId, turnId);
  ctl.terminalMirror?.settleAll();
  if (loaded?.status === 'available') {
    ctl.missionState.mission = loaded.mission ?? null;
    ctl.metadata.tokenUsage = {
      cumulative: loaded.tokenUsage ?? ctl.metadata.tokenUsage.cumulative,
      lastTurn: ctl.metadata.tokenUsage.lastTurn,
    };
    ctl.recoveryState.transcript = reconcileSessionHistory(
      loaded.state,
      ctl.recoveryState.transcript,
      { preserveLocalTail: true },
    );
  }
  ctl.effects.publishTurnChanges(
    sessionId,
    turnId,
    'interrupted',
  );
  ctl.effects.setTurnStatus(sessionId, turnId, 'interrupted');
  ctl.emitSnapshot();
  ctl.effects.flushRecoveryCheckpointInBackground();
  ctl.effects.settleTurnSubagents(sessionId, turnId);
  ctl.effects.refreshContextAfterTurn(sessionId);
}
