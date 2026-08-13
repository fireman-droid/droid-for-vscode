// Subagent panel host logic (待办 B slice 1): resolves the webview's
// opaque toolUseId handles onto host-only child session ids, polls
// live per-row activity while the working popup is open, stops one
// delegation on request, and serves the read-only transcript sheet.
// All state lives module-side in a WeakMap so ChatController gains no
// fields; every async continuation re-checks the controller's session
// identity before touching anything (subagentWatch conventions).
import type { SessionTranscriptItem } from '../../shared/bridgeMessages';
import type { SubagentControlGateway } from '../../runtime/subagentControl';
import {
  subagentIdentityKey,
  type SubagentInvocationRecord,
} from '../../runtime/subagentSummary';
import type { ChatControllerInternals } from './internals';

/** Live-activity poll cadence while the popup is open (§0.8: 2–3s). */
export const SUBAGENT_ACTIVITY_POLL_MS = 2_500;
/** Ticks skipped after a sampling failure (simple backoff). */
const BACKOFF_TICKS_AFTER_FAILURE = 3;
/** Mapping loads younger than this are trusted as-is. */
const MAPPING_FRESH_MS = 15_000;

interface SubagentPanelState {
  open: boolean;
  timer: ReturnType<typeof setInterval> | null;
  pollBusy: boolean;
  skipTicks: number;
  /** toolUseId → childSessionId (null = ledger has no id for it). */
  mapping: Map<string, string | null>;
  mappingSessionId: string | null;
  mappingAt: number;
  mappingBusy: Promise<void> | null;
  /** toolUseId → last emitted `action|stoppable` (dedupe). */
  lastEmitted: Map<string, string>;
  /** Transcript requests in flight (single-flight per row). */
  inflightTranscripts: Set<string>;
}

const states = new WeakMap<object, SubagentPanelState>();

function stateOf(ctl: ChatControllerInternals): SubagentPanelState {
  let state = states.get(ctl);
  if (state === undefined) {
    state = {
      open: false,
      timer: null,
      pollBusy: false,
      skipTicks: 0,
      mapping: new Map(),
      mappingSessionId: null,
      mappingAt: 0,
      mappingBusy: null,
      lastEmitted: new Map(),
      inflightTranscripts: new Set(),
    };
    states.set(ctl, state);
  }
  return state;
}

/** The webview popup opened or closed; gates the poll loop. */
export function handleSubagentPanel(
  ctl: ChatControllerInternals,
  sessionId: string,
  open: boolean,
): void {
  if (sessionId !== ctl.sessionId) {
    return;
  }
  const state = stateOf(ctl);
  state.open = open;
  if (!open) {
    stopPoll(state);
    return;
  }
  if (state.timer === null) {
    state.timer = setInterval(() => {
      void pollTick(ctl);
    }, SUBAGENT_ACTIVITY_POLL_MS);
  }
  void pollTick(ctl);
}

export function stopSubagentPanelPoll(
  ctl: ChatControllerInternals,
): void {
  stopPoll(stateOf(ctl));
}

function stopPoll(state: SubagentPanelState): void {
  if (state.timer !== null) {
    clearInterval(state.timer);
    state.timer = null;
  }
  state.lastEmitted.clear();
}

/** One activity sampling pass over the running delegation rows. */
export async function pollTick(
  ctl: ChatControllerInternals,
): Promise<void> {
  const state = stateOf(ctl);
  if (
    state.pollBusy ||
    !state.open ||
    ctl.disposed ||
    ctl.sessionId === null
  ) {
    if (ctl.disposed) {
      stopPoll(state);
    }
    return;
  }
  if (state.skipTicks > 0) {
    state.skipTicks -= 1;
    return;
  }
  const sessionId = ctl.sessionId;
  const gateway = ctl.subagentControl?.() ?? null;
  const rows = runningSubagentRowsOf(ctl);
  if (rows.length === 0) {
    return;
  }
  state.pollBusy = true;
  try {
    const unknown = rows.some((row) => !state.mapping.has(row.toolUseId));
    await ensureMapping(ctl, unknown);
    if (ctl.disposed || ctl.sessionId !== sessionId || !state.open) {
      return;
    }
    let failures = 0;
    for (const row of rows) {
      const childId = state.mapping.get(row.toolUseId) ?? null;
      const stoppable = gateway !== null && childId !== null;
      let action: string | null = null;
      if (stoppable && gateway !== null && childId !== null) {
        action = await gateway.sampleActivity(childId);
        if (action === null) {
          failures += 1;
        }
      }
      if (ctl.disposed || ctl.sessionId !== sessionId) {
        return;
      }
      emitActivity(ctl, sessionId, row, action, stoppable);
    }
    if (failures > 0 && failures === rows.length) {
      state.skipTicks = BACKOFF_TICKS_AFTER_FAILURE;
    }
  } finally {
    state.pollBusy = false;
  }
}

/** Stops exactly one delegation (probed §0.8.4: siblings continue). */
export function handleSubagentStop(
  ctl: ChatControllerInternals,
  sessionId: string,
  turnId: string,
  toolUseId: string,
): void {
  if (sessionId !== ctl.sessionId) {
    return;
  }
  const gateway = ctl.subagentControl?.() ?? null;
  if (gateway === null) {
    return;
  }
  void (async () => {
    const state = stateOf(ctl);
    await ensureMapping(ctl, !state.mapping.has(toolUseId));
    if (ctl.disposed || ctl.sessionId !== sessionId) {
      return;
    }
    const childId = state.mapping.get(toolUseId) ?? null;
    if (childId === null) {
      ctl.recordHost({
        level: 'warn',
        name: 'host.subagent.stop',
        attributes: { outcome: 'unresolved', toolUseId },
      });
      return;
    }
    const ok = await gateway.interrupt(childId);
    ctl.recordHost({
      level: ok ? 'info' : 'warn',
      name: 'host.subagent.stop',
      attributes: { outcome: ok ? 'ok' : 'failed', toolUseId },
    });
    if (ok && !ctl.disposed && ctl.sessionId === sessionId) {
      // Drop the control immediately; the invocation ledger settles
      // the row's terminal status through the existing watch.
      emitActivity(
        ctl,
        sessionId,
        { toolUseId, turnId },
        null,
        false,
      );
    }
  })();
}

/** Serves the read-only child transcript (design §6.1, fail closed). */
export function handleSubagentOpenTranscript(
  ctl: ChatControllerInternals,
  sessionId: string,
  toolUseId: string,
): void {
  if (sessionId !== ctl.sessionId) {
    return;
  }
  const state = stateOf(ctl);
  if (state.inflightTranscripts.has(toolUseId)) {
    return;
  }
  const row = taskRowOf(ctl, toolUseId);
  const title =
    row?.subagent === undefined
      ? ''
      : row.subagent.description.length > 0
        ? row.subagent.description
        : `${row.subagent.type} subagent`;
  const unavailable = (): void => {
    ctl.emit({
      type: 'subagent.transcript',
      sessionId,
      toolUseId,
      status: 'unavailable',
      title,
    });
  };
  const cwd = ctl.activeRuntimeCwd;
  if (row === undefined || cwd === null) {
    unavailable();
    return;
  }
  state.inflightTranscripts.add(toolUseId);
  void (async () => {
    try {
      await ensureMapping(ctl, !state.mapping.has(toolUseId));
      if (ctl.disposed || ctl.sessionId !== sessionId) {
        return;
      }
      const childId = state.mapping.get(toolUseId) ?? null;
      if (childId === null) {
        ctl.recordHost({
          level: 'warn',
          name: 'host.subagent.transcript',
          attributes: { outcome: 'unresolved', toolUseId },
        });
        unavailable();
        return;
      }
      const result = await ctl.sessionHistory.loadHistory({
        cwd,
        sessionId: childId,
      });
      if (ctl.disposed || ctl.sessionId !== sessionId) {
        return;
      }
      if (result.status !== 'available') {
        ctl.recordHost({
          level: 'warn',
          name: 'host.subagent.transcript',
          attributes: { outcome: 'load-failed', toolUseId },
        });
        unavailable();
        return;
      }
      ctl.recordHost({
        level: 'info',
        name: 'host.subagent.transcript',
        attributes: {
          outcome: 'ok',
          items: result.state.transcript.length,
        },
      });
      ctl.emit({
        type: 'subagent.transcript',
        sessionId,
        toolUseId,
        status: 'available',
        title,
        items: result.state.transcript,
        truncated: result.state.truncated,
      });
    } catch {
      if (!ctl.disposed && ctl.sessionId === sessionId) {
        unavailable();
      }
    } finally {
      state.inflightTranscripts.delete(toolUseId);
    }
  })();
}

/**
 * Loads the invocation ledger and pairs it onto the transcript's Task
 * rows (FIFO per sanitized type+description identity, both sides in
 * their natural order — the ledger omits the parent toolUseId, same
 * limitation the settle reconcile works under). Coalesces concurrent
 * callers onto one load.
 */
async function ensureMapping(
  ctl: ChatControllerInternals,
  needed: boolean,
): Promise<void> {
  const state = stateOf(ctl);
  const sessionId = ctl.sessionId;
  const cwd = ctl.activeRuntimeCwd;
  const load = ctl.sessionHistory.loadSubagentInvocations?.bind(
    ctl.sessionHistory,
  );
  if (sessionId === null || cwd === null || load === undefined) {
    return;
  }
  const fresh =
    state.mappingSessionId === sessionId &&
    Date.now() - state.mappingAt < MAPPING_FRESH_MS;
  if (!needed && fresh) {
    return;
  }
  if (state.mappingBusy !== null) {
    await state.mappingBusy;
    return;
  }
  const task = (async () => {
    const records = await load({ cwd, sessionId }).catch(() => null);
    if (
      records === null ||
      ctl.disposed ||
      ctl.sessionId !== sessionId
    ) {
      return;
    }
    state.mapping = pairInvocationMapping(
      ctl.transcript.transcript,
      records,
    );
    state.mappingSessionId = sessionId;
    state.mappingAt = Date.now();
  })();
  state.mappingBusy = task;
  try {
    await task;
  } finally {
    state.mappingBusy = null;
  }
}

/**
 * toolUseId → childSessionId in transcript order against ledger
 * order, FIFO per delegation identity. Exported for focused tests.
 */
export function pairInvocationMapping(
  items: readonly SessionTranscriptItem[],
  records: readonly SubagentInvocationRecord[],
): Map<string, string | null> {
  const queues = new Map<string, Array<string | null>>();
  for (const record of records) {
    const key = subagentIdentityKey(
      record.summary.type,
      record.summary.description,
    );
    const queue = queues.get(key);
    if (queue === undefined) {
      queues.set(key, [record.childSessionId]);
    } else {
      queue.push(record.childSessionId);
    }
  }
  const mapping = new Map<string, string | null>();
  for (const item of items) {
    if (item.kind !== 'tool' || item.subagent === undefined) {
      continue;
    }
    const key = subagentIdentityKey(
      item.subagent.type,
      item.subagent.description,
    );
    mapping.set(item.toolUseId, queues.get(key)?.shift() ?? null);
  }
  return mapping;
}

/**
 * Delegation rows that are live right now. Besides rows the ledger
 * already marked `running`, a statusless delegation under a
 * still-running Task row counts too (same fallback the webview's
 * `selectWorkingSubagents` applies): for a FOREGROUND (blocking)
 * Task the SDK only reports a lifecycle status with the Task's own
 * tool_result, so `subagent.status` stays undefined for the entire
 * visible run. Terminal and pending statuses never count.
 */
function runningSubagentRowsOf(
  ctl: ChatControllerInternals,
): ReadonlyArray<{ toolUseId: string; turnId: string }> {
  const rows: Array<{ toolUseId: string; turnId: string }> = [];
  for (const item of ctl.transcript.transcript) {
    if (item.kind !== 'tool' || item.subagent === undefined) {
      continue;
    }
    const working =
      item.subagent.status === 'running' ||
      (item.subagent.status === undefined && item.status === 'running');
    if (working) {
      rows.push({ toolUseId: item.toolUseId, turnId: item.turnId });
    }
  }
  return rows;
}

function taskRowOf(
  ctl: ChatControllerInternals,
  toolUseId: string,
): Extract<SessionTranscriptItem, { kind: 'tool' }> | undefined {
  for (const item of ctl.transcript.transcript) {
    if (
      item.kind === 'tool' &&
      item.toolUseId === toolUseId &&
      item.subagent !== undefined
    ) {
      return item;
    }
  }
  return undefined;
}

function emitActivity(
  ctl: ChatControllerInternals,
  sessionId: string,
  row: { readonly toolUseId: string; readonly turnId: string },
  action: string | null,
  stoppable: boolean,
): void {
  const state = stateOf(ctl);
  const fingerprint = `${action ?? ''}\u0000${stoppable}`;
  if (state.lastEmitted.get(row.toolUseId) === fingerprint) {
    return;
  }
  state.lastEmitted.set(row.toolUseId, fingerprint);
  ctl.emit({
    type: 'subagent.activity',
    sessionId,
    turnId: row.turnId,
    toolUseId: row.toolUseId,
    action,
    stoppable,
  });
}
