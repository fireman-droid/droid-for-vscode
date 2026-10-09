import { isConfirmedWorkspaceChange } from '../../shared/protocol/operationDiff';
import type { CommittedFileStat } from '../changes/changeStats';
import type { RecordedOperation } from './reviewOperationScope';

/** Snapshots supply counts and contents, never additional Agent Turn paths. */
export function confirmedTurnFiles(
  operations: readonly RecordedOperation[], measured: readonly CommittedFileStat[],
): CommittedFileStat[] {
  const paths = new Set<string>();
  for (const { operationDiff: diff } of operations) {
    if (diff.status !== 'ready') continue;
    for (const file of diff.files) if (isConfirmedWorkspaceChange(diff, file)) paths.add(file.path);
  }
  const stats = new Map(measured.map(file => [file.path, file]));
  return [...paths].map(path => ({ path,
    additions: stats.get(path)?.additions ?? null, deletions: stats.get(path)?.deletions ?? null }));
}
