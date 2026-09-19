import { MAX_CHANGED_FILES_PER_TURN } from '../../../shared/protocol/bounds';
import { type ChangedFileSummary } from '../../../shared/protocol/transcript';
import { hasFileChange, type FileChangeStat } from '../../changes/changeStats';
import type { SettleTurnChangesPort } from './settleTurnChangesPort';

/**
 * Settled ledger rows for one finished turn: git tree diff is the
 * authority when both snapshots exist. A missing snapshot permits only
 * independently measured baseline differences, never candidate-only rows.
 */
export async function resolveSettledChangeFiles(
  ctl: SettleTurnChangesPort,
  sessionId: string,
  turnId: string,
  toolPaths: readonly string[],
  measuredFiles: readonly ChangedFileSummary[] = [],
): Promise<readonly ChangedFileSummary[]> {
  const scope = { sessionId, turnId };
  const snapshots = ctl.turnSnapshots;
  const report = (files: readonly ChangedFileSummary[], source: string, treeCount = 0, extraCount = 0) => {
    ctl.recordHost?.({ level: 'info', name: 'host.changes.settled',
      attributes: { ...scope, source, toolPathCount: toolPaths.length, treeFileCount: treeCount,
        extraPathCount: extraCount, fileCount: files.length } });
    return files;
  };
  const fallback = async (reason: string) => report(toolPaths.length === 0
    ? [] : fallbackChangeFiles(await ctl.changeStats.read(toolPaths, scope), toolPaths, measuredFiles), reason);
  if (snapshots === undefined) {
    return fallback('no-snapshot-store');
  }
  try {
    await snapshots.capture(scope, 'after');
  } catch {
    return fallback('after-capture-threw');
  }
  const record = snapshots.read(sessionId, turnId);
  if (record?.before === undefined || record.after === undefined) {
    return fallback(record?.before === undefined ? 'missing-before-tree' : 'missing-after-tree');
  }
  let treeStats: ReadonlyMap<string, FileChangeStat>;
  try {
    treeStats = await snapshots.diff(scope);
  } catch {
    return fallback('snapshot-diff-failed');
  }
  const files = composeChangeFiles(treeStats, toolPaths);
  for (const file of files) {
    ctl.recordHost?.({ level: 'debug', name: 'host.changes.attribution',
      attributes: { ...scope, path: file.path, toolNamed: toolPaths.includes(file.path),
        source: treeStats.has(file.path) ? 'snapshot' : 'baseline-fallback',
        additions: file.additions, deletions: file.deletions } });
  }
  return report(files, 'snapshot', treeStats.size);
}
function composeChangeFiles(
  treeStats: ReadonlyMap<string, FileChangeStat>,
  toolPaths: readonly string[],
): readonly ChangedFileSummary[] {
  const ordered: string[] = [];
  const seen = new Set<string>();
  const push = (path: string): void => {
    if (seen.has(path)) {
      return;
    }
    seen.add(path);
    ordered.push(path);
  };
  for (const path of toolPaths) {
    if (treeStats.has(path)) {
      push(path);
    }
  }
  for (const path of treeStats.keys()) {
    push(path);
  }
  return ordered.slice(0, MAX_CHANGED_FILES_PER_TURN).map((path) => {
    const stat = treeStats.get(path);
    return {
      path,
      additions: stat?.additions ?? null,
      deletions: stat?.deletions ?? null,
    };
  });
}

function fallbackChangeFiles(
  stats: ReadonlyMap<string, FileChangeStat>,
  toolPaths: readonly string[],
  measuredFiles: readonly ChangedFileSummary[],
): readonly ChangedFileSummary[] {
  return toolPaths
    .filter((path) => {
      const stat = stats.get(path);
      // Preserve an observed change as unknown when rereading failed, but
      // remove it when a successful comparison proves it was reverted.
      return hasFileChange(stat) || (stat === undefined && measuredFiles.some((file) => file.path === path));
    })
    .slice(0, MAX_CHANGED_FILES_PER_TURN)
    .map((path) => {
      const stat = stats.get(path);
      return {
        path,
        additions: stat?.additions ?? null,
        deletions: stat?.deletions ?? null,
      };
    });
}
