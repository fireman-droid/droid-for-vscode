import {
  MAX_ASSISTANT_TEXT_LENGTH,
  MAX_THINKING_TEXT_LENGTH,
  MAX_TOOL_ACTIVITIES_PER_TURN,
  MAX_TOOL_PROGRESS_UPDATES_PER_TOOL,
  type ToolActivityStatus,
  type ToolActivityUpdateKind,
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
}

interface ToolActivityEntry {
  readonly status: ToolActivityStatus;
  readonly progressCount: number;
  readonly latestUpdateKind: ToolActivityUpdateKind | null;
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
        status: 'running',
        progressCount: existing.progressCount + 1,
        latestUpdateKind: event.updateKind,
      };
      const tools = new Map(state.tools);
      tools.set(event.toolUseId, entry);
      return {
        state: { ...state, tools },
        projection: {
          toolUseId: event.toolUseId,
          toolName: event.toolName,
          action: event.action,
          ...entry,
        },
      };
    }

    if (event.type !== 'tool-result') {
      return { state, projection: null };
    }
    const entry: ToolActivityEntry = {
      ...existing,
      status: event.isError ? 'failed' : 'completed',
    };
    const tools = new Map(state.tools);
    tools.set(event.toolUseId, entry);
    return {
      state: { ...state, tools },
      projection: {
        toolUseId: event.toolUseId,
        toolName: event.toolName,
        action: event.action,
        ...entry,
      },
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
  };
  const tools = new Map(state.tools);
  tools.set(event.toolUseId, entry);
  return {
    state: { ...state, tools },
    projection: {
      toolUseId: event.toolUseId,
      toolName: event.toolName,
      action: event.action,
      ...entry,
    },
  };
}
