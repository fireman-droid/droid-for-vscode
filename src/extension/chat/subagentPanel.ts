import type { SessionTranscriptItem } from '../../shared/bridgeMessages';
import type { SubagentActivityItem } from '../../shared/subagentProtocol';
import {
  subagentIdentityKey,
  type SubagentInvocationRecord,
} from '../../runtime/subagentSummary';
import type { ChatControllerInternals } from './internals';

interface SubagentPanelState {
  sessionId: string | null;
  unsubscribe: (() => void) | null;
  mappingBusy: Promise<void> | null;
  lastEmitted: Map<string, string>;
}

const states = new WeakMap<object, SubagentPanelState>();

function stateOf(ctl: ChatControllerInternals): SubagentPanelState {
  let state = states.get(ctl);
  if (state === undefined) {
    state = {
      sessionId: ctl.sessionId,
      unsubscribe: null,
      mappingBusy: null,
      lastEmitted: new Map(),
    };
    states.set(ctl, state);
  } else if (state.sessionId !== ctl.sessionId) {
    state.unsubscribe?.();
    state.sessionId = ctl.sessionId;
    state.unsubscribe = null;
    state.mappingBusy = null;
    state.lastEmitted.clear();
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
  if (!open) {
    state.unsubscribe?.();
    state.unsubscribe = null;
    state.lastEmitted.clear();
    return;
  }
  void ensureMapping(ctl).then(() => {
    if (
      ctl.disposed ||
      ctl.sessionId !== sessionId ||
      ctl.subagentTranscripts === null ||
      state.unsubscribe !== null
    ) {
      return;
    }
    state.unsubscribe = ctl.subagentTranscripts.subscribeParent(
      sessionId,
      (turnId, toolUseId, activities) => {
        emitActivity(ctl, sessionId, turnId, toolUseId, activities);
      },
    );
  });
}

export function handleSubagentOpen(
  ctl: ChatControllerInternals,
  sessionId: string,
  turnId: string,
  toolUseId: string,
): void {
  if (
    sessionId !== ctl.sessionId ||
    !hasSubagentRow(ctl.transcript.transcript, turnId, toolUseId)
  ) {
    return;
  }
  void ensureMapping(ctl).then(() => {
    if (
      ctl.disposed ||
      ctl.sessionId !== sessionId ||
      ctl.subagentTranscripts === null
    ) {
      return;
    }
    const opened = ctl.subagentTranscripts.open(
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

export function stopSubagentPanelPoll(
  ctl: ChatControllerInternals,
): void {
  const state = stateOf(ctl);
  state.unsubscribe?.();
  state.unsubscribe = null;
  state.lastEmitted.clear();
}

/** Retained for callers that explicitly request an immediate mapping refresh. */
export function pollTick(ctl: ChatControllerInternals): Promise<void> {
  return ensureMapping(ctl);
}

async function ensureMapping(
  ctl: ChatControllerInternals,
): Promise<void> {
  const state = stateOf(ctl);
  if (state.mappingBusy !== null) {
    return state.mappingBusy;
  }
  const sessionId = ctl.sessionId;
  const cwd = ctl.activeRuntimeCwd;
  const service = ctl.subagentTranscripts;
  const load = ctl.sessionHistory.loadSubagentInvocations?.bind(
    ctl.sessionHistory,
  );
  if (
    sessionId === null ||
    cwd === null ||
    service === null ||
    load === undefined
  ) {
    return;
  }
  const task = (async (): Promise<void> => {
    const records = await load({ cwd, sessionId });
    if (
      records !== null &&
      !ctl.disposed &&
      ctl.sessionId === sessionId
    ) {
      await service.syncParent(
        sessionId,
        cwd,
        ctl.transcript.transcript,
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
  ctl: ChatControllerInternals,
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
