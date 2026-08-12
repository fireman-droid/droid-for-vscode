/**
 * Pure grouping and summary logic for the exploration-tool activity
 * aggregation (streaming-experience design, item A). Framework-free so
 * vitest can cover every grouping decision without mounting
 * assistant-ui; `Thread.tsx` feeds it the message part states.
 *
 * Rules (Cursor-aligned, adapted to our semantic tool classes):
 * - only exploration-class tool calls are groupable; sequence
 *   continuity does the grouping (adjacent parts sharing the group key
 *   coalesce inside `MessagePrimitive.GroupedParts`);
 * - a short interspersed Thinking is swallowed into the surrounding
 *   run; long reasoning and every text/data/interaction part split it;
 * - a run only renders as a group when it reads as a batch: at least
 *   3 steps total and at least 2 of them actual tool calls (mirrors
 *   Cursor's pure-read threshold of 3 with thinking counted by total
 *   steps, while an all-thinking run can never become "Explored").
 */

import { toolNameCandidates } from '../../shared/toolActivity';

export const ACTIVITY_GROUP_KEY = 'group-explore' as const;

export const MIN_GROUP_MEMBERS = 3;
export const MIN_GROUP_TOOLS = 2;

/**
 * Reasoning longer than this keeps its own row and splits the run.
 * Cursor swallows all thinking; the user asked for "short thinking
 * swallowed" (2026-08-12), so a compact bound close to Cursor's
 * short-text rule is used.
 */
export const MAX_SWALLOWED_REASONING_CHARS = 200;
export const MAX_SWALLOWED_REASONING_LINES = 2;

const GROUP_PATH: readonly [typeof ACTIVITY_GROUP_KEY] = [
  ACTIVITY_GROUP_KEY,
];

export type ExploreCategory =
  | 'file'
  | 'search'
  | 'folder'
  | 'fetch'
  | 'task-check'
  | 'skill';

const TOOL_CATEGORIES: Readonly<Record<string, ExploreCategory>> = {
  fetchurl: 'fetch',
  glob: 'search',
  grep: 'search',
  ls: 'folder',
  read: 'file',
  skill: 'skill',
  taskoutput: 'task-check',
  websearch: 'search',
};

/** Maps a raw SDK tool name to its exploration category, or null when
 * the tool is not groupable (execute, edits, todowrite, interactions,
 * unknown tools all stay standalone rows). */
export function classifyExploreTool(
  toolName: string,
): ExploreCategory | null {
  for (const candidate of toolNameCandidates(toolName)) {
    const category = TOOL_CATEGORIES[candidate];
    if (category !== undefined) {
      return category;
    }
  }
  return null;
}

export function isSwallowableReasoning(text: string): boolean {
  if (text.length > MAX_SWALLOWED_REASONING_CHARS) {
    return false;
  }
  let lines = 1;
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 10) {
      lines += 1;
      if (lines > MAX_SWALLOWED_REASONING_LINES) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Structural view of the assistant-ui part states this module reads.
 * Kept minimal so tests can pass plain objects and so the module never
 * depends on assistant-ui types.
 */
export interface GroupCandidatePart {
  readonly type: string;
  readonly toolName?: string;
  readonly text?: string;
  readonly status?: { readonly type?: string };
  readonly providerMetadata?: unknown;
}

/**
 * `groupBy` for `MessagePrimitive.GroupedParts`: adjacent parts that
 * return the group path coalesce into one run. Module-level constant
 * so the grouped tree survives unrelated re-renders.
 */
export function activityGroupBy(
  part: GroupCandidatePart,
): readonly [typeof ACTIVITY_GROUP_KEY] | null {
  if (part.type === 'tool-call') {
    return typeof part.toolName === 'string' &&
      classifyExploreTool(part.toolName) !== null
      ? GROUP_PATH
      : null;
  }
  if (part.type === 'reasoning') {
    return typeof part.text === 'string' &&
      isSwallowableReasoning(part.text)
      ? GROUP_PATH
      : null;
  }
  return null;
}

export interface GroupSummary {
  readonly memberCount: number;
  readonly toolCount: number;
  /** False for runs below the batch threshold: render plain rows. */
  readonly renderAsGroup: boolean;
  /** True while any member still reports a running/stopping status. */
  readonly anyRunning: boolean;
  /** "3 files, 2 searches" — real semantic counts, category order fixed. */
  readonly countsLabel: string;
  /** Sum of member durations; null when no member reported one. */
  readonly durationMs: number | null;
  readonly failedCount: number;
  readonly stoppedCount: number;
}

interface MemberMetadata {
  readonly status: string | null;
  readonly durationMs: number | null;
  readonly filePath: string | null;
}

function readMemberMetadata(part: GroupCandidatePart): MemberMetadata {
  const provider = part.providerMetadata;
  if (
    typeof provider === 'object' &&
    provider !== null &&
    'droidvisx' in provider &&
    typeof provider.droidvisx === 'object' &&
    provider.droidvisx !== null
  ) {
    const metadata = provider.droidvisx as Record<string, unknown>;
    return {
      status:
        typeof metadata['status'] === 'string'
          ? metadata['status']
          : null,
      durationMs:
        typeof metadata['durationMs'] === 'number' &&
        Number.isFinite(metadata['durationMs']) &&
        metadata['durationMs'] >= 0
          ? metadata['durationMs']
          : null,
      filePath:
        typeof metadata['filePath'] === 'string' &&
        metadata['filePath'].length > 0
          ? metadata['filePath']
          : null,
    };
  }
  return { status: null, durationMs: null, filePath: null };
}

const CATEGORY_ORDER: readonly ExploreCategory[] = [
  'file',
  'search',
  'folder',
  'fetch',
  'task-check',
  'skill',
];

const CATEGORY_NOUNS: Readonly<
  Record<ExploreCategory, readonly [string, string]>
> = {
  fetch: ['fetch', 'fetches'],
  file: ['file', 'files'],
  folder: ['folder', 'folders'],
  search: ['search', 'searches'],
  'task-check': ['task check', 'task checks'],
  skill: ['skill', 'skills'],
};

/**
 * Which member the running-group ticker shows: the last member still
 * reporting a running/stopping status, falling back to the newest
 * member while the group waits between tool calls (user report
 * batch 2 §1).
 */
export function activeTickerIndex(
  parts: readonly GroupCandidatePart[],
): number {
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index]!;
    if (part.type === 'tool-call') {
      const status = readMemberMetadata(part).status;
      if (status === 'running' || status === 'stopping') {
        return index;
      }
    } else if (
      part.type === 'reasoning' &&
      part.status?.type === 'running'
    ) {
      return index;
    }
  }
  return parts.length - 1;
}

export function summarizeActivityGroup(
  parts: readonly GroupCandidatePart[],
): GroupSummary {
  let toolCount = 0;
  let anyRunning = false;
  let durationTotal = 0;
  let hasDuration = false;
  let failedCount = 0;
  let stoppedCount = 0;
  const counts: Record<ExploreCategory, number> = {
    fetch: 0,
    file: 0,
    folder: 0,
    search: 0,
    'task-check': 0,
    skill: 0,
  };
  const seenFiles = new Set<string>();
  let firstToolCategory: ExploreCategory | null = null;

  for (const part of parts) {
    if (part.type === 'tool-call') {
      toolCount += 1;
      const metadata = readMemberMetadata(part);
      const category = classifyExploreTool(part.toolName ?? '');
      if (firstToolCategory === null) {
        firstToolCategory = category;
      }
      if (category === 'file') {
        // Reads carry no filePath today; when one is present, distinct
        // files dedupe, otherwise every call counts as one file.
        if (metadata.filePath !== null) {
          if (!seenFiles.has(metadata.filePath)) {
            seenFiles.add(metadata.filePath);
            counts.file += 1;
          }
        } else {
          counts.file += 1;
        }
      } else if (category !== null) {
        counts[category] += 1;
      }
      if (
        metadata.status === 'running' ||
        metadata.status === 'stopping'
      ) {
        anyRunning = true;
      } else if (metadata.status === 'failed') {
        failedCount += 1;
      } else if (metadata.status === 'stopped') {
        stoppedCount += 1;
      }
      if (metadata.durationMs !== null) {
        durationTotal += metadata.durationMs;
        hasDuration = true;
      }
    } else if (part.type === 'reasoning') {
      if (part.status?.type === 'running') {
        anyRunning = true;
      }
    }
  }

  const segments: string[] = [];
  for (const category of CATEGORY_ORDER) {
    const count = counts[category];
    if (count === 0) {
      continue;
    }
    if (
      category === 'file' &&
      count === 1 &&
      seenFiles.size === 1 &&
      firstToolCategory === 'file'
    ) {
      // Exactly one known file leading the run: show its name, the
      // Cursor "Explored src/app.ts, 2 searches" affordance.
      const filePath = [...seenFiles][0]!;
      segments.push(filePath.split('/').at(-1) ?? filePath);
      continue;
    }
    const [singular, plural] = CATEGORY_NOUNS[category];
    segments.push(`${count} ${count === 1 ? singular : plural}`);
  }

  return {
    memberCount: parts.length,
    toolCount,
    renderAsGroup:
      parts.length >= MIN_GROUP_MEMBERS &&
      toolCount >= MIN_GROUP_TOOLS,
    anyRunning,
    countsLabel:
      segments.length > 0
        ? segments.join(', ')
        : `${toolCount} ${toolCount === 1 ? 'step' : 'steps'}`,
    durationMs: hasDuration ? durationTotal : null,
    failedCount,
    stoppedCount,
  };
}
