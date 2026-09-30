import { CATEGORY_PRESENTATION, toolPresentation, type ExploreCategory } from '../../../shared/transcript/toolCatalog';
export type { ExploreCategory } from '../../../shared/transcript/toolCatalog';
import { resolveToolAction } from '../../../shared/transcript/toolActivity';
import type { ToolResultPreview } from '../../../shared/transcript/toolResultPreview';

export const ACTIVITY_GROUP_KEY = 'group-explore' as const;
const GROUP_PATH: readonly [typeof ACTIVITY_GROUP_KEY] = [ACTIVITY_GROUP_KEY];

export function classifyExploreTool(toolName: string): ExploreCategory | null {
  return toolPresentation(toolName)?.category ?? null;
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
  readonly resultFacts: readonly string[];
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
  const diagnosticFiles = new Set<string>();
  let diagnosticResults = 0;
  let checksWithDiagnostics = 0;
  const otherActions = new Map<string, { toolName: string; action: string; count: number }>();
  const counts: Record<ExploreCategory, number> = {
    file: 0,
    search: 0,
    folder: 0,
    fetch: 0,
    'task-check': 0,
    skill: 0,
    diagnostics: 0,
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
    if (category === 'diagnostics') {
      const preview = metadata.resultPreview;
      const source = preview?.source;
      if (source && source.path !== '.') diagnosticFiles.add(source.path);
      if (status === 'completed' && preview?.summary?.kind === 'diagnostics') {
        diagnosticResults += 1;
        if (preview.summary.totalCount > 0) checksWithDiagnostics += 1;
      }
    }
    if (category === null) {
      const action = resolveToolAction(part.toolName ?? '', metadata.action);
      const toolName = part.toolName ?? '';
      const key = toolName + '\u0000' + action;
      otherActions.set(key, { toolName, action, count: (otherActions.get(key)?.count ?? 0) + 1 });
    }
  }
  const segments: string[] = [];
  for (const category of Object.keys(CATEGORY_PRESENTATION) as ExploreCategory[]) {
    const count = counts[category];
    if (count > 0) {
      const nouns = CATEGORY_PRESENTATION[category].nouns;
      segments.push(`${count} ${count === 1 ? nouns[0] : nouns[1]}`);
    }
  }
  if (diagnosticFiles.size > 0) segments.push(diagnosticFiles.size + (diagnosticFiles.size === 1 ? ' file' : ' files'));
  const resultFacts: string[] = [];
  if (checksWithDiagnostics > 0) resultFacts.push(checksWithDiagnostics + (checksWithDiagnostics === 1 ? ' check reported diagnostics' : ' checks reported diagnostics'));
  else if (diagnosticResults > 0 && diagnosticResults === counts.diagnostics) resultFacts.push('No diagnostics reported');
  if (diagnosticResults > 0 && diagnosticResults < counts.diagnostics) resultFacts.push(diagnosticResults + '/' + counts.diagnostics + ' results summarized');
  const owners = new Map<string, Set<string>>();
  for (const { action, toolName } of otherActions.values()) {
    const names = owners.get(action) ?? new Set<string>();
    names.add(toolName); owners.set(action, names);
  }
  for (const { action, toolName, count } of otherActions.values()) {
    const label = (owners.get(action)?.size ?? 0) > 1 ? action + ' (' + toolName + ')' : action;
    segments.push(count > 1 ? label + ' × ' + count : label);
  }
  return {
    toolCount,
    runningCount,
    runningToolCount,
    resultTruncatedCount,
    unavailableCount,
    countsLabel: segments.join(', '),
    resultFacts,
    failedCount,
    stoppedCount,
    truncated,
  };
}
