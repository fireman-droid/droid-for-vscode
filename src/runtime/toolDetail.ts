import {
  MAX_TOOL_DETAIL_LENGTH,
  type ToolDetailKind,
} from '../shared/bridgeMessages';

export interface ToolDetail {
  readonly kind: ToolDetailKind;
  readonly text: string;
}

/**
 * Extracts extra human-readable context from a tool's raw input: the
 * shell command for execute tools, or the plan text for task-plan
 * tools. Returns undefined for other tools and unusable inputs.
 */
export function extractToolDetail(
  toolName: string,
  input: unknown,
): ToolDetail | undefined {
  const normalized = toolName
    .replace(/[^\p{L}\p{N}]/gu, '')
    .toLocaleLowerCase();
  if (typeof input !== 'object' || input === null) {
    return undefined;
  }
  const record = input as Record<string, unknown>;
  if (normalized === 'execute') {
    const text = boundedDetailText(record['command']);
    return text === undefined ? undefined : { kind: 'command', text };
  }
  if (normalized === 'todowrite') {
    const text = boundedDetailText(record['todos']);
    return text === undefined ? undefined : { kind: 'plan', text };
  }
  return undefined;
}

/**
 * Keeps newlines and tabs (commands and plans are multi-line) but
 * strips other control characters, then bounds the length.
 */
function boundedDetailText(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const sanitized = value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, '')
    .trim();
  if (sanitized.length === 0) {
    return undefined;
  }
  return sanitized.slice(0, MAX_TOOL_DETAIL_LENGTH);
}
