import {
  MAX_ASSISTANT_TEXT_LENGTH,
  MAX_THINKING_TEXT_LENGTH,
  MAX_TOOL_ACTIVITIES_PER_TURN,
  MAX_TOOL_PROGRESS_UPDATES_PER_TOOL,
  type ToolActivityStatus,
  type ToolActivityUpdateKind,
  type ToolDetailKind,
} from '../shared/bridgeMessages';
import type { RuntimeEvent } from '../runtime/runtimeEvents';

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
}

interface ToolActivityEntry {
  readonly status: ToolActivityStatus;
  readonly progressCount: number;
  readonly latestUpdateKind: ToolActivityUpdateKind | null;
  readonly startedAtMs?: number;
  readonly filePath?: string;
  readonly detailKind?: ToolDetailKind;
  readonly detail?: string;
  readonly errorMessage?: string;
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
        return { state, projection: null };
      }
      const entry: ToolActivityEntry = {
        ...existing,
        status: 'running',
        progressCount: existing.progressCount + 1,
        latestUpdateKind: event.updateKind,
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
        if (addsFilePath || addsDetail) {
          const entry: ToolActivityEntry = {
            ...existing,
            ...(addsFilePath ? { filePath: event.filePath } : {}),
            ...(addsDetail
              ? { detailKind: event.detailKind, detail: event.detail }
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
  };
}
