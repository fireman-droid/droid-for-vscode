import type { SessionRunningPort } from './sessionRunningPort';
import { type SessionCatalogState } from '../../../shared/protocol/sessions';
import { delay, isTurnActive } from '../internals';

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
  ctl: SessionRunningPort,
  sessions: SessionCatalogState,
): SessionCatalogState {
  if (ctl.catalogState.runningSessionIds.size === 0) {
    return sessions;
  }
  return {
    ...sessions,
    items: sessions.items.map((item) =>
      ctl.catalogState.runningSessionIds.has(item.id) ? { ...item, running: true } : item,
    ),
  };
}

/**
 * Tracks one session's running flag and streams the change as an
 * incremental `session.running` message. No-op when unchanged, so
 * repeated turn.state pushes and poll ticks stay quiet.
 */
export function setSessionRunning(
  ctl: SessionRunningPort,
  sessionId: string,
  running: boolean,
): void {
  if (ctl.catalogState.runningSessionIds.has(sessionId) === running) {
    return;
  }
  if (running) {
    ctl.catalogState.runningSessionIds.add(sessionId);
  } else {
    ctl.catalogState.runningSessionIds.delete(sessionId);
  }
  ctl.emit({ type: 'session.running', sessionId, running });
}

/**
 * True when a flagged session is not covered by local turn state —
 * a detached daemon turn whose only truth source is the daemon's
 * opened-session registry, so a poll must watch it.
 */
export function hasBackgroundRunning(ctl: SessionRunningPort): boolean {
  for (const id of ctl.catalogState.runningSessionIds) {
    if (!(id === ctl.sessionState.sessionId && isTurnActive(ctl.turnState.turn))) {
      return true;
    }
  }
  return false;
}

/** Drops every flag not owned by the local turn (fail closed). */
export function clearBackgroundRunning(ctl: SessionRunningPort): void {
  for (const id of [...ctl.catalogState.runningSessionIds]) {
    if (!(id === ctl.sessionState.sessionId && isTurnActive(ctl.turnState.turn))) {
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
export function ensureBackgroundRunningPoll(ctl: SessionRunningPort): void {
  const daemonSessions = ctl.daemonSessions;
  if (
    ctl.catalogState.backgroundRunningPoll !== null ||
    daemonSessions === undefined ||
    !hasBackgroundRunning(ctl)
  ) {
    return;
  }
  const poll = (async () => {
    let failures = 0;
    while (!ctl.sessionState.disposed && hasBackgroundRunning(ctl)) {
      await delay(BACKGROUND_RUNNING_POLL_MS);
      if (ctl.sessionState.disposed || !hasBackgroundRunning(ctl)) {
        return;
      }
      let states: ReadonlyMap<string, string>;
      try {
        states = await (await daemonSessions()).readOpenedWorkingStates();
      } catch {
        failures += 1;
        if (failures >= BACKGROUND_RUNNING_MAX_FAILURES) {
          clearBackgroundRunning(ctl);
          return;
        }
        continue;
      }
      failures = 0;
      if (ctl.sessionState.disposed) {
        return;
      }
      for (const id of [...ctl.catalogState.runningSessionIds]) {
        // The active session's flag is owned by local turn state.
        if (id === ctl.sessionState.sessionId && isTurnActive(ctl.turnState.turn)) {
          continue;
        }
        if (!LIVE_DAEMON_WORKING_STATES.has(states.get(id) ?? '')) {
          setSessionRunning(ctl, id, false);
        }
      }
    }
  })().finally(() => {
    ctl.catalogState.backgroundRunningPoll = null;
    // A flag added while the loop was exiting still gets a watcher.
    if (!ctl.sessionState.disposed && hasBackgroundRunning(ctl)) {
      ensureBackgroundRunningPoll(ctl);
    }
  });
  ctl.catalogState.backgroundRunningPoll = poll;
}

/**
 * Reconciles the running registry against the daemon's
 * opened-session registry after a catalog load: rows with a live
 * daemon turn (detached from here, another window, or the CLI)
 * gain the flag, stale flags drop. Quiet on failure — the
 * indicator stays as-is until the next refresh.
 */
export function seedBackgroundRunning(ctl: SessionRunningPort, cwd: string): void {
  const daemonSessions = ctl.daemonSessions;
  if (daemonSessions === undefined) {
    return;
  }
  void (async () => {
    let states: ReadonlyMap<string, string>;
    try {
      states = await (await daemonSessions()).readOpenedWorkingStates();
    } catch {
      return;
    }
    if (ctl.sessionState.disposed || ctl.catalogState.catalogCwd !== cwd) {
      return;
    }
    const known = new Set<string>();
    for (const item of ctl.catalogState.sessions.items) {
      known.add(item.id);
      // The active session's flag is owned by local turn state.
      if (item.id === ctl.sessionState.sessionId) {
        continue;
      }
      setSessionRunning(
        ctl,
        item.id,
        LIVE_DAEMON_WORKING_STATES.has(states.get(item.id) ?? ''),
      );
    }
    // Prune flags of rows that left the catalog (archived away).
    for (const id of [...ctl.catalogState.runningSessionIds]) {
      if (id !== ctl.sessionState.sessionId && !known.has(id)) {
        setSessionRunning(ctl, id, false);
      }
    }
    ensureBackgroundRunningPoll(ctl);
  })();
}
