// subagentWatch: moved verbatim from ChatController.ts (structure-only
// refactor; bodies unchanged except mechanical this. -> ctl.).
import type { SessionHistoryLoader } from '../../runtime/history/SessionHistory';
import {
  applySubagentSettlement,
  collectRunningSubagentRows,
  collectTranscriptSubagentRows,
  hasSubagentRows,
  reconcileSubagentSummaries,
  settleZombieSubagents,
  type PendingSubagentRow,
} from '../turnActivityState';
import type { HostTranscriptState } from '../hostTranscriptState';
import type { ChatControllerInternals } from './internals';

export /**
 * Poll cadence of the post-turn zombie-subagent reconcile. Each tick
 * is one session-file load; the probed settle latency of the ledger
 * is seconds-coarse, so 5s keeps the row honest without I/O churn.
 */
const ZOMBIE_SUBAGENT_POLL_MS = 5_000;

/**
 * Delay between a Task tool result landing and the mid-turn ledger
 * read that upgrades its row to `running`. The CLI writes the
 * invocation record around dispatch time; 1.5s covers the write
 * without hammering the session file on parallel dispatch bursts.
 */
export const LIVE_SUBAGENT_SYNC_DELAY_MS = 1_500;

/** One retry, for a ledger row that lands late. */
const LIVE_SUBAGENT_SYNC_RETRY_MS = 4_000;

interface LiveSubagentSync {
  key: string;
  attempt: number;
  timer: ReturnType<typeof setTimeout> | null;
}

const liveSubagentSyncs = new WeakMap<object, LiveSubagentSync>();

/**
 * Mid-turn ledger sync for background delegations (user report
 * 2026-08-13 evening: five parallel Task dispatches completed in ~5s
 * and the UI showed nothing running).
 *
 * The authoritative `child_session_available` notification never
 * fires in daemon mode — the daemon session facade exposes no
 * `onNotification` — so a dispatched row would stay statusless until
 * turn end. This reads `subagentInvocations` from the session ledger
 * shortly after a Task tool result lands and reconciles the turn's
 * rows in place: paired running entries light the row (Working badge,
 * panel polling, per-row Stop), terminal entries settle it outright.
 * Mode-agnostic — both history loaders serve the ledger.
 */
export function scheduleLiveSubagentSync(
  ctl: ChatControllerInternals,
  sessionId: string,
  turnId: string,
): void {
  const cwd = ctl.activeRuntimeCwd;
  const loadSummaries = ctl.sessionHistory.loadSubagentSummaries?.bind(
    ctl.sessionHistory,
  );
  if (cwd === null || loadSummaries === undefined) {
    return;
  }
  const key = `${sessionId}:${turnId}`;
  let state = liveSubagentSyncs.get(ctl);
  if (state === undefined) {
    state = { key, attempt: 0, timer: null };
    liveSubagentSyncs.set(ctl, state);
  }
  if (state.timer !== null && state.key === key) {
    // A dispatch burst folds into the pending read.
    return;
  }
  if (state.timer !== null) {
    clearTimeout(state.timer);
  }
  state.key = key;
  state.attempt = 0;
  armLiveSubagentTimer(
    ctl,
    state,
    sessionId,
    turnId,
    cwd,
    loadSummaries,
    LIVE_SUBAGENT_SYNC_DELAY_MS,
  );
}

function armLiveSubagentTimer(
  ctl: ChatControllerInternals,
  state: LiveSubagentSync,
  sessionId: string,
  turnId: string,
  cwd: string,
  loadSummaries: NonNullable<
    SessionHistoryLoader['loadSubagentSummaries']
  >,
  delayMs: number,
): void {
  state.timer = setTimeout(() => {
    state.timer = null;
    state.attempt += 1;
    void loadSummaries({ cwd, sessionId })
      .catch(() => null)
      .then((summaries) => {
        const turn = ctl.turn;
        if (
          ctl.disposed ||
          ctl.sessionId !== sessionId ||
          turn?.turnId !== turnId ||
          state.key !== `${sessionId}:${turnId}`
        ) {
          return;
        }
        const updated =
          summaries === null
            ? []
            : (() => {
                const result = reconcileSubagentSummaries(
                  turn.activity,
                  summaries,
                );
                turn.activity = result.state;
                return result.projections;
              })();
        for (const projection of updated) {
          if (projection.subagent !== undefined) {
            // subagent.update patches the row in place on both the
            // host transcript and the webview store, live or not.
            ctl.emit({
              type: 'subagent.update',
              sessionId,
              turnId,
              toolUseId: projection.toolUseId,
              subagent: projection.subagent,
            });
          }
        }
        if (updated.length > 0) {
          ctl.recordHost({
            level: 'info',
            name: 'host.subagent.live-sync',
            attributes: { rows: updated.length, attempt: state.attempt },
          });
        } else if (state.attempt === 1 && state.timer === null) {
          // The ledger row may simply not be written yet; try once
          // more before leaving it to the turn-end reconcile.
          armLiveSubagentTimer(
            ctl,
            state,
            sessionId,
            turnId,
            cwd,
            loadSummaries,
            LIVE_SUBAGENT_SYNC_RETRY_MS,
          );
        }
      });
  }, delayMs);
}

export /**
 * Upper bound on the post-turn reconcile window. Rows that outlive
 * it stay "running in background" in the UI until the next session
 * load re-reads the ledger.
 */
const ZOMBIE_SUBAGENT_WATCH_MAX_MS = 10 * 60_000;

/** Cancels a pending mid-turn ledger sync (turn end supersedes it). */
export function clearLiveSubagentSync(
  ctl: ChatControllerInternals,
): void {
  const state = liveSubagentSyncs.get(ctl);
  if (state === undefined) {
    return;
  }
  if (state.timer !== null) {
    clearTimeout(state.timer);
    state.timer = null;
  }
  // A dead key keeps a late-arriving callback from re-arming.
  state.key = '';
}

/**
 * Settles the finished turn's subagent rows with the CLI's durable
 * invocation ledger (`loadSession().subagentInvocations`). The
 * session file is loaded only when the turn actually delegated, and
 * the result applies only while the same turn is still current.
 */
export function settleTurnSubagents(
  ctl: ChatControllerInternals,
  sessionId: string, turnId: string): void {
    // The zombie watch owns post-turn reconciliation; a pending
    // mid-turn sync would double-settle the same rows.
    clearLiveSubagentSync(ctl);
    const cwd = ctl.activeRuntimeCwd;
    const loadSummaries = ctl.sessionHistory.loadSubagentSummaries?.bind(
      ctl.sessionHistory,
    );
    if (
      cwd === null ||
      loadSummaries === undefined ||
      ctl.sessionId !== sessionId ||
      ctl.turn?.turnId !== turnId ||
      !hasSubagentRows(ctl.turn.activity)
    ) {
      return;
    }
    void loadSummaries({ cwd, sessionId }).then((summaries) => {
      const turn = ctl.turn;
      if (
        ctl.disposed ||
        ctl.sessionId !== sessionId ||
        turn?.turnId !== turnId
      ) {
        return;
      }
      if (summaries !== null) {
        const result = reconcileSubagentSummaries(
          turn.activity,
          summaries,
        );
        turn.activity = result.state;
        for (const projection of result.projections) {
          // The turn already reached its terminal state, so a live
          // webview drops tool.activity (acceptsActiveTurn). Only
          // subagent.update lands after the turn — without it the
          // rows stay "running" on screen until a full reload.
          if (projection.subagent !== undefined) {
            ctl.emit({
              type: 'subagent.update',
              sessionId,
              turnId,
              toolUseId: projection.toolUseId,
              subagent: projection.subagent,
            });
          }
        }
      }
      // Background delegations the ledger still reports as running
      // outlive the turn; keep reconciling them out of band.
      armZombieSubagentWatch(ctl, 
        sessionId,
        cwd,
        loadSummaries,
        collectRunningSubagentRows(turn.activity, turnId),
      );
    });
}

/**
 * Starts (or extends) the post-turn ledger poll for delegations
 * still running after their turn settled. Rows from an earlier
 * turn of the same session stay watched when a newer turn adds
 * its own zombies.
 */
export function armZombieSubagentWatch(
  ctl: ChatControllerInternals,
    sessionId: string,
    cwd: string,
    loadSummaries: NonNullable<
      SessionHistoryLoader['loadSubagentSummaries']
    >,
    rows: readonly PendingSubagentRow[],
  ): void {
    const existing = ctl.zombieSubagentWatch;
    if (existing !== null && existing.sessionId !== sessionId) {
      clearZombieSubagentWatch(ctl);
    }
    if (rows.length === 0) {
      return;
    }
    const current = ctl.zombieSubagentWatch;
    if (current !== null) {
      const known = new Set(
        current.rows.map((row) => `${row.turnId}:${row.toolUseId}`),
      );
      current.rows = [
        ...current.rows,
        ...rows.filter(
          (row) => !known.has(`${row.turnId}:${row.toolUseId}`),
        ),
      ];
      return;
    }
    const watch = {
      sessionId,
      rows,
      deadlineAt: Date.now() + ZOMBIE_SUBAGENT_WATCH_MAX_MS,
      ticking: false,
      timer: setInterval(() => {
        void tickZombieSubagentWatch(ctl, cwd, loadSummaries);
      }, ZOMBIE_SUBAGENT_POLL_MS),
    };
    ctl.zombieSubagentWatch = watch;
    ctl.recordHost({
      level: 'info',
      name: 'host.subagent.zombie-watch-armed',
      attributes: { rows: rows.length },
    });
}

export function clearZombieSubagentWatch(ctl: ChatControllerInternals): void {
    const watch = ctl.zombieSubagentWatch;
    if (watch === null) {
      return;
    }
    ctl.zombieSubagentWatch = null;
    clearInterval(watch.timer);
}

export async function tickZombieSubagentWatch(
  ctl: ChatControllerInternals,
    cwd: string,
    loadSummaries: NonNullable<
      SessionHistoryLoader['loadSubagentSummaries']
    >,
  ): Promise<void> {
    const watch = ctl.zombieSubagentWatch;
    if (watch === null || watch.ticking) {
      return;
    }
    if (
      ctl.disposed ||
      ctl.sessionId !== watch.sessionId ||
      Date.now() > watch.deadlineAt
    ) {
      clearZombieSubagentWatch(ctl);
      return;
    }
    watch.ticking = true;
    const summaries = await loadSummaries({
      cwd,
      sessionId: watch.sessionId,
    }).catch(() => null);
    watch.ticking = false;
    if (
      summaries === null ||
      ctl.zombieSubagentWatch !== watch ||
      ctl.disposed ||
      ctl.sessionId !== watch.sessionId
    ) {
      return;
    }
    const { settled, pending } = settleZombieSubagents(
      watch.rows,
      summaries,
    );
    if (settled.length === 0) {
      return;
    }
    for (const { row, subagent } of settled) {
      if (ctl.turn?.turnId === row.turnId) {
        ctl.turn.activity = applySubagentSettlement(
          ctl.turn.activity,
          row.toolUseId,
          subagent,
        );
      }
      ctl.emit({
        type: 'subagent.update',
        sessionId: watch.sessionId,
        turnId: row.turnId,
        toolUseId: row.toolUseId,
        subagent,
      });
    }
    if (pending.length === 0) {
      clearZombieSubagentWatch(ctl);
    } else {
      watch.rows = pending;
    }
}

/**
 * Re-arms the zombie-delegation ledger poll from a replayed
 * transcript (Reload Window / session switch), covering rows whose
 * delegation outlived the turn that dispatched it. The existing
 * watch merge keeps rows from a live turn-end reconcile intact.
 */
export function armReplayedSubagentWatch(
  ctl: ChatControllerInternals,
    sessionId: string,
    cwd: string,
    transcript: HostTranscriptState,
  ): void {
    const loadSummaries = ctl.sessionHistory.loadSubagentSummaries?.bind(
      ctl.sessionHistory,
    );
    if (loadSummaries === undefined) {
      return;
    }
    armZombieSubagentWatch(ctl, 
      sessionId,
      cwd,
      loadSummaries,
      collectTranscriptSubagentRows(transcript.transcript),
    );
}
