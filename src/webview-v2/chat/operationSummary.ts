import type { ChangeFile } from '@droidvisx/chat-ui/chat/changePresentation';
import { inlineDiffLines } from '@droidvisx/chat-ui/review/inlineDiffLines';
import type { SessionTranscriptItem } from '../../shared/protocol/transcript';
import { isConfirmedOperationFile, isWorkspaceOperationFile, operationDiffWithChanges, type OperationDiff, type OperationDiffFile } from '../../shared/protocol/operationDiff';

export interface OperationSummaryFile extends ChangeFile {
  readonly records: readonly OperationDiffFile[];
}
export interface OperationSummary {
  readonly turnId: string;
  readonly files: ReadonlyMap<string, OperationSummaryFile>;
  readonly calls: ReadonlySet<string>;
  readonly unconfirmed: number;
  readonly delegated: boolean;
}

const fileStats = new WeakMap<OperationDiffFile, ChangeFile>();
const changedDiffs = new WeakMap<OperationDiff, OperationDiff>();
function changedDiff(diff: OperationDiff): OperationDiff {
  let changed = changedDiffs.get(diff);
  if (!changed) { changed = operationDiffWithChanges(diff); changedDiffs.set(diff, changed); }
  return changed;
}
export function operationFileStats(file: OperationDiffFile): ChangeFile {
  const cached = fileStats.get(file);
  if (cached) return cached;
  const lines = file.patch && file.patch !== '@@' ? inlineDiffLines(file.patch) : null;
  const stats = { path: file.path, kind: file.kind,
    additions: lines ? lines.filter((line) => line.kind === 'add').length : null,
    deletions: lines ? lines.filter((line) => line.kind === 'remove').length : null };
  fileStats.set(file, stats);
  return stats;
}

/** Successful edit rows become the turn card; failures and commands retain their activity. */
export function isFoldableFileOperation(item: SessionTranscriptItem): boolean {
  if (item.kind !== 'tool' || item.status !== 'completed' || item.errorMessage || item.subagent ||
    item.detailKind === 'command' || !['applypatch', 'create', 'edit', 'write'].includes(item.toolName.toLowerCase())) return false;
  const diff = item.operationDiff && changedDiff(item.operationDiff);
  return diff?.status === 'ready' && diff.files.length > 0 &&
    diff.files.every((file) => isWorkspaceOperationFile(file) && isConfirmedOperationFile(diff, file));
}

/** Recorded operation totals, never a workspace/net-diff approximation. */
export function summarizeOperations(items: readonly SessionTranscriptItem[], turnId?: string): ReadonlyMap<string, OperationSummary> {
  const summaries = new Map<string, { turnId: string; files: Map<string, OperationSummaryFile>; calls: Set<string>; unconfirmed: number; delegated: boolean }>();
  for (const item of items) {
    if (item.kind !== 'tool' || turnId !== undefined && item.turnId !== turnId) continue;
    const summary = summaries.get(item.turnId) ?? { turnId: item.turnId, files: new Map(), calls: new Set(), unconfirmed: 0, delegated: false };
    if (item.subagent !== undefined) { summary.delegated = true; summaries.set(item.turnId, summary); }
    const diff = item.operationDiff && changedDiff(item.operationDiff);
    if (diff?.status !== 'ready' || diff.source !== 'tool-result') continue;
    const workspaceFiles = diff.files.filter(isWorkspaceOperationFile);
    if (workspaceFiles.length === 0) continue;
    const identity = JSON.stringify([diff.sourceSessionId ?? '', diff.callId ?? item.toolUseId]);
    if (summary.calls.has(identity)) continue;
    summary.calls.add(identity);
    for (const file of workspaceFiles) {
      if (!isConfirmedOperationFile(diff, file)) { summary.unconfirmed += 1; continue; }
      const previous = summary.files.get(file.path);
      const stats = operationFileStats(file);
      summary.files.set(file.path, { ...stats,
        additions: previous ? previous.additions === null || stats.additions === null ? null : previous.additions + stats.additions : stats.additions,
        deletions: previous ? previous.deletions === null || stats.deletions === null ? null : previous.deletions + stats.deletions : stats.deletions,
        records: [...previous?.records ?? [], file] });
    }
    summaries.set(item.turnId, summary);
  }
  return summaries;
}

type ToolItem = Extract<SessionTranscriptItem, { kind: 'tool' }>;
function sameEvidence(before: readonly ToolItem[], after: readonly ToolItem[]): boolean {
  return before.length === after.length && before.every((item, index) => {
    const next = after[index]!;
    return item.operationDiff === next.operationDiff && item.toolUseId === next.toolUseId &&
      (item.subagent !== undefined) === (next.subagent !== undefined);
  });
}

/** Session-local derivation: streaming prose never reparses settled tool evidence. */
export function createOperationSummarySelector() {
  let previous = new Map<string, { items: readonly ToolItem[]; summary: OperationSummary | undefined }>();
  let summaries: ReadonlyMap<string, OperationSummary> = new Map();
  return (items: readonly SessionTranscriptItem[]): ReadonlyMap<string, OperationSummary> => {
    const turns = new Map<string, ToolItem[]>();
    for (const item of items) {
      if (item.kind !== 'tool' || !item.operationDiff && item.subagent === undefined) continue;
      let tools = turns.get(item.turnId);
      if (!tools) { tools = []; turns.set(item.turnId, tools); }
      tools.push(item);
    }
    const next = new Map<string, { items: readonly ToolItem[]; summary: OperationSummary | undefined }>();
    const result = new Map<string, OperationSummary>();
    for (const [turnId, tools] of turns) {
      const cached = previous.get(turnId);
      const entry = cached && sameEvidence(cached.items, tools) ? cached
        : { items: tools, summary: summarizeOperations(tools, turnId).get(turnId) };
      next.set(turnId, entry);
      if (entry.summary) result.set(turnId, entry.summary);
    }
    previous = next;
    const previousSummaries = [...summaries];
    if (summaries.size !== result.size || [...result].some(([id, summary], index) =>
      previousSummaries[index]?.[0] !== id || previousSummaries[index]?.[1] !== summary)) summaries = result;
    return summaries;
  };
}
