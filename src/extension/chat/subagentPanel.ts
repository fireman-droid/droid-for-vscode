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
  sessionId: string | null;
  open: boolean;
  timer: ReturnType<typeof setInterval> | null;
  pollBusy: boolean;
  skipTicks: number;
  /** toolUseId → childSessionId (null = ledger has no id for it). */
  mapping: Map<string, string | null>;
  mappingSessionId: string | null;
  mappingAt: number;
  mappingBusy: {
    readonly sessionId: string;
    readonly task: Promise<boolean>;
  } | null;
  /** toolUseId → latest paired invocation (host-only child id included). */
  invocations: Map<string, SubagentInvocationRecord | null>;
  /** toolUseId → last emitted `action|stoppable` (dedupe). */
  lastEmitted: Map<string, string>;
  /** Transcript requests in flight (single-flight per row). */
  inflightTranscripts: Set<string>;
  /** Stop requests in flight (single-flight per row). */
  inflightStops: Set<string>;
  /** Successful interrupts waiting for the ledger to settle. */
  settlingStops: Set<string>;
}

const states = new WeakMap<object, SubagentPanelState>();

function stateOf(ctl: ChatControllerInternals): SubagentPanelState {
  let state = states.get(ctl);
  if (state === undefined) {
    state = {
      sessionId: ctl.sessionId,
      open: false,
      timer: null,
      pollBusy: false,
      skipTicks: 0,
      mapping: new Map(),
      mappingSessionId: null,
      mappingAt: 0,
      mappingBusy: null,
      invocations: new Map(),
      lastEmitted: new Map(),
      inflightTranscripts: new Set(),
      inflightStops: new Set(),
      settlingStops: new Set(),
    };
    states.set(ctl, state);
  } else if (state.sessionId !== ctl.sessionId) {
    state.sessionId = ctl.sessionId;
    stopPoll(state);
    state.open = false;
    state.skipTicks = 0;
    state.mapping = new Map();
    state.mappingSessionId = null;
    state.mappingAt = 0;
    state.invocations = new Map();
    state.inflightTranscripts.clear();
    state.inflightStops.clear();
    state.settlingStops.clear();
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
  const workingIds = new Set(rows.map((row) => row.toolUseId));
  for (const key of state.settlingStops) {
    if (
      key.startsWith(`${sessionId}\u0000`) &&
      !workingIds.has(key.slice(sessionId.length + 1))
    ) {
      state.settlingStops.delete(key);
    }
  }
  if (rows.length === 0) {
    return;
  }
  state.pollBusy = true;
  try {
    const unknown = rows.some((row) => !state.mapping.has(row.toolUseId));
    const mappingReady = await ensureMapping(ctl, unknown);
    if (ctl.disposed || ctl.sessionId !== sessionId || !state.open) {
      return;
    }
    let failures = 0;
    for (const row of rows) {
      const childId = mappingReady
        ? (state.mapping.get(row.toolUseId) ?? null)
        : null;
      const key = stopKey(sessionId, row.toolUseId);
      const sampleable =
        gateway !== null &&
        childId !== null &&
        !state.inflightStops.has(key) &&
        !state.settlingStops.has(key);
      let action: string | null = null;
      if (sampleable && gateway !== null && childId !== null) {
        action = await gateway.sampleActivity(childId);
        if (action === null) {
          failures += 1;
        }
      }
      if (ctl.disposed || ctl.sessionId !== sessionId) {
        return;
      }
      // Stop can begin while sampleActivity is awaiting the daemon.
      // Recompute after the await so this tick cannot resurrect the
      // control with a stale `stoppable:true` response.
      const stoppable =
        gateway !== null &&
        childId !== null &&
        !state.inflightStops.has(key) &&
        !state.settlingStops.has(key);
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
  const state = stateOf(ctl);
  const key = stopKey(sessionId, toolUseId);
  const row = taskRowOf(ctl, toolUseId);
  if (
    row === undefined ||
    row.turnId !== turnId ||
    !isWorkingSubagentRow(row)
  ) {
    emitActivity(
      ctl,
      sessionId,
      { toolUseId, turnId },
      null,
      false,
    );
    if (
      row?.subagent !== undefined &&
      isTerminalStatus(row.subagent.status)
    ) {
      ctl.emit({
        type: 'subagent.update',
        sessionId,
        turnId: row.turnId,
        toolUseId,
        subagent: row.subagent,
      });
    }
    ctl.recordHost({
      level: 'info',
      name: 'host.subagent.stop',
      attributes: { outcome: 'already-settled', toolUseId },
    });
    return;
  }
  const gateway = ctl.subagentControl?.() ?? null;
  if (gateway === null) {
    emitActivity(ctl, sessionId, row, null, false);
    return;
  }
  if (state.inflightStops.has(key) || state.settlingStops.has(key)) {
    ctl.recordHost({
      level: 'debug',
      name: 'host.subagent.stop',
      attributes: {
        outcome: state.inflightStops.has(key)
          ? 'ignored-inflight'
          : 'ignored-settling',
        toolUseId,
      },
    });
    return;
  }
  state.inflightStops.add(key);
  // Disable the control before the first await. This closes both the
  // Host race and the visible repeated-click window.
  emitActivity(ctl, sessionId, { toolUseId, turnId }, null, false);
  void (async () => {
    try {
      // Always refresh before interrupting: the Working row may be
      // stale while the durable invocation already reached terminal.
      const refreshed = await ensureMapping(ctl, true);
      if (ctl.disposed || ctl.sessionId !== sessionId) {
        return;
      }
      if (!refreshed) {
        ctl.recordHost({
          level: 'warn',
          name: 'host.subagent.stop',
          attributes: { outcome: 'mapping-failed', toolUseId },
        });
        emitActivity(
          ctl,
          sessionId,
          { toolUseId, turnId },
          null,
          false,
        );
        return;
      }
      const invocation = state.invocations.get(toolUseId) ?? null;
      if (invocation !== null && isTerminalInvocation(invocation)) {
        emitInvocationSettlement(
          ctl,
          sessionId,
          turnId,
          toolUseId,
          invocation,
        );
        ctl.recordHost({
          level: 'info',
          name: 'host.subagent.stop',
          attributes: { outcome: 'already-settled', toolUseId },
        });
        return;
      }
      const childId = invocation?.childSessionId ?? null;
      if (childId === null) {
        ctl.recordHost({
          level: 'warn',
          name: 'host.subagent.stop',
          attributes: { outcome: 'unresolved', toolUseId },
        });
        return;
      }
      const ok = await gateway.interrupt(childId);
      if (ctl.disposed || ctl.sessionId !== sessionId) {
        return;
      }
      ctl.recordHost({
        level: ok ? 'info' : 'warn',
        name: 'host.subagent.stop',
        attributes: { outcome: ok ? 'ok' : 'failed', toolUseId },
      });
      if (ok) {
        // Keep the control suppressed until a durable terminal row
        // replaces the stale Working projection.
        state.settlingStops.add(key);
      }
      if (ok) {
        return;
      }

      // An interrupt can lose a race with natural completion. Refresh
      // once before deciding whether the control should come back.
      const refreshedAfterFailure = await ensureMapping(ctl, true);
      if (ctl.disposed || ctl.sessionId !== sessionId) {
        return;
      }
      if (!refreshedAfterFailure) {
        emitActivity(
          ctl,
          sessionId,
          { toolUseId, turnId },
          null,
          false,
        );
        return;
      }
      const latest = state.invocations.get(toolUseId) ?? null;
      if (latest !== null && isTerminalInvocation(latest)) {
        state.settlingStops.delete(key);
        emitInvocationSettlement(
          ctl,
          sessionId,
          turnId,
          toolUseId,
          latest,
        );
      } else {
        emitActivity(
          ctl,
          sessionId,
          { toolUseId, turnId },
          null,
          true,
        );
      }
    } finally {
      state.inflightStops.delete(key);
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
  const key = stopKey(sessionId, toolUseId);
  if (state.inflightTranscripts.has(key)) {
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
  state.inflightTranscripts.add(key);
  void (async () => {
    try {
      const mappingReady = await ensureMapping(
        ctl,
        !state.mapping.has(toolUseId),
      );
      if (ctl.disposed || ctl.sessionId !== sessionId) {
        return;
      }
      const childId = mappingReady
        ? (state.mapping.get(toolUseId) ?? null)
        : null;
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
      state.inflightTranscripts.delete(key);
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
): Promise<boolean> {
  const state = stateOf(ctl);
  const sessionId = ctl.sessionId;
  const cwd = ctl.activeRuntimeCwd;
  const load = ctl.sessionHistory.loadSubagentInvocations?.bind(
    ctl.sessionHistory,
  );
  if (sessionId === null || cwd === null || load === undefined) {
    return false;
  }
  const fresh =
    state.mappingSessionId === sessionId &&
    Date.now() - state.mappingAt < MAPPING_FRESH_MS;
  if (!needed && fresh) {
    return true;
  }
  if (state.mappingBusy !== null) {
    if (state.mappingBusy.sessionId === sessionId) {
      return state.mappingBusy.task;
    }
  }
  const task = (async (): Promise<boolean> => {
    const records = await load({ cwd, sessionId }).catch(() => null);
    if (
      records === null ||
      ctl.disposed ||
      ctl.sessionId !== sessionId
    ) {
      if (!ctl.disposed && ctl.sessionId === sessionId) {
        // Force the next panel tick to retry rather than trusting a
        // stale child mapping after an authoritative refresh failed.
        state.mappingSessionId = null;
        state.mappingAt = 0;
      }
      return false;
    }
    state.invocations = pairInvocationRecords(
      ctl.transcript.transcript,
      records,
    );
    state.mapping = new Map(
      [...state.invocations].map(([toolUseId, invocation]) => [
        toolUseId,
        invocation?.childSessionId ?? null,
      ]),
    );
    state.mappingSessionId = sessionId;
    state.mappingAt = Date.now();
    return true;
  })();
  const busy = { sessionId, task };
  state.mappingBusy = busy;
  try {
    return await task;
  } finally {
    if (state.mappingBusy === busy) {
      state.mappingBusy = null;
    }
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
  return new Map(
    [...pairInvocationRecords(items, records)].map(
      ([toolUseId, invocation]) => [
        toolUseId,
        invocation?.childSessionId ?? null,
      ],
    ),
  );
}

function pairInvocationRecords(
  items: readonly SessionTranscriptItem[],
  records: readonly SubagentInvocationRecord[],
): Map<string, SubagentInvocationRecord | null> {
  const queues = new Map<string, SubagentInvocationRecord[]>();
  for (const record of records) {
    const key = subagentIdentityKey(
      record.summary.type,
      record.summary.description,
    );
    const queue = queues.get(key);
    if (queue === undefined) {
      queues.set(key, [record]);
    } else {
      queue.push(record);
    }
  }
  const mapping = new Map<string, SubagentInvocationRecord | null>();
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

function isWorkingSubagentRow(
  row: Extract<SessionTranscriptItem, { kind: 'tool' }>,
): boolean {
  return (
    row.subagent?.status === 'running' ||
    (row.subagent?.status === undefined && row.status === 'running')
  );
}

function isTerminalInvocation(invocation: SubagentInvocationRecord): boolean {
  return isTerminalStatus(invocation.summary.status);
}

function isTerminalStatus(status: string | undefined): boolean {
  return (
    status === 'completed' ||
    status === 'failed' ||
    status === 'cancelled'
  );
}

function emitInvocationSettlement(
  ctl: ChatControllerInternals,
  sessionId: string,
  turnId: string,
  toolUseId: string,
  invocation: SubagentInvocationRecord,
): void {
  ctl.emit({
    type: 'subagent.update',
    sessionId,
    turnId,
    toolUseId,
    subagent: invocation.summary,
  });
}

function stopKey(sessionId: string, toolUseId: string): string {
  return `${sessionId}\u0000${toolUseId}`;
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
    if (isWorkingSubagentRow(item)) {
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
