import {
  MAX_ASSISTANT_TEXT_LENGTH,
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
  takeSubagentSummaryLast,
} from '../runtime/subagentSummary';

type ToolEvent = Extract<
  RuntimeEvent,
  { type: 'tool-start' | 'tool-progress' | 'tool-result' }
>;

export interface ThinkingDeltaProjection {
  readonly delta: string;
  readonly truncated: boolean;
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
    tools: new Map(),
  };
}

/**
 * Unique workspace-relative file paths the turn's tools changed, in
 * first-observed order.
 */
export function collectToolFilePaths(
  state: TurnActivityState,
): readonly string[] {
  const paths: string[] = [];
  const seen = new Set<string>();
  for (const entry of state.tools.values()) {
    if (entry.filePath !== undefined && !seen.has(entry.filePath)) {
      seen.add(entry.filePath);
      paths.push(entry.filePath);
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

  return {
    state: {
      ...state,
      thinkingTextLength: state.thinkingTextLength + delta.length,
      thinkingTruncated: truncated,
    },
    projection: { delta, truncated },
  };
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
      // A later tool-start can complete a streamed tool call's input,
      // e.g. the file path or command arriving only with the full call.
      if (event.type === 'tool-start') {
        const addsFilePath =
          event.filePath !== undefined &&
          existing.filePath === undefined;
        const addsDetail =
          event.detail !== undefined && existing.detail === undefined;
        // Monotonic: once a streamed input showed fireAndForget the
        // row stays marked even if later events omit the field.
        const addsBackgroundHint =
          event.backgroundHint !== undefined &&
          existing.backgroundHint === undefined;
        if (addsFilePath || addsDetail || addsBackgroundHint) {
          const entry: ToolActivityEntry = {
            ...existing,
            ...(addsFilePath ? { filePath: event.filePath } : {}),
            ...(addsDetail
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
