import {
  DroidWorkingState,
  type DroidStreamEvent,
} from '@factory/droid-sdk/node';

import {
  MAX_BRIDGE_ID_LENGTH,
  MAX_TOOL_NAME_LENGTH,
} from '../shared/bridgeMessages';
import {
  summarizeToolAction,
  type ToolActivityUpdateKind,
} from '../shared/toolActivity';
import {
  extractToolFilePath,
  toWorkspaceRelativePath,
} from './toolFilePath';
import type { RuntimeEvent } from './runtimeEvents';

export function normalizeSdkEvent(
  event: DroidStreamEvent,
  workspaceRoot?: string,
): RuntimeEvent | undefined {
  switch (event.type) {
    case 'assistant_text_delta':
      return event.text.length === 0
        ? undefined
        : {
            type: 'text-delta',
            text: event.text,
          };

    case 'thinking_text_delta':
      return {
        type: 'thinking-delta',
        text: event.text,
      };

    case 'thinking_text_complete':
      return {
        type: 'thinking-complete',
        durationMs: normalizeDuration(event.durationMs),
      };

    case 'tool_call': {
      const activity = normalizeToolActivity(
        'tool-start',
        event.name,
        event.toolUseId,
      );
      if (activity === undefined) {
        return undefined;
      }
      const filePath = normalizeToolFilePath(
        activity.toolName,
        event.input,
        workspaceRoot,
      );
      return filePath === undefined
        ? activity
        : { ...activity, filePath };
    }

    case 'tool_call_delta': {
      const activity = normalizeToolActivity(
        'tool-start',
        event.toolUse.name,
        event.toolUse.id,
      );
      if (activity === undefined) {
        return undefined;
      }
      const filePath = normalizeToolFilePath(
        activity.toolName,
        event.toolUse.input,
        workspaceRoot,
      );
      return filePath === undefined
        ? activity
        : { ...activity, filePath };
    }

    case 'tool_progress': {
      const activity = normalizeToolActivity(
        'tool-progress',
        event.toolName,
        event.toolUseId,
      );
      const updateKind = normalizeToolUpdateKind(event.update?.type);
      return activity === undefined || updateKind === undefined
        ? undefined
        : { ...activity, updateKind };
    }

    case 'tool_result': {
      const activity = normalizeToolActivity(
        'tool-result',
        event.toolName,
        event.toolUseId,
      );
      return activity
        ? {
            ...activity,
            isError: event.isError,
          }
        : undefined;
    }

    case 'user':
      return normalizeUserMessage(event.message);

    case 'working_state_changed':
      return {
        type: 'working-state',
        isWorking: event.state !== DroidWorkingState.Idle,
      };

    case 'settings_updated':
      return {
        type: 'settings-updated',
      };

    case 'error':
      return {
        type: 'error',
      };

    case 'result':
      return {
        type: 'turn-complete',
        outcome: event.subtype,
      };

    default:
      return undefined;
  }
}

function normalizeUserMessage(
  message: unknown,
): RuntimeEvent | undefined {
  if (
    typeof message !== 'object' ||
    message === null ||
    !('id' in message) ||
    typeof message.id !== 'string' ||
    message.id.length === 0 ||
    message.id.length > MAX_BRIDGE_ID_LENGTH
  ) {
    return undefined;
  }
  return { type: 'user-message', messageId: message.id };
}

function normalizeToolActivity<
  Type extends 'tool-start' | 'tool-progress' | 'tool-result',
>(
  type: Type,
  toolName: unknown,
  toolUseId: unknown,
):
  | {
      type: Type;
      toolName: string;
      toolUseId: string;
      action: string;
    }
  | undefined {
  if (
    typeof toolUseId !== 'string' ||
    toolUseId.length === 0 ||
    toolUseId.length > MAX_BRIDGE_ID_LENGTH
  ) {
    return undefined;
  }

  const normalizedToolName = normalizeToolName(toolName);
  return {
    type,
    toolName: normalizedToolName,
    toolUseId,
    action: summarizeToolAction(normalizedToolName),
  };
}

function normalizeToolFilePath(
  toolName: string,
  input: unknown,
  workspaceRoot: string | undefined,
): string | undefined {
  if (workspaceRoot === undefined) {
    return undefined;
  }
  const rawPath = extractToolFilePath(toolName, input);
  return rawPath === undefined
    ? undefined
    : toWorkspaceRelativePath(workspaceRoot, rawPath);
}

function normalizeToolName(value: unknown): string {
  if (typeof value !== 'string') {
    return 'Tool';
  }

  const sanitized = value.replace(/\p{Cc}/gu, '').trim();
  return sanitized.slice(0, MAX_TOOL_NAME_LENGTH) || 'Tool';
}

function normalizeDuration(value: unknown): number | null {
  return typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0
    ? value
    : null;
}

function normalizeToolUpdateKind(
  value: unknown,
): ToolActivityUpdateKind | undefined {
  switch (value) {
    case 'tool_call':
      return 'tool-call';
    case 'tool_result':
      return 'tool-result';
    case 'error':
    case 'status':
    case 'message':
      return value;
    default:
      return undefined;
  }
}
