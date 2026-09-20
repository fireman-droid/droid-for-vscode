import { resolveToolAction, toolNameCandidates } from '../../../shared/transcript/toolActivity';
import type { ToolResultPreview } from '../../../shared/transcript/toolResultPreview';

export const ACTIVITY_GROUP_KEY = 'group-explore' as const;
const GROUP_PATH: readonly [typeof ACTIVITY_GROUP_KEY] = [ACTIVITY_GROUP_KEY];

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

export function classifyExploreTool(toolName: string): ExploreCategory | null {
  for (const candidate of toolNameCandidates(toolName)) {
    const category = TOOL_CATEGORIES[candidate];
    if (category !== undefined) return category;
  }
  return null;
}

export interface GroupCandidatePart {
  readonly type: string;
  readonly toolName?: string;
  readonly text?: string;
  readonly status?: { readonly type?: string };
  readonly providerMetadata?: unknown;
}

// Group identity must not change as a reasoning part grows or tools arrive.
export function activityGroupBy(
  part: GroupCandidatePart,
): readonly [typeof ACTIVITY_GROUP_KEY] | null {
  const eligible =
    part.type === 'reasoning' ||
    (part.type === 'tool-call' && classifyExploreTool(part.toolName ?? '') !== null);
  return eligible ? GROUP_PATH : null;
}

export interface GroupSummary {
  readonly toolCount: number;
  readonly runningCount: number;
  readonly runningToolCount: number;
  readonly resultTruncatedCount: number;
  readonly unavailableCount: number;
  readonly countsLabel: string;
  readonly failedCount: number;
  readonly stoppedCount: number;
  readonly truncated: boolean;
}

interface MemberMetadata {
  readonly action: string | undefined;
  readonly status: string | null;
  readonly resultPreview: ToolResultPreview | null;
  readonly truncated: boolean;
}

function readMemberMetadata(part: GroupCandidatePart): MemberMetadata {
  const provider = part.providerMetadata;
  const metadata =
    typeof provider === 'object' &&
    provider !== null &&
    'droidvisx' in provider &&
    typeof provider.droidvisx === 'object' &&
    provider.droidvisx !== null
      ? (provider.droidvisx as Record<string, unknown>)
      : null;
  return {
    action: typeof metadata?.['action'] === 'string' ? metadata['action'] : undefined,
    status: typeof metadata?.['status'] === 'string' ? metadata['status'] : null,
    resultPreview:
      (metadata?.['resultPreview'] as ToolResultPreview | null | undefined) ?? null,
    truncated: metadata?.['truncated'] === true,
  };
}

function memberStatus(part: GroupCandidatePart): string | null {
  return part.type === 'tool-call'
    ? readMemberMetadata(part).status
    : (part.status?.type ?? null);
}

function isRunning(status: string | null): boolean {
  return status === 'running' || status === 'stopping';
}

export function activeActivityIndex(parts: readonly GroupCandidatePart[]): number {
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    if (isRunning(memberStatus(parts[index]!))) return index;
  }
  return parts.length - 1;
}

const CATEGORY_NOUNS: Readonly<Record<ExploreCategory, readonly [string, string]>> = {
  file: ['read', 'reads'],
  search: ['search', 'searches'],
  folder: ['listing', 'listings'],
  fetch: ['fetch', 'fetches'],
  'task-check': ['task check', 'task checks'],
  skill: ['skill', 'skills'],
};

export function summarizeActivityGroup(
  parts: readonly GroupCandidatePart[],
): GroupSummary {
  let toolCount = 0;
  let runningCount = 0;
  let runningToolCount = 0;
  let resultTruncatedCount = 0;
  let unavailableCount = 0;
  let failedCount = 0;
  let stoppedCount = 0;
  let truncated = false;
  const otherActions = new Map<string, number>();
  const counts: Record<ExploreCategory, number> = {
    file: 0,
    search: 0,
    folder: 0,
    fetch: 0,
    'task-check': 0,
    skill: 0,
  };
  for (const part of parts) {
    const metadata = readMemberMetadata(part);
    const status =
      part.type === 'tool-call' ? metadata.status : (part.status?.type ?? null);
    if (isRunning(status)) runningCount += 1;
    if (status === 'failed') failedCount += 1;
    if (status === 'stopped' || status === 'incomplete') stoppedCount += 1;
    truncated ||= metadata.truncated;
    if (part.type !== 'tool-call') continue;
    toolCount += 1;
    if (isRunning(status)) runningToolCount += 1;
    if (
      metadata.resultPreview?.availability === 'available' &&
      metadata.resultPreview.truncated
    )
      resultTruncatedCount += 1;
    if (metadata.resultPreview?.availability === 'unavailable') unavailableCount += 1;
    const category = classifyExploreTool(part.toolName ?? '');
    if (category !== null) counts[category] += 1;
    else {
      const action = resolveToolAction(part.toolName ?? '', metadata.action);
      otherActions.set(action, (otherActions.get(action) ?? 0) + 1);
    }
  }
  const segments: string[] = [];
  for (const category of Object.keys(CATEGORY_NOUNS) as ExploreCategory[]) {
    const count = counts[category];
    if (count > 0) {
      const nouns = CATEGORY_NOUNS[category];
      segments.push(`${count} ${count === 1 ? nouns[0] : nouns[1]}`);
    }
  }
  for (const [action, count] of otherActions) {
    segments.push(count > 1 ? `${action} × ${count}` : action);
  }
  return {
    toolCount,
    runningCount,
    runningToolCount,
    resultTruncatedCount,
    unavailableCount,
    countsLabel: segments.join(', '),
    failedCount,
    stoppedCount,
    truncated,
  };
}
