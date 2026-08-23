// Host-side live activity sampler for inline Subagent cards. Child
// session ids remain host-only; the webview receives only a bounded
// semantic activity trail keyed by the parent Task's toolUseId.
import type { SessionTranscriptItem } from '../../shared/bridgeMessages';
import type { SubagentActivityItem } from '../../shared/subagentProtocol';
import {
  subagentIdentityKey,
  type SubagentInvocationRecord,
} from '../../runtime/subagentSummary';
import type { ChatControllerInternals } from './internals';

export const SUBAGENT_ACTIVITY_POLL_MS = 2_500;
const BACKOFF_TICKS_AFTER_FAILURE = 3;
const MAPPING_FRESH_MS = 15_000;

interface SubagentPanelState {
  sessionId: string | null;
  open: boolean;
  timer: ReturnType<typeof setInterval> | null;
  pollBusy: boolean;
  skipTicks: number;
  mapping: Map<string, string | null>;
  mappingSessionId: string | null;
  mappingAt: number;
  mappingBusy: {
    readonly sessionId: string;
    readonly task: Promise<boolean>;
  } | null;
  mappingFailureLogged: boolean;
  lastEmitted: Map<string, string>;
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
      mappingFailureLogged: false,
      lastEmitted: new Map(),
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
    state.mappingBusy = null;
    state.mappingFailureLogged = false;
  }
  return state;
}

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
  const workspaceRoot = ctl.activeRuntimeCwd;
  const rows = runningSubagentRowsOf(ctl);
  if (rows.length === 0) {
    state.lastEmitted.clear();
    return;
  }
  const runningIds = new Set(rows.map((row) => row.toolUseId));
  for (const toolUseId of state.lastEmitted.keys()) {
    if (!runningIds.has(toolUseId)) {
      state.lastEmitted.delete(toolUseId);
    }
  }
  state.pollBusy = true;
  try {
    const mappingReady = await ensureMapping(
      ctl,
      rows.some((row) => !state.mapping.has(row.toolUseId)),
    );
    if (ctl.disposed || ctl.sessionId !== sessionId || !state.open) {
      return;
    }
    const gateway = ctl.subagentControl?.() ?? null;
    const samples = await Promise.all(rows.map(async (row) => {
      const childId = mappingReady
        ? (state.mapping.get(row.toolUseId) ?? null)
        : null;
      if (
        gateway === null ||
        childId === null ||
        workspaceRoot === null
      ) {
        return { row, activities: [], sampled: false };
      }
      return {
        row,
        activities: await gateway.sampleActivities(
          childId,
          workspaceRoot,
        ),
        sampled: true,
      };
    }));
    if (
      ctl.disposed ||
      ctl.sessionId !== sessionId ||
      !state.open
    ) {
      return;
    }
    for (const { row, activities } of samples) {
      emitActivity(ctl, sessionId, row, activities);
    }
    const sampled = samples.filter((sample) => sample.sampled);
    if (
      sampled.length > 0 &&
      sampled.every((sample) => sample.activities.length === 0)
    ) {
      state.skipTicks = BACKOFF_TICKS_AFTER_FAILURE;
    }
  } finally {
    state.pollBusy = false;
  }
}

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
  if (state.mappingBusy?.sessionId === sessionId) {
    return state.mappingBusy.task;
  }
  const task = (async (): Promise<boolean> => {
    const records = await load({ cwd, sessionId }).catch(() => null);
    if (
      records === null ||
      ctl.disposed ||
      ctl.sessionId !== sessionId
    ) {
      state.mappingSessionId = null;
      state.mappingAt = 0;
      if (
        records === null &&
        !ctl.disposed &&
        ctl.sessionId === sessionId &&
        !state.mappingFailureLogged
      ) {
        state.mappingFailureLogged = true;
        ctl.recordHost({
          level: 'warn',
          name: 'host.subagent.mapping',
          attributes: { outcome: 'ledger-failed', sessionId },
        });
      }
      return false;
    }
    state.mappingFailureLogged = false;
    state.mapping = pairInvocationMapping(
      ctl.transcript.transcript,
      records,
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

export function pairInvocationMapping(
  items: readonly SessionTranscriptItem[],
  records: readonly SubagentInvocationRecord[],
): Map<string, string | null> {
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
  const mapping = new Map<string, string | null>();
  for (const item of items) {
    if (item.kind !== 'tool' || item.subagent === undefined) {
      continue;
    }
    const key = subagentIdentityKey(
      item.subagent.type,
      item.subagent.description,
    );
    mapping.set(
      item.toolUseId,
      queues.get(key)?.shift()?.childSessionId ?? null,
    );
  }
  return mapping;
}

function runningSubagentRowsOf(
  ctl: ChatControllerInternals,
): ReadonlyArray<{ toolUseId: string; turnId: string }> {
  const rows: Array<{ toolUseId: string; turnId: string }> = [];
  for (const item of ctl.transcript.transcript) {
    if (
      item.kind === 'tool' &&
      item.subagent !== undefined &&
      (item.subagent.status === 'running' ||
        (item.subagent.status === undefined &&
          item.status === 'running'))
    ) {
      rows.push({
        toolUseId: item.toolUseId,
        turnId: item.turnId,
      });
    }
  }
  return rows;
}

function emitActivity(
  ctl: ChatControllerInternals,
  sessionId: string,
  row: { readonly toolUseId: string; readonly turnId: string },
  activities: readonly SubagentActivityItem[],
): void {
  const state = stateOf(ctl);
  const fingerprint = JSON.stringify(activities);
  if (state.lastEmitted.get(row.toolUseId) === fingerprint) {
    return;
  }
  state.lastEmitted.set(row.toolUseId, fingerprint);
  ctl.emit({
    type: 'subagent.activity',
    sessionId,
    turnId: row.turnId,
    toolUseId: row.toolUseId,
    activities,
  });
}
