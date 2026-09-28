import type { SubagentWatchPort } from './subagentWatchPort';
import { clearParentFollowupSync, hasParentFollowupSync, startParentFollowupSync, syncParentFollowupHistory } from './parentFollowupHistory';
import type { SessionHistoryLoader } from '../../../runtime/history/SessionHistory';
import type { HostTranscriptState } from '../../recovery/hostTranscriptState';
import {
  applySubagentSettlement,
  collectRunningSubagentRows,
  collectTranscriptSubagentRows,
  hasSubagentRows,
  reconcileSubagentSummaries,
  settleZombieSubagents,
  type PendingSubagentRow,
} from '../turns/turnActivityState';

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

/** Watches whose ledger read already logged a failure (log dedupe). */
const failedWatchReads = new WeakSet<object>();

/**
 * Mid-turn ledger sync for background delegations (user report
 * 2026-08-13 evening: five parallel Task dispatches completed in ~5s
 * and the UI showed nothing running).
 *
 * Complements live child notifications with the durable invocation ledger.
 * A late or missed spawn notification must not leave a dispatched Task
 * statusless until turn end. Both runtime modes share this fallback.
 */
export function scheduleLiveSubagentSync(
  ctl: SubagentWatchPort,
  sessionId: string,
  turnId: string,
): void {
  const cwd = ctl.sessionState.activeRuntimeCwd;
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
  ctl: SubagentWatchPort,
  state: LiveSubagentSync,
  sessionId: string,
  turnId: string,
  cwd: string,
  loadSummaries: NonNullable<SessionHistoryLoader['loadSubagentSummaries']>,
  delayMs: number,
): void {
  state.timer = setTimeout(() => {
    state.timer = null;
    state.attempt += 1;
    void loadSummaries({ cwd, sessionId,
      parentToolUseIds: [...(ctl.turnState.turn?.activity.tools.keys() ?? [])] })
      .catch(() => null)
      .then((summaries) => {
        const turn = ctl.turnState.turn;
        if (
          ctl.sessionState.disposed ||
          ctl.sessionState.sessionId !== sessionId ||
          turn?.turnId !== turnId ||
          state.key !== `${sessionId}:${turnId}`
        ) {
          return;
        }
        if (summaries === null) {
          // The mid-turn ledger read failed outright; say so instead
          // of silently looking like "no rows yet".
          ctl.recordHost({
            level: 'warn',
            name: 'host.subagent.live-sync',
            attributes: {
              outcome: 'ledger-failed',
              attempt: state.attempt,
            },
          });
        }
        const updated =
          summaries === null
            ? []
            : (() => {
                const result = reconcileSubagentSummaries(turn.activity, summaries);
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

/** Cancels a pending mid-turn ledger sync (turn end supersedes it). */
export function clearLiveSubagentSync(ctl: SubagentWatchPort): void {
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
  ctl: SubagentWatchPort,
  sessionId: string,
  turnId: string,
): void {
  // The zombie watch owns post-turn reconciliation; a pending
  // mid-turn sync would double-settle the same rows.
  clearLiveSubagentSync(ctl);
  const cwd = ctl.sessionState.activeRuntimeCwd;
  const loadSummaries = ctl.sessionHistory.loadSubagentSummaries?.bind(
    ctl.sessionHistory,
  );
  if (
    cwd === null ||
    loadSummaries === undefined ||
    ctl.sessionState.sessionId !== sessionId ||
    ctl.turnState.turn?.turnId !== turnId ||
    !hasSubagentRows(ctl.turnState.turn.activity)
  ) {
    return;
  }
  // A new foreground turn can start before this ledger read finishes.
  // Retain the old turn's running rows before relinquishing its activity state.
  armZombieSubagentWatch(ctl, sessionId, cwd, loadSummaries,
    collectRunningSubagentRows(ctl.turnState.turn.activity, turnId));
  void loadSummaries({ cwd, sessionId,
    parentToolUseIds: [...ctl.turnState.turn.activity.tools.keys()] }).then((summaries) => {
    const turn = ctl.turnState.turn;
    if (
      ctl.sessionState.disposed ||
      ctl.sessionState.sessionId !== sessionId ||
      turn?.turnId !== turnId
    ) {
      return;
    }
    if (summaries !== null) {
      const result = reconcileSubagentSummaries(turn.activity, summaries);
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
    armZombieSubagentWatch(
      ctl,
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
  ctl: SubagentWatchPort,
  sessionId: string,
  cwd: string,
  loadSummaries: NonNullable<SessionHistoryLoader['loadSubagentSummaries']>,
  rows: readonly PendingSubagentRow[],
): void {
  const existing = ctl.subagentState.zombieSubagentWatch;
  if (existing !== null && existing.sessionId !== sessionId) {
    clearZombieSubagentWatch(ctl);
  }
  if (rows.length === 0) {
    return;
  }
  const current = ctl.subagentState.zombieSubagentWatch;
  if (current !== null) {
    // New background work supersedes an older post-settlement wait;
    // the next all-settled point establishes a fresh baseline.
    clearParentFollowupSync(ctl);
    const known = new Set(current.rows.map((row) => `${row.turnId}:${row.toolUseId}`));
    current.rows = [
      ...current.rows,
      ...rows.filter((row) => !known.has(`${row.turnId}:${row.toolUseId}`)),
    ];
    return;
  }
  const watch = {
    sessionId,
    rows,
    ticking: false,
    timer: setInterval(() => {
      void tickZombieSubagentWatch(ctl, cwd, loadSummaries);
    }, ZOMBIE_SUBAGENT_POLL_MS),
  };
  ctl.subagentState.zombieSubagentWatch = watch;
  ctl.recordHost({
    level: 'info',
    name: 'host.subagent.zombie-watch-armed',
    attributes: { rows: rows.length },
  });
}

export function clearZombieSubagentWatch(ctl: SubagentWatchPort): void {
  const watch = ctl.subagentState.zombieSubagentWatch;
  clearParentFollowupSync(ctl);
  if (watch === null) {
    return;
  }
  ctl.subagentState.zombieSubagentWatch = null;
  clearInterval(watch.timer);
}

export async function tickZombieSubagentWatch(
  ctl: SubagentWatchPort,
  cwd: string,
  loadSummaries: NonNullable<SessionHistoryLoader['loadSubagentSummaries']>,
): Promise<void> {
  const watch = ctl.subagentState.zombieSubagentWatch;
  if (watch === null || watch.ticking) {
    return;
  }
  if (
    ctl.sessionState.disposed ||
    ctl.sessionState.sessionId !== watch.sessionId
  ) {
    clearZombieSubagentWatch(ctl);
    return;
  }
  watch.ticking = true;
  try {
    if (watch.rows.length > 0) {
      const summaries = await loadSummaries({
        cwd,
        sessionId: watch.sessionId,
        parentToolUseIds: watch.rows.map((row) => row.toolUseId),
      }).catch(() => null);
      if (
        summaries === null &&
        ctl.subagentState.zombieSubagentWatch === watch &&
        !ctl.sessionState.disposed &&
        !failedWatchReads.has(watch)
      ) {
        // Once per failure streak: a silently failing poll used to be
        // indistinguishable from "nothing settled yet" (bug #37 notes).
        failedWatchReads.add(watch);
        ctl.recordHost({
          level: 'warn',
          name: 'host.subagent.zombie-watch',
          attributes: {
            outcome: 'ledger-failed',
            sessionId: watch.sessionId,
          },
        });
      }
      if (
        summaries === null ||
        ctl.subagentState.zombieSubagentWatch !== watch ||
        ctl.sessionState.disposed ||
        ctl.sessionState.sessionId !== watch.sessionId
      ) {
        return;
      }
      failedWatchReads.delete(watch);
      const { settled, pending } = settleZombieSubagents(watch.rows, summaries);
      watch.rows = pending;
      if (settled.length > 0) ctl.recordHost({
        level: 'info', name: 'host.subagent.zombie-watch-settled',
        attributes: { sessionId: watch.sessionId, settled: settled.length, pending: pending.length },
      });
      for (const { row, subagent } of settled) {
        if (ctl.turnState.turn?.turnId === row.turnId) {
          ctl.turnState.turn.activity = applySubagentSettlement(
            ctl.turnState.turn.activity,
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
      if (settled.length > 0 && pending.length === 0) {
        startParentFollowupSync(ctl, watch.sessionId);
      } else if (settled.length > 0) {
        // The eventual final settlement establishes the baseline for
        // the aggregate parent answer. Earlier completion turns may
        // emit interim progress, but must not end the watch first.
        clearParentFollowupSync(ctl);
      }
    }

    await syncParentFollowupHistory(ctl, watch, cwd);
    if (
      ctl.subagentState.zombieSubagentWatch === watch &&
      watch.rows.length === 0 &&
      !hasParentFollowupSync(ctl)
    ) {
      clearZombieSubagentWatch(ctl);
    }
  } finally {
    if (ctl.subagentState.zombieSubagentWatch === watch) {
      watch.ticking = false;
    }
  }
}

/**
 * Re-arms the zombie-delegation ledger poll from a replayed
 * transcript (Reload Window / session switch), covering rows whose
 * delegation outlived the turn that dispatched it. The existing
 * watch merge keeps rows from a live turn-end reconcile intact.
 */
export function armReplayedSubagentWatch(
  ctl: SubagentWatchPort,
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
  armZombieSubagentWatch(
    ctl,
    sessionId,
    cwd,
    loadSummaries,
    collectTranscriptSubagentRows(transcript.transcript),
  );
}
