import type { DaemonMissionCatalogRow } from '../../../runtime/daemon/DaemonMissionCatalog';

/** The daemon mixes real session rows with Mission records keyed by Mission id. */
export function joinMissionCatalogRows(
  rows: readonly DaemonMissionCatalogRow[],
): DaemonMissionCatalogRow[] {
  const metadata = new Map<string, DaemonMissionCatalogRow>();
  for (const row of rows) {
    if (isSessionRow(row) || row.mission === undefined) continue;
    const previous = metadata.get(row.sessionId);
    if (!previous || modifiedTime(row) > modifiedTime(previous)) {
      metadata.set(row.sessionId, row);
    }
  }
  return rows.flatMap(row => {
    if (!isSessionRow(row) || row.mission === undefined) return [];
    const missionId = row.tags?.find(tag =>
      tag.name === 'mission-session' && tag.metadata?.role === 'orchestrator',
    )?.metadata?.missionId;
    const official = missionId === undefined ? undefined : metadata.get(missionId);
    return [{
      ...row,
      mission: {
        ...row.mission,
        ...official?.mission,
      },
    }];
  });
}

function isSessionRow(row: DaemonMissionCatalogRow): boolean {
  return row.hostId !== undefined || row.cwd !== undefined || row.repoRoot !== undefined ||
    row.messagesCount !== undefined || row.tags !== undefined;
}

function modifiedTime(row: DaemonMissionCatalogRow): number {
  const missionTime = Date.parse(row.mission?.updatedAt ?? '');
  return Number.isFinite(missionTime) ? missionTime : row.updatedAt * 1_000;
}
