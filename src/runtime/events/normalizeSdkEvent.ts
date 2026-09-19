import { DroidWorkingState, type DroidStreamEvent } from '@factory/droid-sdk/node';

import {
  IMAGE_MEDIA_TYPES,
  MAX_IMAGE_DATA_LENGTH,
  MAX_IMAGES_PER_TURN,
  MAX_TOOL_ERROR_MESSAGE_LENGTH,
  MAX_TOOL_NAME_LENGTH,
} from '../../shared/protocol/bounds';
import { MAX_BRIDGE_ID_LENGTH } from '../../shared/bridgeMessages';
import { type ImageMediaType, type ImageOrigin } from '../../shared/protocol/attachments';
import {
  summarizeToolAction,
  type ToolActivityUpdateKind,
} from '../../shared/transcript/toolActivity';
import {
  isExecuteToolName,
  stripTerminalNoise,
  toToolOutputTail,
} from '../../shared/transcript/toolOutput';
import { base64ByteLength } from '../../shared/transcript/transcriptLimits';
import { readTokenUsageBreakdown } from '../../shared/protocol/tokenUsage';
import { readTaskDelegation } from '../subagents/subagentSummary';
import { extractToolBackgroundHint } from '../tools/toolBackgroundHint';
import {
  extractExecuteSummary,
  extractToolDetail,
  extractToolTarget,
} from '../tools/toolDetail';
import {
  extractToolFilePaths,
  hasCompleteToolFilePaths,
  toWorkspaceRelativePath,
} from '../tools/toolFilePath';
import type { RuntimeEvent } from '../runtimeEvents';
import type { ToolResultPreview } from '../../shared/transcript/toolResultPreview';
import { normalizeMissionEvent } from './normalizeMissionEvent';
import { operationDiffFields, type OperationDiff } from '../../shared/protocol/operationDiff';

export function normalizeSdkEvent(
  event: DroidStreamEvent,
  workspaceRoot?: string,
  resultPreview?: ToolResultPreview,
  operationDiff?: OperationDiff,
): RuntimeEvent | undefined {
  const missionEvent = normalizeMissionEvent(event);
  if (missionEvent !== undefined) {
    return missionEvent;
  }
  switch (event.type) {
    case 'assistant_text_delta':
      return event.text.length === 0
        ? undefined
        : {
            type: 'text-delta',
            text: event.text,
          };

    case 'thinking_text_delta': {
      const segment = normalizeThinkingSegment(event.messageId, event.blockIndex);
      return segment === undefined
        ? undefined
        : {
            type: 'thinking-delta',
            text: event.text,
            ...segment,
          };
    }

    case 'thinking_text_complete': {
      const segment = normalizeThinkingSegment(event.messageId, event.blockIndex);
      return segment === undefined
        ? undefined
        : {
            type: 'thinking-complete',
            durationMs: normalizeDuration(event.durationMs),
            ...segment,
          };
    }

    case 'tool_call': {
      const activity = normalizeToolActivity('tool-start', event.name, event.toolUseId);
      if (activity === undefined) {
        return undefined;
      }
      return {
        ...withToolInputContext(activity, event.input, workspaceRoot),
        inputComplete: true,
        ...operationDiffFields({ operationDiff }),
      };
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
      return withToolInputContext(activity, event.toolUse.input, workspaceRoot, true);
    }

    case 'tool_progress': {
      const activity = normalizeToolActivity(
        'tool-progress',
        event.toolName,
        event.toolUseId,
      );
      const updateKind = normalizeToolUpdateKind(event.update?.type);
      if (activity === undefined || updateKind === undefined) {
        return undefined;
      }
      const outputTail = extractProgressOutputTail(activity.toolName, event.update);
      return {
        ...activity,
        updateKind,
        ...(outputTail === undefined ? {} : { outputTail }),
      };
    }

    case 'tool_result': {
      const activity = normalizeToolActivity(
        'tool-result',
        event.toolName,
        event.toolUseId,
      );
      if (activity === undefined) {
        return undefined;
      }
      const errorText = event.isError ? extractToolResultText(event.content) : undefined;
      return {
        ...activity,
        isError: event.isError,
        ...(errorText === undefined ? {} : { errorText }),
        ...(resultPreview === undefined ? {} : { resultPreview }),
        ...operationDiffFields({ operationDiff }),
      };
    }

    case 'user':
      return normalizeUserMessage(event.message);

    case 'working_state_changed':
      return {
        type: 'working-state',
        isWorking: event.state !== DroidWorkingState.Idle,
        compacting: event.state === DroidWorkingState.CompactingConversation,
      };

    case 'settings_updated':
      return {
        type: 'settings-updated',
      };

    case 'error':
      return {
        type: 'error',
      };

    case 'token_usage_update': {
      // Cumulative session totals. Malformed payloads are
      // dropped whole so the UI never regresses to bogus counters.
      const cumulative = readTokenUsageBreakdown(event);
      return cumulative === undefined ? undefined : { type: 'token-usage', cumulative };
    }

    case 'result': {
      // `result.tokenUsage` is this turn's own consumption, not the
      // session total, and the SDK documents it may be null.
      const turnUsage = readTokenUsageBreakdown(event.tokenUsage);
      return {
        type: 'turn-complete',
        outcome: event.subtype,
        ...(turnUsage === undefined ? {} : { turnUsage }),
      };
    }

    default:
      return undefined;
  }
}

/**
 * Extracts bounded image-block events from one SDK stream event.
 * Two live channels carry images: the completed `assistant` message
 * content (the public stream member; `create_message` is internal to
 * the SDK and never reaches `DroidStreamEvent`) and `tool_result`
 * content arrays (screenshots). User-attached images do not come from
 * the stream; the host echoes them from its own staging area.
 */
export function normalizeSdkEventImages(event: DroidStreamEvent): RuntimeEvent[] {
  switch (event.type) {
    case 'assistant':
      return extractImageBlocks(
        event.message.content,
        'assistant',
        typeof event.message.id === 'string' && event.message.id.length > 0
          ? event.message.id
          : 'assistant-message',
      );
    case 'tool_result':
      return typeof event.toolUseId === 'string' && event.toolUseId.length > 0
        ? extractImageBlocks(event.content, 'tool-result', event.toolUseId)
        : [];
    default:
      return [];
  }
}

function extractImageBlocks(
  content: unknown,
  origin: ImageOrigin,
  sourceId: string,
): RuntimeEvent[] {
  if (!Array.isArray(content)) {
    return [];
  }
  const events: RuntimeEvent[] = [];
  for (
    let blockIndex = 0;
    blockIndex < content.length && events.length < MAX_IMAGES_PER_TURN;
    blockIndex += 1
  ) {
    const image = readSdkImageBlock(content[blockIndex]);
    if (image === undefined) {
      continue;
    }
    const oversized = image.data.length > MAX_IMAGE_DATA_LENGTH;
    events.push({
      type: 'image-block',
      origin,
      mediaType: image.mediaType,
      data: oversized ? '' : image.data,
      generated: image.generated,
      byteLength: base64ByteLength(image.data),
      sourceId: sourceId.slice(0, MAX_BRIDGE_ID_LENGTH),
      blockIndex,
    });
  }
  return events;
}

/**
 * Text excerpt from one tool_result's content: a plain string or the
 * text blocks of a block array, terminal noise (ANSI escapes,
 * carriage-return overwrites) stripped, bounded to the bridge
 * error-message cap. Used only for failed results so the UI can show
 * why the tool failed (the history projection reuses this).
 */
export function extractToolResultText(content: unknown): string | undefined {
  const text =
    typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content
            .filter(
              (block): block is { type: 'text'; text: string } =>
                typeof block === 'object' &&
                block !== null &&
                'type' in block &&
                block.type === 'text' &&
                'text' in block &&
                typeof block.text === 'string',
            )
            .map((block) => block.text)
            .join('\n')
        : '';
  const trimmed = stripTerminalNoise(text).trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  return trimmed.length > MAX_TOOL_ERROR_MESSAGE_LENGTH
    ? `${trimmed.slice(0, MAX_TOOL_ERROR_MESSAGE_LENGTH - 1)}…`
    : trimmed;
}

/**
 * Shape guard for one SDK image block (`{ type: 'image', source:
 * { type: 'base64', data, mediaType } }`). The loadSession RPC and
 * the live stream both deliver this camelCase shape, so the history
 * projection reuses this guard.
 */
export function readSdkImageBlock(block: unknown):
  | {
      data: string;
      mediaType: ImageMediaType;
      /** SDK `ImageBlock.generated` pass-through (model-created image). */
      generated: boolean;
    }
  | undefined {
  if (
    typeof block !== 'object' ||
    block === null ||
    !('type' in block) ||
    block.type !== 'image' ||
    !('source' in block)
  ) {
    return undefined;
  }
  const source = block.source;
  if (
    typeof source !== 'object' ||
    source === null ||
    !('type' in source) ||
    source.type !== 'base64' ||
    !('data' in source) ||
    typeof source.data !== 'string' ||
    source.data.length === 0 ||
    !('mediaType' in source) ||
    typeof source.mediaType !== 'string' ||
    !(IMAGE_MEDIA_TYPES as readonly string[]).includes(source.mediaType)
  ) {
    return undefined;
  }
  return {
    data: source.data,
    mediaType: source.mediaType as ImageMediaType,
    generated: 'generated' in block && block.generated === true,
  };
}

function normalizeUserMessage(message: unknown): RuntimeEvent | undefined {
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

/**
 * Live output tail of an execute-class tool_progress update. The CLI
 * sends the cumulative output as `update.fullOutput` on every push
 * (probed 2026-08-12: `update.type` is always `status`, ~200-400ms
 * cadence); `update.text` is a sliding recent-lines window kept as a
 * fallback for payloads without `fullOutput`.
 */
function extractProgressOutputTail(
  toolName: string,
  update: { text?: string; fullOutput?: string } | undefined,
): string | undefined {
  if (update === undefined || !isExecuteToolName(toolName)) {
    return undefined;
  }
  const source =
    typeof update.fullOutput === 'string' && update.fullOutput.length > 0
      ? update.fullOutput
      : typeof update.text === 'string'
        ? update.text
        : undefined;
  return source === undefined ? undefined : toToolOutputTail(source);
}

function withToolInputContext(
  activity: Extract<RuntimeEvent, { type: 'tool-start' }>,
  input: unknown,
  workspaceRoot: string | undefined,
  includePathsComplete = false,
): Extract<RuntimeEvent, { type: 'tool-start' }> {
  const filePaths = normalizeToolFilePaths(activity.toolName, input, workspaceRoot);
  const filePathsComplete =
    includePathsComplete &&
    filePaths.length > 0 &&
    hasCompleteToolFilePaths(activity.toolName, input);
  const detail = extractToolDetail(activity.toolName, input);
  const target = extractToolTarget(activity.toolName, input, workspaceRoot);
  const backgroundHint = extractToolBackgroundHint(activity.toolName, input);
  // An Execute call's own `summary` beats the generic verb phrase as
  // the row action; the command card shows it as its title.
  const summary = extractExecuteSummary(activity.toolName, input);
  const subagent = readTaskDelegation(activity.toolName, input);
  return {
    ...activity,
    ...(summary === undefined ? {} : { action: summary }),
    ...(filePaths.length === 0 ? {} : { filePath: filePaths[0] }),
    ...(filePaths.length <= 1 ? {} : { filePaths }),
    ...(filePathsComplete ? { filePathsComplete: true } : {}),
    ...(detail === undefined ? {} : { detailKind: detail.kind, detail: detail.text }),
    ...(target === undefined ? {} : { target }),
    ...(backgroundHint === undefined ? {} : { backgroundHint }),
    ...(subagent === null ? {} : { subagent }),
  };
}

function normalizeToolFilePaths(
  toolName: string,
  input: unknown,
  workspaceRoot: string | undefined,
): readonly string[] {
  if (workspaceRoot === undefined) {
    return [];
  }
  const paths: string[] = [];
  const seen = new Set<string>();
  for (const rawPath of extractToolFilePaths(toolName, input)) {
    const relativePath = toWorkspaceRelativePath(workspaceRoot, rawPath);
    if (relativePath !== undefined && !seen.has(relativePath)) {
      seen.add(relativePath);
      paths.push(relativePath);
    }
  }
  return paths;
}

function normalizeToolName(value: unknown): string {
  if (typeof value !== 'string') {
    return 'Tool';
  }

  const sanitized = value.replace(/\p{Cc}/gu, '').trim();
  return sanitized.slice(0, MAX_TOOL_NAME_LENGTH) || 'Tool';
}

/**
 * Segment identity of one thinking block. A malformed identity drops
 * the whole event (fail closed) so downstream layers can never merge
 * segments under a fabricated key.
 */
function normalizeThinkingSegment(
  messageId: unknown,
  blockIndex: unknown,
): { messageId: string; blockIndex: number } | undefined {
  if (
    typeof messageId !== 'string' ||
    messageId.length === 0 ||
    typeof blockIndex !== 'number' ||
    !Number.isSafeInteger(blockIndex) ||
    blockIndex < 0
  ) {
    return undefined;
  }
  return {
    messageId: messageId.slice(0, MAX_BRIDGE_ID_LENGTH),
    blockIndex,
  };
}

function normalizeDuration(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function normalizeToolUpdateKind(value: unknown): ToolActivityUpdateKind | undefined {
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
