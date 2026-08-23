import {
  MAX_CHANGED_FILES_PER_TURN,
  type ChangedFileSummary,
} from '../../shared/bridgeMessages';
import type { FileChangeStat } from '../changeStats';
import type { ChatControllerInternals } from './internals';

/**
 * Settled ledger rows for one finished turn: git tree diff is the
 * authority when a before-snapshot exists; tool-named ignored paths
 * and non-git workspaces fall back to the in-memory baseline reader.
 */
export async function resolveSettledChangeFiles(
  ctl: ChatControllerInternals,
  sessionId: string,
  turnId: string,
  toolPaths: readonly string[],
): Promise<readonly ChangedFileSummary[]> {
  const scope = { sessionId, turnId };
  const snapshots = ctl.turnSnapshots;
  if (snapshots === undefined) {
    return toolPaths.length === 0
      ? []
      : fallbackChangeFiles(
          await ctl.changeStats.read(toolPaths, scope),
          toolPaths,
        );
  }
  await snapshots.capture(scope, 'after');
  const record = snapshots.read(sessionId, turnId);
  if (record?.before === undefined) {
    return toolPaths.length === 0
      ? []
      : fallbackChangeFiles(
          await ctl.changeStats.read(toolPaths, scope),
          toolPaths,
        );
  }
  const treeStats = await snapshots.diff(scope);
  const extraPaths = toolPaths.filter((path) => !treeStats.has(path));
  return composeChangeFiles(
    treeStats,
    toolPaths,
    extraPaths.length === 0
      ? new Map()
      : await ctl.changeStats.read(extraPaths, scope),
    extraPaths,
  );
}

function composeChangeFiles(
  treeStats: ReadonlyMap<string, FileChangeStat>,
  toolPaths: readonly string[],
  extraStats: ReadonlyMap<string, FileChangeStat>,
  extraPaths: readonly string[],
): readonly ChangedFileSummary[] {
  const keptExtras = extraPaths.filter((path) => {
    const stat = extraStats.get(path);
    return stat === undefined || !isZeroDelta(stat);
  });
  const extraSet = new Set(keptExtras);
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
    if (treeStats.has(path) || extraSet.has(path)) {
      push(path);
    }
  }
  for (const path of treeStats.keys()) {
    push(path);
  }
  return ordered.slice(0, MAX_CHANGED_FILES_PER_TURN).map((path) => {
    const stat = treeStats.get(path) ?? extraStats.get(path);
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
): readonly ChangedFileSummary[] {
  return toolPaths
    .filter((path) => {
      const stat = stats.get(path);
      return stat === undefined || !isZeroDelta(stat);
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

function isZeroDelta(stat: FileChangeStat): boolean {
  return stat.additions === 0 && stat.deletions === 0;
}
