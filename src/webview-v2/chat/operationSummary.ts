import type { ChangeFile } from '@droidvisx/chat-ui/chat/changePresentation';
import { inlineDiffLines } from '@droidvisx/chat-ui/review/inlineDiffLines';
import type { SessionTranscriptItem } from '../../shared/protocol/transcript';
import { isConfirmedOperationFile, operationDiffWithChanges, type OperationDiffFile } from '../../shared/protocol/operationDiff';

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

export function operationFileStats(file: OperationDiffFile): ChangeFile {
  const lines = file.patch && file.patch !== '@@' ? inlineDiffLines(file.patch) : null;
  return { path: file.path, kind: file.kind,
    additions: lines ? lines.filter((line) => line.kind === 'add').length : null,
    deletions: lines ? lines.filter((line) => line.kind === 'remove').length : null };
}

/** Successful edit rows become the turn card; failures and commands retain their activity. */
export function isFoldableFileOperation(item: SessionTranscriptItem): boolean {
  if (item.kind !== 'tool' || item.status !== 'completed' || item.errorMessage || item.subagent ||
    item.detailKind === 'command' || !['applypatch', 'create', 'edit', 'write'].includes(item.toolName.toLowerCase())) return false;
  const diff = item.operationDiff && operationDiffWithChanges(item.operationDiff);
  return diff?.status === 'ready' && diff.files.length > 0 && diff.files.every((file) => isConfirmedOperationFile(diff, file));
}

/** Recorded operation totals, never a workspace/net-diff approximation. */
export function summarizeOperations(items: readonly SessionTranscriptItem[], turnId?: string): ReadonlyMap<string, OperationSummary> {
  const summaries = new Map<string, { turnId: string; files: Map<string, OperationSummaryFile>; calls: Set<string>; unconfirmed: number; delegated: boolean }>();
  for (const item of items) {
    if (item.kind !== 'tool' || turnId !== undefined && item.turnId !== turnId) continue;
    const summary = summaries.get(item.turnId) ?? { turnId: item.turnId, files: new Map(), calls: new Set(), unconfirmed: 0, delegated: false };
    if (item.subagent !== undefined) { summary.delegated = true; summaries.set(item.turnId, summary); }
    const diff = item.operationDiff && operationDiffWithChanges(item.operationDiff);
    if (diff?.status !== 'ready' || diff.source !== 'tool-result') continue;
    const identity = JSON.stringify([diff.sourceSessionId ?? '', diff.callId ?? item.toolUseId]);
    if (summary.calls.has(identity)) continue;
    summary.calls.add(identity);
    for (const file of diff.files) {
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
