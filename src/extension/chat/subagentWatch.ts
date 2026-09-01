// subagentWatch: moved verbatim from ChatController.ts (structure-only
// refactor; bodies unchanged except mechanical this. -> ctl.).
import type { SessionHistoryLoader } from '../../runtime/history/SessionHistory';
import type { RuntimeSessionWorkingState } from '../../runtime/DroidRuntime';
import type { SessionTokenUsageState } from '../../shared/tokenUsage';
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
import { reconcileSessionHistory } from '../reconcileSessionHistory';
import { isTurnActive, type ChatControllerInternals } from './internals';

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

/**
 * A child can settle just before its hidden completion notification
 * starts the parent's automatic follow-up turn. Do not read the
 * history during that short idle gap or the eventual aggregate answer
 * will still be missed.
 */
const PARENT_FOLLOWUP_IDLE_GRACE_MS = 10_000;

/**
 * Process sessions cannot report their working state. In that mode,
 * keep reloading the bounded public history for a short window after
 * settlement; the final read closes the same projection gap without
 * leaving an unbounded poll behind.
 */
const PARENT_FOLLOWUP_FALLBACK_MAX_MS = 30_000;
const PARENT_FOLLOWUP_HARD_MAX_MS = 10 * 60_000;

interface LiveSubagentSync {
  key: string;
  attempt: number;
  timer: ReturnType<typeof setTimeout> | null;
}

const liveSubagentSyncs = new WeakMap<object, LiveSubagentSync>();

interface ParentFollowupSync {
  readonly sessionId: string;
  readonly runtimeGeneration: number;
  readonly assistantMarker: string;
  readonly settledAt: number;
  readonly fallbackDeadlineAt: number;
  readonly hardDeadlineAt: number;
  sawRunning: boolean;
  lastRunningAt: number | null;
}

const parentFollowupSyncs = new WeakMap<object, ParentFollowupSync>();

/** Watches whose ledger read already logged a failure (log dedupe). */
const failedWatchReads = new WeakSet<object>();

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
  sessionId: string,
  turnId: string,
): void {
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
    // New background work supersedes an older post-settlement wait;
    // the next all-settled point establishes a fresh baseline.
    parentFollowupSyncs.delete(ctl);
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
  parentFollowupSyncs.delete(ctl);
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
    (Date.now() > watch.deadlineAt &&
      parentFollowupSyncs.get(ctl) === undefined)
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
      }).catch(() => null);
      if (
        summaries === null &&
        ctl.zombieSubagentWatch === watch &&
        !ctl.disposed &&
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
        ctl.zombieSubagentWatch !== watch ||
        ctl.disposed ||
        ctl.sessionId !== watch.sessionId
      ) {
        return;
      }
      failedWatchReads.delete(watch);
      const { settled, pending } = settleZombieSubagents(
        watch.rows,
        summaries,
      );
      watch.rows = pending;
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
      if (settled.length > 0 && pending.length === 0) {
        const now = Date.now();
        parentFollowupSyncs.set(ctl, {
          sessionId: watch.sessionId,
          runtimeGeneration: ctl.runtimeGeneration,
          assistantMarker: transcriptAssistantMarker(
            ctl.transcript.transcript,
          ),
          settledAt: now,
          fallbackDeadlineAt: now + PARENT_FOLLOWUP_FALLBACK_MAX_MS,
          hardDeadlineAt: now + PARENT_FOLLOWUP_HARD_MAX_MS,
          // A newer child settlement may start a newer automatic
          // parent turn, so its working-state observation starts fresh.
          sawRunning: false,
          lastRunningAt: null,
        });
      } else if (settled.length > 0) {
        // The eventual final settlement establishes the baseline for
        // the aggregate parent answer. Earlier completion turns may
        // emit interim progress, but must not end the watch first.
        parentFollowupSyncs.delete(ctl);
      }
    }

    await syncParentFollowupHistory(ctl, watch, cwd);
    if (
      ctl.zombieSubagentWatch === watch &&
      watch.rows.length === 0 &&
      parentFollowupSyncs.get(ctl) === undefined
    ) {
      clearZombieSubagentWatch(ctl);
    }
  } finally {
    if (ctl.zombieSubagentWatch === watch) {
      watch.ticking = false;
    }
  }
}

/**
 * Background Task completion notifications run a new parent agent
 * turn after the foreground stream has already closed. Those events
 * cannot arrive through the old `session.stream()`, so once a child
 * settles we wait for the parent to go idle and then replace the
 * current transcript from public session history.
 */
async function syncParentFollowupHistory(
  ctl: ChatControllerInternals,
  watch: NonNullable<ChatControllerInternals['zombieSubagentWatch']>,
  cwd: string,
): Promise<void> {
  const sync = parentFollowupSyncs.get(ctl);
  if (sync === undefined || sync.sessionId !== watch.sessionId) {
    return;
  }
  if (ctl.runtimeGeneration !== sync.runtimeGeneration) {
    parentFollowupSyncs.delete(ctl);
    return;
  }
  if (Date.now() >= sync.hardDeadlineAt) {
    parentFollowupSyncs.delete(ctl);
    return;
  }
  // A user-started foreground turn owns transcript projection until
  // it settles. The parent follow-up history read can safely wait.
  if (ctl.sessionOperationInProgress || isTurnActive(ctl.turn)) {
    return;
  }

  const runtime = ctl.runtime;
  let workingState: RuntimeSessionWorkingState | null = null;
  if (runtime !== null && runtime.readSessionWorkingState !== undefined) {
    try {
      workingState = await runtime.readSessionWorkingState();
    } catch {
      // Process sessions expose the Runtime method but cannot report
      // backend state. Treat that as the bounded fallback path.
      workingState = 'unknown';
    }
    if (
      ctl.zombieSubagentWatch !== watch ||
      ctl.runtime !== runtime ||
      ctl.disposed ||
      ctl.sessionId !== sync.sessionId
    ) {
      return;
    }
    if (
      workingState === 'running' ||
      workingState === 'waiting-for-user'
    ) {
      sync.sawRunning = true;
      sync.lastRunningAt = Date.now();
      return;
    }
    if (
      workingState === 'idle' &&
      ((!sync.sawRunning &&
        Date.now() - sync.settledAt <
          PARENT_FOLLOWUP_IDLE_GRACE_MS) ||
        (sync.lastRunningAt !== null &&
          Date.now() - sync.lastRunningAt <
            PARENT_FOLLOWUP_IDLE_GRACE_MS))
    ) {
      return;
    }
    if (
      workingState === 'unknown' &&
      Date.now() - sync.settledAt < PARENT_FOLLOWUP_IDLE_GRACE_MS
    ) {
      return;
    }
  } else if (
    Date.now() - sync.settledAt < PARENT_FOLLOWUP_IDLE_GRACE_MS
  ) {
    return;
  }

  const loaded = await ctl.sessionHistory
    .loadHistory({ cwd, sessionId: sync.sessionId })
    .catch(() => null);
  const currentSync = parentFollowupSyncs.get(ctl);
  if (
    ctl.zombieSubagentWatch !== watch ||
    ctl.disposed ||
    ctl.sessionId !== sync.sessionId ||
    ctl.runtimeGeneration !== sync.runtimeGeneration ||
    currentSync !== sync
  ) {
    return;
  }
  const available = loaded?.status === 'available';
  let visibleAnswerChanged = false;
  if (available) {
    const mission = loaded.mission ?? null;
    const tokenUsage: SessionTokenUsageState = {
      cumulative: loaded.tokenUsage ?? ctl.tokenUsage.cumulative,
      lastTurn: ctl.tokenUsage.lastTurn,
    };
    const transcript = reconcileSessionHistory(
      loaded.state,
      ctl.transcript,
      { preserveLocalTail: true },
    );
    visibleAnswerChanged =
      transcriptAssistantMarker(transcript.transcript) !==
      sync.assistantMarker;
    const changed =
      !sameTranscriptState(transcript, ctl.transcript) ||
      !sameMission(mission, ctl.mission) ||
      !sameTokenUsage(tokenUsage, ctl.tokenUsage);
    ctl.mission = mission;
    ctl.tokenUsage = tokenUsage;
    ctl.transcript = transcript;
    if (changed && ctl.conversationId !== null) {
      ctl.recoveryStore.writeActiveDisplay(
        ctl.conversationId,
        sync.sessionId,
        transcript,
        ctl.turn === null
          ? null
          : {
              turnId: ctl.turn.turnId,
              status: ctl.turn.status,
              ...(ctl.turn.error === undefined
                ? {}
                : { error: ctl.turn.error }),
            },
      );
      ctl.recoveryStore.flushInBackground();
      ctl.emitSnapshot();
    }
    if (
      visibleAnswerChanged &&
      workingState === 'idle' &&
      sync.sawRunning
    ) {
      parentFollowupSyncs.delete(ctl);
    }
  }
  ctl.recordHost({
    level: available ? 'info' : 'warn',
    name: 'host.subagent.parent-history-sync',
    attributes: {
      outcome: available ? 'ok' : 'failed',
      sessionId: sync.sessionId,
      ...(available
        ? { items: ctl.transcript.transcript.length }
        : {}),
    },
  });

  if (
    parentFollowupSyncs.get(ctl) === sync &&
    Date.now() >=
    Math.max(
      sync.fallbackDeadlineAt,
      (sync.lastRunningAt ?? 0) + PARENT_FOLLOWUP_FALLBACK_MAX_MS,
    )
  ) {
    // A turn too short to observe can start after the first idle
    // history read. Keep the no-running/unknown fallback alive for
    // the full bounded window, then stop permanent background I/O.
    parentFollowupSyncs.delete(ctl);
  }
}

/**
 * Content-only marker for user-visible assistant output. History
 * projection synthesizes different ids than the live stream, so ids
 * cannot prove that the automatic parent turn added an answer.
 */
function transcriptAssistantMarker(
  transcript: HostTranscriptState['transcript'],
): string {
  let count = 0;
  let lastText = '';
  for (const item of transcript) {
    if (item.kind !== 'assistant') {
      continue;
    }
    count += 1;
    lastText = item.text;
  }
  return JSON.stringify([count, lastText]);
}

function sameMission(
  left: ChatControllerInternals['mission'],
  right: ChatControllerInternals['mission'],
): boolean {
  if (left === null || right === null) {
    return left === right;
  }
  return (
    left.state === right.state &&
    left.role === right.role
  );
}

function sameTokenUsage(
  left: SessionTokenUsageState,
  right: SessionTokenUsageState,
): boolean {
  return (
    sameTokenBreakdown(left.cumulative, right.cumulative) &&
    sameTokenBreakdown(left.lastTurn, right.lastTurn)
  );
}

function sameTranscriptState(
  left: HostTranscriptState,
  right: HostTranscriptState,
): boolean {
  return (
    left.historyStatus === right.historyStatus &&
    left.truncated === right.truncated &&
    JSON.stringify(left.transcript) === JSON.stringify(right.transcript)
  );
}

function sameTokenBreakdown(
  left: SessionTokenUsageState['cumulative'],
  right: SessionTokenUsageState['cumulative'],
): boolean {
  return (
    left?.inputTokens === right?.inputTokens &&
    left?.outputTokens === right?.outputTokens &&
    left?.cacheReadTokens === right?.cacheReadTokens &&
    left?.cacheCreationTokens === right?.cacheCreationTokens &&
    left?.thinkingTokens === right?.thinkingTokens &&
    left?.factoryCredits === right?.factoryCredits
  );
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
  armZombieSubagentWatch(
    ctl,
    sessionId,
    cwd,
    loadSummaries,
    collectTranscriptSubagentRows(transcript.transcript),
  );
}
