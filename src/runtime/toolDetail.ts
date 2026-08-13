import {
  MAX_TOOL_DETAIL_LENGTH,
  type ToolDetailKind,
} from '../shared/bridgeMessages';
import { MAX_TOOL_ACTION_SUMMARY_LENGTH } from '../shared/toolActivity';

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
    const text = normalizeTodoDetail(record['todos']);
    return text === undefined ? undefined : { kind: 'plan', text };
  }
  return undefined;
}

interface TodoStep {
  readonly status: 'pending' | 'in_progress' | 'completed';
  readonly text: string;
}

/**
 * Normalizes the TodoWrite `todos` input to the canonical numbered
 * "N. [status] text" lines the webview plan parser reads.
 *
 * The real CLI accepts far more than that canonical form (verified
 * against the droid binary's own parser): a JSON array string of
 * `{content, status}` objects, a plain array of objects or strings,
 * "[x]"/"[ ]" checkboxes, and bare numbered or bulleted lines. Models
 * routinely emit the JSON form, which used to reach the webview raw
 * and produce a garbled or missing plan card. Mirroring the CLI here
 * keeps every accepted input rendering as a plan.
 */
export function normalizeTodoDetail(todos: unknown): string | undefined {
  const steps = todoSteps(todos);
  if (steps === undefined || steps.length === 0) {
    return undefined;
  }
  const text = steps
    .map((step, index) => {
      const oneLine = step.text.replace(/\s+/gu, ' ').trim();
      return `${String(index + 1)}. [${step.status}] ${oneLine}`;
    })
    .join('\n');
  return boundedDetailText(text);
}

function todoSteps(todos: unknown): readonly TodoStep[] | undefined {
  if (Array.isArray(todos)) {
    return typeof todos[0] === 'string'
      ? lineSteps(todos.join('\n'))
      : objectSteps(todos);
  }
  if (typeof todos !== 'string') {
    return undefined;
  }
  const trimmed = todos.trim();
  if (trimmed.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return typeof parsed[0] === 'string'
          ? lineSteps(parsed.join('\n'))
          : objectSteps(parsed);
      }
    } catch {
      // Not JSON after all; fall through to line parsing.
    }
  }
  return lineSteps(trimmed);
}

/** CLI-equivalent parser for `{content, status}` todo objects. */
function objectSteps(entries: readonly unknown[]): readonly TodoStep[] {
  const steps: TodoStep[] = [];
  for (const entry of entries) {
    if (typeof entry !== 'object' || entry === null) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const content = record['content'];
    const status = record['status'];
    if (
      typeof content !== 'string' ||
      content.trim().length === 0 ||
      (status !== 'pending' &&
        status !== 'in_progress' &&
        status !== 'completed')
    ) {
      continue;
    }
    steps.push({ status, text: content.trim() });
  }
  return steps;
}

/**
 * CLI-equivalent line parser: "[status]" labels, "[x]"/"[ ]"
 * checkboxes (all with optional number or bullet prefixes), and bare
 * numbered/bulleted/plain lines as pending steps.
 */
function lineSteps(text: string): readonly TodoStep[] {
  const steps: TodoStep[] = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (line.length === 0) {
      continue;
    }
    const labeled =
      /^(?:(?:\d+[.)]\s*)|(?:[-*]\s+))?\[(completed|in_progress|pending)\]\s*(.*)$/u.exec(
        line,
      );
    if (labeled !== null) {
      steps.push({
        status: labeled[1] as TodoStep['status'],
        text: labeled[2]?.trim() ?? '',
      });
      continue;
    }
    const checked =
      /^(?:(?:\d+[.)]\s*)|(?:[-*]\s+))?\[[xX]\]\s*(.*)$/u.exec(line);
    if (checked !== null) {
      steps.push({ status: 'completed', text: checked[1]?.trim() ?? '' });
      continue;
    }
    const unchecked =
      /^(?:(?:\d+[.)]\s*)|(?:[-*]\s+))?\[\s*\]\s*(.*)$/u.exec(line);
    if (unchecked !== null) {
      steps.push({ status: 'pending', text: unchecked[1]?.trim() ?? '' });
      continue;
    }
    const plain =
      /^\d+[.)]\s+(.+)$/u.exec(line) ?? /^[-*]\s+(.+)$/u.exec(line);
    steps.push({
      status: 'pending',
      text: (plain?.[1] ?? line).trim(),
    });
  }
  return steps.filter((step) => step.text.length > 0);
}

/**
 * The Execute tool's optional natural-language `summary` input,
 * usable as a command card title. Only what the model actually wrote
 * is surfaced — no title is invented for calls without one.
 */
export function extractExecuteSummary(
  toolName: string,
  input: unknown,
): string | undefined {
  const normalized = toolName
    .replace(/[^\p{L}\p{N}]/gu, '')
    .toLocaleLowerCase();
  if (
    normalized !== 'execute' ||
    typeof input !== 'object' ||
    input === null
  ) {
    return undefined;
  }
  const value = (input as Record<string, unknown>)['summary'];
  if (typeof value !== 'string') {
    return undefined;
  }
  const sanitized = value
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  if (sanitized.length === 0) {
    return undefined;
  }
  return sanitized.slice(0, MAX_TOOL_ACTION_SUMMARY_LENGTH);
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
