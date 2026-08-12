import {
  MAX_ASSISTANT_TEXT_LENGTH,
  MAX_CHANGED_FILES_PER_TURN,
  MAX_THINKING_TEXT_LENGTH,
  MAX_TOOL_ACTIVITIES_PER_TURN,
  MAX_TOOL_PROGRESS_UPDATES_PER_TOOL,
  type ToolActivityStatus,
  type ToolActivityUpdateKind,
  type ToolBackgroundHint,
  type ToolDetailKind,
  type ToolSubagentSummary,
} from '../shared/bridgeMessages';
import { toolNameCandidates } from '../shared/toolActivity';
import type { RuntimeEvent } from '../runtime/runtimeEvents';
import {
  createSubagentQueues,
  subagentIdentityKey,
  takeSubagentSummaryLast,
} from '../runtime/subagentSummary';

type ToolEvent = Extract<
  RuntimeEvent,
  { type: 'tool-start' | 'tool-progress' | 'tool-result' }
>;

export interface ThinkingDeltaProjection {
  readonly delta: string;
  readonly truncated: boolean;
  /** 0-based thinking segment ordinal within the turn. */
  readonly segmentIndex: number;
}

export interface AssistantDeltaProjection {
  readonly delta: string;
  readonly truncated: boolean;
}

export interface ToolActivityProjection {
  readonly toolUseId: string;
  readonly toolName: string;
  readonly action: string;
  readonly status: ToolActivityStatus;
  readonly progressCount: number;
  readonly latestUpdateKind: ToolActivityUpdateKind | null;
  readonly durationMs?: number;
  readonly filePath?: string;
  readonly detailKind?: ToolDetailKind;
  readonly detail?: string;
  readonly errorMessage?: string;
  /** Trailing execute output; sticks so completion keeps the tail. */
  readonly outputTail?: string;
  /** Sticks once seen: the CLI backgrounded this execute call. */
  readonly backgroundHint?: ToolBackgroundHint;
  readonly subagent?: ToolSubagentSummary;
}

interface ToolActivityEntry {
  /** Stored so out-of-band projections can re-emit the full row. */
  readonly toolName: string;
  readonly action: string;
  readonly status: ToolActivityStatus;
  readonly progressCount: number;
  readonly latestUpdateKind: ToolActivityUpdateKind | null;
  readonly startedAtMs?: number;
  readonly filePath?: string;
  /** All changed paths of a multi-file call; `filePath` is the first. */
  readonly filePaths?: readonly string[];
  readonly detailKind?: ToolDetailKind;
  readonly detail?: string;
  readonly errorMessage?: string;
  readonly outputTail?: string;
  readonly backgroundHint?: ToolBackgroundHint;
  readonly subagent?: ToolSubagentSummary;
}

export interface TurnActivityState {
  readonly assistantTextLength: number;
  readonly assistantTruncated: boolean;
  readonly thinkingTextLength: number;
  readonly thinkingTruncated: boolean;
  /**
   * `messageId:blockIndex` of the last thinking segment that
   * projected visible text; completes only surface for this key so
   * empty segments (probed: complete-only, zero deltas) stay silent.
   */
  readonly thinkingSegmentKey: string | null;
  /** 0-based ordinal of that segment; -1 before any segment opens. */
  readonly thinkingSegmentIndex: number;
  readonly tools: ReadonlyMap<string, ToolActivityEntry>;
}

export interface ActivityProjectionResult<Projection> {
  readonly state: TurnActivityState;
  readonly projection: Projection | null;
}

export function createTurnActivityState(): TurnActivityState {
  return {
    assistantTextLength: 0,
    assistantTruncated: false,
    thinkingTextLength: 0,
    thinkingTruncated: false,
    thinkingSegmentKey: null,
    thinkingSegmentIndex: -1,
    tools: new Map(),
  };
}

/** Segment identity key of one runtime thinking event. */
export function thinkingSegmentKey(event: {
  readonly messageId: string;
  readonly blockIndex: number;
}): string {
  return `${event.messageId}:${event.blockIndex}`;
}

/**
 * Unique workspace-relative file paths the turn's tools changed, in
 * first-observed order, clipped to the bridge's changed-files bound
 * so the published summary always validates.
 */
export function collectToolFilePaths(
  state: TurnActivityState,
): readonly string[] {
  const paths: string[] = [];
  const seen = new Set<string>();
  for (const entry of state.tools.values()) {
    const entryPaths =
      entry.filePaths ??
      (entry.filePath === undefined ? [] : [entry.filePath]);
    for (const path of entryPaths) {
      if (seen.has(path)) {
        continue;
      }
      if (paths.length >= MAX_CHANGED_FILES_PER_TURN) {
        return paths;
      }
      seen.add(path);
      paths.push(path);
    }
  }
  return paths;
}

export function projectAssistantDelta(
  state: TurnActivityState,
  text: string,
): ActivityProjectionResult<AssistantDeltaProjection> {
  if (state.assistantTruncated || text.length === 0) {
    return { state, projection: null };
  }

  const remaining =
    MAX_ASSISTANT_TEXT_LENGTH - state.assistantTextLength;
  const delta = text.slice(0, Math.max(0, remaining));
  const truncated = text.length > remaining;

  return {
    state: {
      ...state,
      assistantTextLength: state.assistantTextLength + delta.length,
      assistantTruncated: truncated,
    },
    projection: { delta, truncated },
  };
}

export function projectThinkingDelta(
  state: TurnActivityState,
  text: string,
  segmentKey: string,
): ActivityProjectionResult<ThinkingDeltaProjection> {
  if (state.thinkingTruncated) {
    return { state, projection: null };
  }
  if (text.length === 0) {
    return { state, projection: null };
  }

  const remaining =
    MAX_THINKING_TEXT_LENGTH - state.thinkingTextLength;
  const delta = text.slice(0, Math.max(0, remaining));
  const truncated = text.length > remaining;
  // A segment only opens with visible text: the bare truncation
  // marker after an exact fill stays pinned to the last real segment
  // so no empty row appears past the cumulative cap.
  const opensSegment =
    delta.length > 0 && segmentKey !== state.thinkingSegmentKey;
  const segmentIndex = opensSegment
    ? state.thinkingSegmentIndex + 1
    : state.thinkingSegmentIndex;

  return {
    state: {
      ...state,
      thinkingTextLength: state.thinkingTextLength + delta.length,
      thinkingTruncated: truncated,
      ...(delta.length > 0
        ? {
            thinkingSegmentKey: segmentKey,
            thinkingSegmentIndex: segmentIndex,
          }
        : {}),
    },
    projection: { delta, truncated, segmentIndex },
  };
}

/**
 * Resolves which segment a thinking completion targets. Only the
 * segment that last projected visible text completes; completions
 * for unknown keys (empty or fully clipped segments) project
 * nothing so no empty Thinking row ever appears.
 */
export function projectThinkingComplete(
  state: TurnActivityState,
  segmentKey: string,
): { readonly segmentIndex: number } | null {
  return state.thinkingSegmentKey === segmentKey
    ? { segmentIndex: state.thinkingSegmentIndex }
    : null;
}

export function projectToolEvent(
  state: TurnActivityState,
  event: ToolEvent,
  nowMs: number = Date.now(),
): ActivityProjectionResult<ToolActivityProjection> {
  const existing = state.tools.get(event.toolUseId);
  if (existing !== undefined) {
    if (existing.status !== 'running') {
      return { state, projection: null };
    }

    if (event.type === 'tool-progress') {
      if (existing.progressCount >= MAX_TOOL_PROGRESS_UPDATES_PER_TOOL) {
        // The count pins at the cap, but a fresh output tail still
        // projects so long-running commands keep streaming output.
        if (
          event.outputTail === undefined ||
          event.outputTail === existing.outputTail
        ) {
          return { state, projection: null };
        }
        const entry: ToolActivityEntry = {
          ...existing,
          latestUpdateKind: event.updateKind,
          outputTail: event.outputTail,
        };
        const tools = new Map(state.tools);
        tools.set(event.toolUseId, entry);
        return {
          state: { ...state, tools },
          projection: projectEntry(event, entry),
        };
      }
      const entry: ToolActivityEntry = {
        ...existing,
        status: 'running',
        progressCount: existing.progressCount + 1,
        latestUpdateKind: event.updateKind,
        // Updates without output keep the last tail visible.
        ...(event.outputTail === undefined
          ? {}
          : { outputTail: event.outputTail }),
      };
      const tools = new Map(state.tools);
      tools.set(event.toolUseId, entry);
      return {
        state: { ...state, tools },
        projection: projectEntry(event, entry),
      };
    }

    if (event.type !== 'tool-result') {
      // A later tool-start can complete a streamed tool call's input:
      // the CLI re-emits tool_call_delta as the input JSON
      // accumulates, and a partial parse can close a string value
      // mid-way (observed 2026-08-12: a Create path truncated to
      // "Canvas-API-学习" until the full call carried
      // "Canvas-API-学习文档.md"). Later events always hold an
      // equal-or-more-complete input, so input-derived fields take
      // the latest value instead of pinning the first one.
      if (event.type === 'tool-start') {
        const updatesFilePath =
          event.filePath !== undefined &&
          existing.filePath !== event.filePath;
        const updatesFilePaths =
          event.filePaths !== undefined &&
          !sameFilePaths(existing.filePaths, event.filePaths);
        const updatesDetail =
          event.detail !== undefined && existing.detail !== event.detail;
        // Monotonic: once a streamed input showed fireAndForget the
        // row stays marked even if later events omit the field.
        const addsBackgroundHint =
          event.backgroundHint !== undefined &&
          existing.backgroundHint === undefined;
        if (
          updatesFilePath ||
          updatesFilePaths ||
          updatesDetail ||
          addsBackgroundHint
        ) {
          const entry: ToolActivityEntry = {
            ...existing,
            ...(updatesFilePath ? { filePath: event.filePath } : {}),
            ...(updatesFilePaths ? { filePaths: event.filePaths } : {}),
            ...(updatesDetail
              ? { detailKind: event.detailKind, detail: event.detail }
              : {}),
            ...(addsBackgroundHint
              ? { backgroundHint: event.backgroundHint }
              : {}),
          };
          const tools = new Map(state.tools);
          tools.set(event.toolUseId, entry);
          return {
            state: { ...state, tools },
            projection: projectEntry(event, entry),
          };
        }
      }
      return { state, projection: null };
    }
    const entry: ToolActivityEntry = {
      ...existing,
      status: event.isError ? 'failed' : 'completed',
      ...(event.isError && event.errorText !== undefined
        ? { errorMessage: event.errorText }
        : {}),
    };
    const tools = new Map(state.tools);
    tools.set(event.toolUseId, entry);
    return {
      state: { ...state, tools },
      projection: projectEntry(event, entry, nowMs),
    };
  }

  if (state.tools.size >= MAX_TOOL_ACTIVITIES_PER_TURN) {
    return { state, projection: null };
  }

  const status =
    event.type === 'tool-result'
      ? event.isError
        ? 'failed'
        : 'completed'
      : 'running';
  const entry: ToolActivityEntry = {
    toolName: event.toolName,
    action: event.action,
    status,
    progressCount: event.type === 'tool-progress' ? 1 : 0,
    latestUpdateKind:
      event.type === 'tool-progress' ? event.updateKind : null,
    ...(status === 'running' ? { startedAtMs: nowMs } : {}),
    ...(event.type === 'tool-result' &&
    event.isError &&
    event.errorText !== undefined
      ? { errorMessage: event.errorText }
      : {}),
    ...(event.type === 'tool-start' && event.filePath !== undefined
      ? { filePath: event.filePath }
      : {}),
    ...(event.type === 'tool-start' && event.filePaths !== undefined
      ? { filePaths: event.filePaths }
      : {}),
    ...(event.type === 'tool-start' && event.detail !== undefined
      ? { detailKind: event.detailKind, detail: event.detail }
      : {}),
    ...(event.type === 'tool-start' &&
    event.backgroundHint !== undefined
      ? { backgroundHint: event.backgroundHint }
      : {}),
    ...(event.type === 'tool-progress' &&
    event.outputTail !== undefined
      ? { outputTail: event.outputTail }
      : {}),
  };
  const tools = new Map(state.tools);
  tools.set(event.toolUseId, entry);
  return {
    state: { ...state, tools },
    projection: projectEntry(event, entry, nowMs),
  };
}

function sameFilePaths(
  existing: readonly string[] | undefined,
  incoming: readonly string[],
): boolean {
  return (
    existing !== undefined &&
    existing.length === incoming.length &&
    existing.every((path, index) => path === incoming[index])
  );
}

function projectEntry(
  event: ToolEvent,
  entry: ToolActivityEntry,
  nowMs?: number,
): ToolActivityProjection {
  const durationMs =
    nowMs !== undefined &&
    entry.startedAtMs !== undefined &&
    (entry.status === 'completed' || entry.status === 'failed')
      ? Math.max(0, Math.round(nowMs - entry.startedAtMs))
      : undefined;
  return {
    toolUseId: event.toolUseId,
    toolName: event.toolName,
    action: event.action,
    status: entry.status,
    progressCount: entry.progressCount,
    latestUpdateKind: entry.latestUpdateKind,
    ...(durationMs === undefined ? {} : { durationMs }),
    ...(entry.filePath === undefined
      ? {}
      : { filePath: entry.filePath }),
    ...(entry.detail === undefined || entry.detailKind === undefined
      ? {}
      : { detailKind: entry.detailKind, detail: entry.detail }),
    ...(entry.errorMessage === undefined
      ? {}
      : { errorMessage: entry.errorMessage }),
    ...(entry.outputTail === undefined
      ? {}
      : { outputTail: entry.outputTail }),
    ...(entry.backgroundHint === undefined
      ? {}
      : { backgroundHint: entry.backgroundHint }),
    ...(entry.subagent === undefined
      ? {}
      : { subagent: entry.subagent }),
  };
}

/**
 * Upgrades one Task tool row to a subagent row when the runtime saw a
 * `child_session_available` notification. The row is resolved by the
 * notification's parent tool-use id, falling back to the most recent
 * running Task tool without a subagent (older CLIs omit the id). A
 * turn with no matching Task row projects nothing.
 */
export function projectSubagentStarted(
  state: TurnActivityState,
  started: {
    readonly toolUseId: string | null;
    readonly subagentType: string;
    readonly description: string;
  },
): ActivityProjectionResult<ToolActivityProjection> {
  const toolUseId = resolveSubagentTarget(state, started.toolUseId);
  if (toolUseId === null) {
    return { state, projection: null };
  }
  const existing = state.tools.get(toolUseId)!;
  if (existing.subagent !== undefined) {
    return { state, projection: null };
  }
  const entry: ToolActivityEntry = {
    ...existing,
    subagent: {
      type: started.subagentType,
      description: started.description,
      status: 'running',
    },
  };
  const tools = new Map(state.tools);
  tools.set(toolUseId, entry);
  return {
    state: { ...state, tools },
    projection: projectEntryStandalone(toolUseId, entry),
  };
}

function resolveSubagentTarget(
  state: TurnActivityState,
  toolUseId: string | null,
): string | null {
  if (toolUseId !== null && state.tools.has(toolUseId)) {
    return toolUseId;
  }
  let fallback: string | null = null;
  for (const [id, entry] of state.tools) {
    if (
      entry.status === 'running' &&
      entry.subagent === undefined &&
      toolNameCandidates(entry.toolName).includes('task')
    ) {
      fallback = id;
    }
  }
  return fallback;
}

/** Whether any tool row of the turn was upgraded to a subagent row. */
export function hasSubagentRows(state: TurnActivityState): boolean {
  for (const entry of state.tools.values()) {
    if (entry.subagent !== undefined) {
      return true;
    }
  }
  return false;
}

/**
 * Settles the turn's subagent rows with the session ledger's final
 * summaries after the turn ends. Only rows whose Task tool already
 * reached a terminal status settle: a still-`running` row means the
 * turn broke off mid-delegation, and re-emitting it would resurrect a
 * live status on a stopped transcript row (history reload shows the
 * ledger truth for those). The whole-session ledger may contain older
 * invocations of the same identity from earlier turns, so rows pair
 * with entries newest-first.
 */
export function reconcileSubagentSummaries(
  state: TurnActivityState,
  summaries: readonly ToolSubagentSummary[],
): {
  readonly state: TurnActivityState;
  readonly projections: readonly ToolActivityProjection[];
} {
  if (summaries.length === 0) {
    return { state, projections: [] };
  }

  const queues = createSubagentQueues(summaries);
  const rows = [...state.tools].filter(
    ([, entry]) =>
      entry.subagent !== undefined && entry.status !== 'running',
  );
  const updates: Array<[string, ToolActivityEntry]> = [];
  for (const [toolUseId, entry] of rows.reverse()) {
    const subagent = entry.subagent!;
    const settled = takeSubagentSummaryLast(
      queues,
      subagent.type,
      subagent.description,
    );
    if (settled === undefined || settled.status === subagent.status) {
      continue;
    }
    updates.push([toolUseId, { ...entry, subagent: settled }]);
  }
  if (updates.length === 0) {
    return { state, projections: [] };
  }

  const tools = new Map(state.tools);
  const projections: ToolActivityProjection[] = [];
  // Re-reverse so emitted updates follow row order.
  for (const [toolUseId, entry] of updates.reverse()) {
    tools.set(toolUseId, entry);
    projections.push(projectEntryStandalone(toolUseId, entry));
  }
  return { state: { ...state, tools }, projections };
}

/**
 * One delegation the turn left running when it ended: the identity
 * the post-turn zombie reconcile needs to keep pairing this row with
 * ledger entries after `turn.activity` has moved on to a newer turn.
 */
export interface PendingSubagentRow {
  readonly turnId: string;
  readonly toolUseId: string;
  readonly type: string;
  readonly description: string;
}

/**
 * Collects the turn's delegations whose subagent is still `running`
 * after settlement — background Task dispatches that outlive the
 * parent turn (probed 2026-08-12: the ledger keeps them `running`
 * until the child actually finishes, minutes after the turn ends).
 */
export function collectRunningSubagentRows(
  state: TurnActivityState,
  turnId: string,
): readonly PendingSubagentRow[] {
  const rows: PendingSubagentRow[] = [];
  for (const [toolUseId, entry] of state.tools) {
    if (entry.subagent?.status !== 'running') {
      continue;
    }
    rows.push({
      turnId,
      toolUseId,
      type: entry.subagent.type,
      description: entry.subagent.description,
    });
  }
  return rows;
}

/**
 * Pairs still-running delegation rows with ledger entries that have
 * since reached a terminal state. Same identity discipline as
 * `reconcileSubagentSummaries` (sanitized type+description, newest
 * entry first), operating on detached row identities so the
 * reconcile keeps working after new turns replaced `turn.activity`.
 *
 * The whole-session ledger may hold old terminal invocations of the
 * same identity from earlier turns, which must not settle a row that
 * is genuinely still running. Per identity, rows only settle while
 * the ledger reports fewer live (`running`/`pending`) entries than
 * rows are waiting: each drop in the live count releases one row,
 * newest row first, paired with the newest terminal entry.
 */
export function settleZombieSubagents(
  rows: readonly PendingSubagentRow[],
  summaries: readonly ToolSubagentSummary[],
): {
  readonly settled: ReadonlyArray<{
    readonly row: PendingSubagentRow;
    readonly subagent: ToolSubagentSummary;
  }>;
  readonly pending: readonly PendingSubagentRow[];
} {
  if (rows.length === 0) {
    return { settled: [], pending: rows };
  }
  const liveCounts = new Map<string, number>();
  const terminal: ToolSubagentSummary[] = [];
  for (const summary of summaries) {
    if (
      summary.status === 'completed' ||
      summary.status === 'failed' ||
      summary.status === 'cancelled'
    ) {
      terminal.push(summary);
    } else {
      const key = subagentIdentityKey(
        summary.type,
        summary.description,
      );
      liveCounts.set(key, (liveCounts.get(key) ?? 0) + 1);
    }
  }
  const queues = createSubagentQueues(terminal);
  const waitingCounts = new Map<string, number>();
  for (const row of rows) {
    const key = subagentIdentityKey(row.type, row.description);
    waitingCounts.set(key, (waitingCounts.get(key) ?? 0) + 1);
  }

  const settled: Array<{
    row: PendingSubagentRow;
    subagent: ToolSubagentSummary;
  }> = [];
  const pending: PendingSubagentRow[] = [];
  // Newest rows claim the newest ledger entries, mirroring the
  // turn-end reconcile.
  for (const row of [...rows].reverse()) {
    const key = subagentIdentityKey(row.type, row.description);
    const waiting = waitingCounts.get(key) ?? 0;
    const live = liveCounts.get(key) ?? 0;
    if (live >= waiting) {
      // As many ledger entries still run as rows wait: this row is
      // one of them, keep it pending.
      pending.push(row);
      liveCounts.set(key, live - 1);
      waitingCounts.set(key, waiting - 1);
      continue;
    }
    waitingCounts.set(key, waiting - 1);
    const subagent = takeSubagentSummaryLast(
      queues,
      row.type,
      row.description,
    );
    if (subagent === undefined) {
      pending.push(row);
    } else {
      settled.push({ row, subagent });
    }
  }
  return {
    settled: settled.reverse(),
    pending: pending.reverse(),
  };
}

/**
 * Applies one zombie settlement to the activity state when the row's
 * turn is still current, so recovery checkpoints and later reloads
 * carry the settled status. A missing row (e.g. the state already
 * belongs to a newer turn) is a no-op.
 */
export function applySubagentSettlement(
  state: TurnActivityState,
  toolUseId: string,
  subagent: ToolSubagentSummary,
): TurnActivityState {
  const entry = state.tools.get(toolUseId);
  if (entry === undefined || entry.subagent === undefined) {
    return state;
  }
  const tools = new Map(state.tools);
  tools.set(toolUseId, { ...entry, subagent });
  return { ...state, tools };
}

/**
 * Projects an entry without a driving tool event, using the stored
 * tool identity instead of event fields.
 */
function projectEntryStandalone(
  toolUseId: string,
  entry: ToolActivityEntry,
): ToolActivityProjection {
  return {
    toolUseId,
    toolName: entry.toolName,
    action: entry.action,
    status: entry.status,
    progressCount: entry.progressCount,
    latestUpdateKind: entry.latestUpdateKind,
    ...(entry.filePath === undefined
      ? {}
      : { filePath: entry.filePath }),
    ...(entry.detail === undefined || entry.detailKind === undefined
      ? {}
      : { detailKind: entry.detailKind, detail: entry.detail }),
    ...(entry.errorMessage === undefined
      ? {}
      : { errorMessage: entry.errorMessage }),
    ...(entry.outputTail === undefined
      ? {}
      : { outputTail: entry.outputTail }),
    ...(entry.backgroundHint === undefined
      ? {}
      : { backgroundHint: entry.backgroundHint }),
    ...(entry.subagent === undefined
      ? {}
      : { subagent: entry.subagent }),
  };
}
