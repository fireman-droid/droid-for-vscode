import {
  MAX_TOOL_DETAIL_LENGTH,
  MAX_TOOL_TARGET_LENGTH,
} from '../../shared/protocol/bounds';
import { type ToolDetailKind } from '../../shared/protocol/transcript';
import {
  MAX_TOOL_ACTION_SUMMARY_LENGTH,
  toolNameCandidates,
} from '../../shared/transcript/toolActivity';
import { toWorkspaceRelativePath } from './toolFilePath';

const MAX_TOOL_TARGET_INPUT_SCAN_LENGTH = MAX_TOOL_TARGET_LENGTH * 8;
const MAX_TOOL_TARGET_PATTERN_ITEMS = 32;

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
  const normalized = toolName.replace(/[^\p{L}\p{N}]/gu, '').toLocaleLowerCase();
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

/**
 * Extracts the small, display-only input context that explains a
 * non-mutating workspace tool. Raw input and output never cross the
 * Bridge. Paths are exposed only after resolving inside the workspace.
 */
export function extractToolTarget(
  toolName: string,
  input: unknown,
  workspaceRoot?: string,
): string | undefined {
  if (typeof input !== 'object' || input === null) {
    return undefined;
  }
  const record = input as Record<string, unknown>;
  const names = toolNameCandidates(toolName);
  if (names.includes('read')) {
    return readWorkspacePath(record, ['file_path', 'filePath', 'path'], workspaceRoot);
  }
  if (names.includes('grep') || names.includes('search')) {
    return joinTargetParts(
      readTargetText(record, ['pattern', 'query', 'search']),
      readWorkspacePath(
        record,
        ['path', 'directory_path', 'directory', 'folder', 'dir', 'cwd'],
        workspaceRoot,
      ),
      readTargetText(record, ['glob_pattern', 'glob', 'include']),
    );
  }
  if (names.includes('glob')) {
    return joinTargetParts(
      readTargetPattern(record, ['patterns', 'pattern', 'glob_pattern', 'glob']),
      readWorkspacePath(
        record,
        ['path', 'directory_path', 'directory', 'folder', 'dir', 'cwd'],
        workspaceRoot,
      ),
    );
  }
  if (names.includes('ls') || names.includes('list')) {
    return readWorkspacePath(
      record,
      ['path', 'directory_path', 'directory', 'folder', 'dir', 'cwd'],
      workspaceRoot,
    );
  }
  return undefined;
}

function readWorkspacePath(
  record: Record<string, unknown>,
  keys: readonly string[],
  workspaceRoot: string | undefined,
): string | undefined {
  if (workspaceRoot === undefined) {
    return undefined;
  }
  const rawPath = readTargetText(record, keys);
  return rawPath === undefined
    ? undefined
    : toWorkspaceRelativePath(workspaceRoot, rawPath);
}

function readTargetText(
  record: Record<string, unknown>,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const normalized = normalizeTargetText(record[key]);
    if (normalized !== undefined) {
      return normalized;
    }
  }
  return undefined;
}

function readTargetPattern(
  record: Record<string, unknown>,
  keys: readonly string[],
): string | undefined {
  const direct = readTargetText(record, keys);
  if (direct !== undefined) {
    return direct;
  }
  for (const key of keys) {
    const value = record[key];
    if (!Array.isArray(value)) {
      continue;
    }
    let target = '';
    for (
      let index = 0;
      index < Math.min(value.length, MAX_TOOL_TARGET_PATTERN_ITEMS);
      index += 1
    ) {
      const pattern = normalizeTargetText(value[index]);
      if (pattern === undefined) {
        continue;
      }
      const separator = target.length === 0 ? '' : ', ';
      const available = MAX_TOOL_TARGET_LENGTH - target.length - separator.length;
      if (available <= 0) {
        break;
      }
      target += separator + pattern.slice(0, available);
      if (target.length >= MAX_TOOL_TARGET_LENGTH) {
        break;
      }
    }
    if (target.length > 0) {
      return target;
    }
  }
  return undefined;
}

function normalizeTargetText(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value
    .slice(0, MAX_TOOL_TARGET_INPUT_SCAN_LENGTH)
    .replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  return normalized.length === 0
    ? undefined
    : normalized.slice(0, MAX_TOOL_TARGET_LENGTH);
}

function joinTargetParts(...parts: readonly (string | undefined)[]): string | undefined {
  const target = parts.filter((part): part is string => part !== undefined).join(' · ');
  return target.length === 0 ? undefined : target.slice(0, MAX_TOOL_TARGET_LENGTH);
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
      (status !== 'pending' && status !== 'in_progress' && status !== 'completed')
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
    const checked = /^(?:(?:\d+[.)]\s*)|(?:[-*]\s+))?\[[xX]\]\s*(.*)$/u.exec(line);
    if (checked !== null) {
      steps.push({ status: 'completed', text: checked[1]?.trim() ?? '' });
      continue;
    }
    const unchecked = /^(?:(?:\d+[.)]\s*)|(?:[-*]\s+))?\[\s*\]\s*(.*)$/u.exec(line);
    if (unchecked !== null) {
      steps.push({ status: 'pending', text: unchecked[1]?.trim() ?? '' });
      continue;
    }
    const plain = /^\d+[.)]\s+(.+)$/u.exec(line) ?? /^[-*]\s+(.+)$/u.exec(line);
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
  const normalized = toolName.replace(/[^\p{L}\p{N}]/gu, '').toLocaleLowerCase();
  if (normalized !== 'execute' || typeof input !== 'object' || input === null) {
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
