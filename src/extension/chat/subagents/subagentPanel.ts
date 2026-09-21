import {
  subagentIdentityKey,
  type SubagentInvocationRecord,
} from '../../../runtime/subagents/subagentSummary';
import { type SessionTranscriptItem } from '../../../shared/protocol/transcript';
import type { SubagentActivityItem } from '../../../shared/protocol/subagentProtocol';
import type { SubagentPanelPort } from './subagentPanelPort';
import type { SubagentViewerSnapshot } from './SubagentTranscriptService';

interface SubagentPanelState {
  sessionId: string | null;
  unsubscribe: (() => void) | null;
  mappingBusy: Promise<void> | null;
  lastEmitted: Map<string, string>;
}

const states = new WeakMap<object, SubagentPanelState>();

function stateOf(ctl: SubagentPanelPort): SubagentPanelState {
  let state = states.get(ctl);
  if (state === undefined) {
    state = {
      sessionId: ctl.sessionState.sessionId,
      unsubscribe: null,
      mappingBusy: null,
      lastEmitted: new Map(),
    };
    states.set(ctl, state);
  } else if (state.sessionId !== ctl.sessionState.sessionId) {
    state.unsubscribe?.();
    state.sessionId = ctl.sessionState.sessionId;
    state.unsubscribe = null;
    state.mappingBusy = null;
    state.lastEmitted.clear();
  }
  return state;
}

export function handleSubagentPanel(
  ctl: SubagentPanelPort,
  sessionId: string,
  open: boolean,
): void {
  if (sessionId !== ctl.sessionState.sessionId) {
    return;
  }
  const state = stateOf(ctl);
  if (!open) {
    state.unsubscribe?.();
    state.unsubscribe = null;
    state.lastEmitted.clear();
    return;
  }
  if (!ctl.sessionState.disposed && ctl.subagentState.subagentTranscripts !== null && state.unsubscribe === null) {
    state.unsubscribe = () => undefined;
    state.unsubscribe = ctl.subagentState.subagentTranscripts.subscribeParent(
      sessionId,
      (turnId, toolUseId, activities, lifecycle) => {
        if (!ctl.sessionState.disposed && ctl.sessionState.sessionId === sessionId) {
          emitLifecycle(ctl, sessionId, turnId, toolUseId, lifecycle);
          emitActivity(ctl, sessionId, turnId, toolUseId, activities);
        }
      },
    );
  }
  void ensureMapping(ctl);
}

export function handleSubagentOpen(
  ctl: SubagentPanelPort,
  sessionId: string,
  turnId: string,
  toolUseId: string,
): void {
  if (
    sessionId !== ctl.sessionState.sessionId ||
    !hasSubagentRow(ctl.recoveryState.transcript.transcript, turnId, toolUseId)
  ) {
    return;
  }
  void ensureMapping(ctl).then(() => {
    if (
      ctl.sessionState.disposed ||
      ctl.sessionState.sessionId !== sessionId ||
      ctl.subagentState.subagentTranscripts === null
    ) {
      return;
    }
    const opened = ctl.subagentState.subagentTranscripts.open(
      sessionId,
      turnId,
      toolUseId,
    );
    if (!opened) {
      ctl.emit({
        type: 'runtime.diagnostic',
        sessionId,
        turnId,
        severity: 'warning',
        code: 'subagent-transcript-unavailable',
        message: 'This subagent transcript is unavailable.',
      });
    }
  });
}

export function stopSubagentPanelPoll(ctl: SubagentPanelPort): void {
  const state = stateOf(ctl);
  state.unsubscribe?.();
  state.unsubscribe = null;
  state.lastEmitted.clear();
}

/** Retained for callers that explicitly request an immediate mapping refresh. */
export function pollTick(ctl: SubagentPanelPort): Promise<void> {
  return ensureMapping(ctl);
}

async function ensureMapping(ctl: SubagentPanelPort): Promise<void> {
  const state = stateOf(ctl);
  if (state.mappingBusy !== null) {
    return state.mappingBusy;
  }
  const sessionId = ctl.sessionState.sessionId;
  const cwd = ctl.sessionState.activeRuntimeCwd;
  const service = ctl.subagentState.subagentTranscripts;
  const load = ctl.sessionHistory.loadSubagentInvocations?.bind(ctl.sessionHistory);
  if (sessionId === null || cwd === null || service === null || load === undefined) {
    return;
  }
  const task = (async (): Promise<void> => {
    const records = await load({ cwd, sessionId });
    if (
      records !== null &&
      !ctl.sessionState.disposed &&
      ctl.sessionState.sessionId === sessionId
    ) {
      await service.syncParent(
        sessionId,
        cwd,
        ctl.recoveryState.transcript.transcript,
        records,
      );
    }
  })();
  state.mappingBusy = task;
  try {
    await task;
  } finally {
    if (state.mappingBusy === task) {
      state.mappingBusy = null;
    }
  }
}

export function pairInvocationMapping(
  items: readonly SessionTranscriptItem[],
  records: readonly SubagentInvocationRecord[],
): Map<string, string | null> {
  const direct = new Map(
    records.flatMap((record) =>
      record.parentToolUseId === undefined
        ? []
        : [[record.parentToolUseId, record] as const],
    ),
  );
  const queues = new Map<string, SubagentInvocationRecord[]>();
  for (const record of records.filter(
    (candidate) => candidate.parentToolUseId === undefined,
  )) {
    const key = subagentIdentityKey(record.summary.type, record.summary.description);
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
    const key = subagentIdentityKey(item.subagent.type, item.subagent.description);
    mapping.set(
      item.toolUseId,
      direct.get(item.toolUseId)?.childSessionId ??
        queues.get(key)?.shift()?.childSessionId ??
        null,
    );
  }
  return mapping;
}

function hasSubagentRow(
  items: readonly SessionTranscriptItem[],
  turnId: string,
  toolUseId: string,
): boolean {
  return items.some(
    (item) =>
      item.kind === 'tool' &&
      item.turnId === turnId &&
      item.toolUseId === toolUseId &&
      item.subagent !== undefined,
  );
}

function emitActivity(
  ctl: SubagentPanelPort,
  sessionId: string,
  turnId: string,
  toolUseId: string,
  activities: readonly SubagentActivityItem[],
): void {
  const state = stateOf(ctl);
  const fingerprint = JSON.stringify(activities);
  if (state.lastEmitted.get(toolUseId) === fingerprint) {
    return;
  }
  state.lastEmitted.set(toolUseId, fingerprint);
  ctl.emit({
    type: 'subagent.activity',
    sessionId,
    turnId,
    toolUseId,
    activities,
  });
}

function emitLifecycle(
  ctl: SubagentPanelPort, sessionId: string, turnId: string, toolUseId: string,
  lifecycle: SubagentViewerSnapshot['lifecycle'] | undefined,
): void {
  if (lifecycle === undefined || lifecycle === 'starting') return;
  const row = ctl.recoveryState.transcript.transcript.find((item) =>
    item.kind === 'tool' && item.toolUseId === toolUseId && item.turnId === turnId);
  const status = lifecycle === 'working' ? 'running' : lifecycle;
  if (row?.kind !== 'tool' || row.subagent === undefined || row.subagent.status === status) return;
  ctl.emit({ type: 'subagent.update', sessionId, turnId, toolUseId,
    subagent: { ...row.subagent, status } });
}
