// sessionRunning: moved verbatim from ChatController.ts (structure-only
// refactor; bodies unchanged except mechanical this. -> ctl.).
import type { SessionCatalogState } from '../../shared/bridgeMessages';
import {
  delay,
  isTurnActive,
  type ChatControllerInternals,
} from './internals';

export /**
 * Cadence of the daemon opened-session registry poll that watches
 * detached background turns. One cheap in-memory RPC per tick; the
 * loop only runs while a background flag is set.
 */
const BACKGROUND_RUNNING_POLL_MS = 1_000;

export /**
 * Consecutive failed daemon reads before the background flags fail
 * closed. Better no indicator than a spinner nobody can verify.
 */
const BACKGROUND_RUNNING_MAX_FAILURES = 3;

export /**
 * Daemon opened-session working states that mean a turn is in
 * flight. Closed set (SDK `DroidWorkingState` minus Idle);
 * unrecognized future states fail closed to "not running" so the
 * indicator never spins on guesswork.
 */
const LIVE_DAEMON_WORKING_STATES = new Set([
  'thinking',
  'streaming_assistant_message',
  'waiting_for_tool_confirmation',
  'executing_tool',
  'compacting_conversation',
]);

/** Projects the running registry onto catalog rows (`running`). */
export function stampRunningFlags(
  ctl: ChatControllerInternals,
    sessions: SessionCatalogState,
  ): SessionCatalogState {
    if (ctl.runningSessionIds.size === 0) {
      return sessions;
    }
    return {
      ...sessions,
      items: sessions.items.map((item) =>
        ctl.runningSessionIds.has(item.id)
          ? { ...item, running: true }
          : item,
      ),
    };
}

/**
 * Tracks one session's running flag and streams the change as an
 * incremental `session.running` message. No-op when unchanged, so
 * repeated turn.state pushes and poll ticks stay quiet.
 */
export function setSessionRunning(
  ctl: ChatControllerInternals,
  sessionId: string, running: boolean): void {
    if (ctl.runningSessionIds.has(sessionId) === running) {
      return;
    }
    if (running) {
      ctl.runningSessionIds.add(sessionId);
    } else {
      ctl.runningSessionIds.delete(sessionId);
    }
    ctl.emit({ type: 'session.running', sessionId, running });
}

/**
 * True when a flagged session is not covered by local turn state —
 * a detached daemon turn whose only truth source is the daemon's
 * opened-session registry, so a poll must watch it.
 */
export function hasBackgroundRunning(ctl: ChatControllerInternals): boolean {
    for (const id of ctl.runningSessionIds) {
      if (!(id === ctl.sessionId && isTurnActive(ctl.turn))) {
        return true;
      }
    }
    return false;
}

/** Drops every flag not owned by the local turn (fail closed). */
export function clearBackgroundRunning(ctl: ChatControllerInternals): void {
    for (const id of [...ctl.runningSessionIds]) {
      if (!(id === ctl.sessionId && isTurnActive(ctl.turn))) {
        setSessionRunning(ctl, id, false);
      }
    }
}

/**
 * Watches detached running sessions through the daemon's
 * opened-session registry and clears each flag when its session
 * stops reporting a live working state. One cheap registry RPC per
 * tick; the loop ends itself when nothing is left to watch.
 */
export function ensureBackgroundRunningPoll(ctl: ChatControllerInternals): void {
    const daemonSessions = ctl.daemonSessions;
    if (
      ctl.backgroundRunningPoll !== null ||
      daemonSessions === undefined ||
      !hasBackgroundRunning(ctl)
    ) {
      return;
    }
    const poll = (async () => {
      let failures = 0;
      while (!ctl.disposed && hasBackgroundRunning(ctl)) {
        await delay(BACKGROUND_RUNNING_POLL_MS);
        if (ctl.disposed || !hasBackgroundRunning(ctl)) {
          return;
        }
        let states: ReadonlyMap<string, string>;
        try {
          states = await (
            await daemonSessions()
          ).readOpenedWorkingStates();
        } catch {
          failures += 1;
          if (failures >= BACKGROUND_RUNNING_MAX_FAILURES) {
            clearBackgroundRunning(ctl);
            return;
          }
          continue;
        }
        failures = 0;
        if (ctl.disposed) {
          return;
        }
        for (const id of [...ctl.runningSessionIds]) {
          // The active session's flag is owned by local turn state.
          if (id === ctl.sessionId && isTurnActive(ctl.turn)) {
            continue;
          }
          if (!LIVE_DAEMON_WORKING_STATES.has(states.get(id) ?? '')) {
            setSessionRunning(ctl, id, false);
          }
        }
      }
    })().finally(() => {
      ctl.backgroundRunningPoll = null;
      // A flag added while the loop was exiting still gets a watcher.
      if (!ctl.disposed && hasBackgroundRunning(ctl)) {
        ensureBackgroundRunningPoll(ctl);
      }
    });
    ctl.backgroundRunningPoll = poll;
}

/**
 * Reconciles the running registry against the daemon's
 * opened-session registry after a catalog load: rows with a live
 * daemon turn (detached from here, another window, or the CLI)
 * gain the flag, stale flags drop. Quiet on failure — the
 * indicator stays as-is until the next refresh.
 */
export function seedBackgroundRunning(
  ctl: ChatControllerInternals,
  cwd: string): void {
    const daemonSessions = ctl.daemonSessions;
    if (daemonSessions === undefined) {
      return;
    }
    void (async () => {
      let states: ReadonlyMap<string, string>;
      try {
        states = await (
          await daemonSessions()
        ).readOpenedWorkingStates();
      } catch {
        return;
      }
      if (ctl.disposed || ctl.catalogCwd !== cwd) {
        return;
      }
      const known = new Set<string>();
      for (const item of ctl.sessions.items) {
        known.add(item.id);
        // The active session's flag is owned by local turn state.
        if (item.id === ctl.sessionId) {
          continue;
        }
        setSessionRunning(ctl, 
          item.id,
          LIVE_DAEMON_WORKING_STATES.has(states.get(item.id) ?? ''),
        );
      }
      // Prune flags of rows that left the catalog (archived away).
      for (const id of [...ctl.runningSessionIds]) {
        if (id !== ctl.sessionId && !known.has(id)) {
          setSessionRunning(ctl, id, false);
        }
      }
      ensureBackgroundRunningPoll(ctl);
    })();
}
