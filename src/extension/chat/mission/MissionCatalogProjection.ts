import type { DaemonApi } from '../../../runtime/daemon/api';
import { createHash } from 'node:crypto';
import path from 'node:path';

import {
  DAEMON_MISSION_CATALOG_PAGE_SIZE,
  DaemonMissionCatalog,
  type DaemonMissionCatalogRow,
  type DaemonMissionCatalogRuntime,
} from '../../../runtime/daemon/DaemonMissionCatalog';
import {
  MAX_MISSION_CONTROL_CATALOG_ROWS,
  MAX_MISSION_CONTROL_FEATURE_COUNT,
  MAX_MISSION_CONTROL_LABEL_LENGTH,
  MAX_MISSION_CONTROL_TITLE_LENGTH,
  type MissionControlCatalogRow,
} from '../../../shared/protocol/missionControlPanelProtocol';
import {
  containsRepeatedBoundarySlashRun,
  isSafePresentationText,
} from '../../../shared/validation/presentationSafety';

export interface MissionCatalogProjectionOptions {
  readonly getDroid: () => Promise<DaemonApi>;
  readonly catalogRuntime?: DaemonMissionCatalogRuntime;
  readonly resolveComputerLabel?: (hostId: string) => string | undefined;
  readonly getAttachedSessionId?: () => string | undefined;
  readonly timeoutMs?: number;
  readonly rememberCatalogTarget?: (catalogId: string, sessionId: string) => void;
}

export type MissionCatalogResult =
  | {
      readonly status: 'ready';
      readonly rows: readonly MissionControlCatalogRow[];
    }
  | {
      readonly status: 'error';
      readonly code: 'incomplete-list' | 'invalid-data';
      readonly message: string;
    };

const MISSION_CATALOG_TIMEOUT_MS = 15_000;
const MISSION_CATALOG_MAX_PAGES = Math.ceil(
  MAX_MISSION_CONTROL_CATALOG_ROWS / DAEMON_MISSION_CATALOG_PAGE_SIZE,
);
const INCOMPLETE_CATALOG_MESSAGE = 'The complete Mission catalog could not be loaded.';
const INVALID_CATALOG_MESSAGE = 'Mission catalog data was invalid.';

export async function listMissionCatalog(
  options: MissionCatalogProjectionOptions,
): Promise<MissionCatalogResult> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      readCompleteCatalog(options),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new IncompleteCatalogError()),
          options.timeoutMs ?? MISSION_CATALOG_TIMEOUT_MS,
        );
      }),
    ]);
    return { status: 'ready', rows: result };
  } catch (error) {
    if (error instanceof InvalidCatalogError) {
      return {
        status: 'error',
        code: 'invalid-data',
        message: INVALID_CATALOG_MESSAGE,
      };
    }
    return {
      status: 'error',
      code: 'incomplete-list',
      message: INCOMPLETE_CATALOG_MESSAGE,
    };
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

async function readCompleteCatalog(
  options: MissionCatalogProjectionOptions,
): Promise<MissionControlCatalogRow[]> {
  const runtime =
    options.catalogRuntime ??
    DaemonMissionCatalog.fromConnectedDroid(await options.getDroid());
  const candidates: CatalogCandidate[] = [];
  const cursors = new Set<number>();
  let cursor: number | undefined;

  for (let pageIndex = 0; pageIndex < MISSION_CATALOG_MAX_PAGES; pageIndex += 1) {
    const page =
      cursor === undefined ? await runtime.listPage() : await runtime.listPage(cursor);
    if (
      page.rows.length > DAEMON_MISSION_CATALOG_PAGE_SIZE ||
      candidates.length + page.rows.length > MAX_MISSION_CONTROL_CATALOG_ROWS
    ) {
      throw new IncompleteCatalogError();
    }
    for (const raw of page.rows) {
      if (raw.mission !== undefined) {
        candidates.push(projectCatalogCandidate(raw, options));
      }
    }
    if (!page.hasMore) {
      return finalizeCatalog(candidates);
    }
    const next = page.nextCursor;
    if (
      !Number.isSafeInteger(next) ||
      (next as number) < 0 ||
      cursors.has(next as number) ||
      (cursor !== undefined && (next as number) >= cursor)
    ) {
      throw new IncompleteCatalogError();
    }
    cursors.add(next as number);
    cursor = next as number;
  }
  throw new IncompleteCatalogError();
}

interface CatalogCandidate {
  readonly sourceId: string;
  readonly row: MissionControlCatalogRow;
  readonly missionUpdatedTime: number | null;
  readonly daemonUpdatedTime: number;
  readonly stableKey: string;
}

class IncompleteCatalogError extends Error {}
class InvalidCatalogError extends Error {}

function projectCatalogCandidate(
  raw: DaemonMissionCatalogRow,
  options: MissionCatalogProjectionOptions,
): CatalogCandidate {
  if (
    raw.mission === undefined ||
    !isSafeSourceId(raw.sessionId) ||
    !Number.isFinite(raw.updatedAt) ||
    raw.updatedAt < 0
  ) {
    throw new InvalidCatalogError();
  }
  const title =
    raw.mission.title === undefined
      ? 'Untitled Mission'
      : requirePresentationText(raw.mission.title, MAX_MISSION_CONTROL_TITLE_LENGTH);
  const createdAt = projectIsoDate(raw.mission.createdAt);
  const updatedAt = projectIsoDate(raw.mission.updatedAt);
  const progress = projectProgress(
    raw.mission.completedFeatures,
    raw.mission.totalFeatures,
  );
  const elapsedMs =
    raw.mission.elapsedMs === undefined
      ? null
      : requireNonNegativeInteger(raw.mission.elapsedMs);
  const row: MissionControlCatalogRow = {
    catalogId: createCatalogId(raw.sessionId),
    title,
    lifecycle: raw.mission.state,
    workspaceLabel: projectWorkspaceLabel(raw.repoRoot),
    computerLabel: projectComputerLabel(raw.hostId, options),
    progress,
    createdAt,
    updatedAt,
    elapsedMs,
    attached: raw.sessionId === options.getAttachedSessionId?.(),
  };
  options.rememberCatalogTarget?.(row.catalogId, raw.sessionId);
  return {
    sourceId: raw.sessionId,
    row,
    missionUpdatedTime: updatedAt === null ? null : new Date(updatedAt).getTime(),
    daemonUpdatedTime: raw.updatedAt,
    stableKey: JSON.stringify(row),
  };
}

function finalizeCatalog(
  candidates: readonly CatalogCandidate[],
): MissionControlCatalogRow[] {
  const newest = new Map<string, CatalogCandidate>();
  for (const candidate of candidates) {
    const current = newest.get(candidate.sourceId);
    if (current === undefined || compareCandidate(candidate, current) > 0) {
      newest.set(candidate.sourceId, candidate);
    }
  }
  return [...newest.values()]
    .sort((left, right) => {
      const leftCreated =
        left.row.createdAt === null ? null : new Date(left.row.createdAt).getTime();
      const rightCreated =
        right.row.createdAt === null ? null : new Date(right.row.createdAt).getTime();
      if (leftCreated !== rightCreated) {
        if (leftCreated === null) return 1;
        if (rightCreated === null) return -1;
        return rightCreated - leftCreated;
      }
      return compareText(left.row.catalogId, right.row.catalogId);
    })
    .map(({ row }) => row);
}

function compareCandidate(left: CatalogCandidate, right: CatalogCandidate): number {
  const missionDifference =
    (left.missionUpdatedTime ?? -1) - (right.missionUpdatedTime ?? -1);
  if (missionDifference !== 0) {
    return missionDifference;
  }
  const daemonDifference = left.daemonUpdatedTime - right.daemonUpdatedTime;
  return daemonDifference === 0
    ? compareText(left.stableKey, right.stableKey)
    : daemonDifference;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function projectProgress(
  completed: number | undefined,
  total: number | undefined,
): MissionControlCatalogRow['progress'] {
  if (completed === undefined || total === undefined) {
    return null;
  }
  if (!isFeatureCount(completed) || !isFeatureCount(total) || completed > total) {
    throw new InvalidCatalogError();
  }
  return { completed, total };
}

function isFeatureCount(value: number): boolean {
  return (
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= MAX_MISSION_CONTROL_FEATURE_COUNT
  );
}

function requireNonNegativeInteger(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new InvalidCatalogError();
  }
  return value;
}

function projectIsoDate(value: string | undefined): string | null {
  if (value === undefined) {
    return null;
  }
  const date = new Date(value);
  if (
    value.length > 32 ||
    !Number.isFinite(date.getTime()) ||
    date.toISOString() !== value
  ) {
    throw new InvalidCatalogError();
  }
  return value;
}

function projectWorkspaceLabel(repoRoot: string | undefined): string {
  if (
    repoRoot === undefined ||
    repoRoot.length === 0 ||
    repoRoot.length > 2_048 ||
    /[\u0000-\u001f\u007f-\u009f]/.test(repoRoot) ||
    /^(?:https?|wss?|file):\/\//i.test(repoRoot) ||
    /^~[\\/]/.test(repoRoot) ||
    containsRepeatedBoundarySlashRun(repoRoot)
  ) {
    return '—';
  }
  const label = repoRoot.includes('\\')
    ? path.win32.basename(repoRoot)
    : path.posix.basename(repoRoot);
  return isSafePresentationText(label, MAX_MISSION_CONTROL_LABEL_LENGTH) ? label : '—';
}

function projectComputerLabel(
  hostId: string | undefined,
  options: MissionCatalogProjectionOptions,
): string {
  if (hostId === undefined || options.resolveComputerLabel === undefined) {
    return '—';
  }
  const label = options.resolveComputerLabel(hostId);
  return label !== hostId &&
    isSafePresentationText(label, MAX_MISSION_CONTROL_LABEL_LENGTH)
    ? label
    : '—';
}

function requirePresentationText(value: string, maximum: number): string {
  if (!isSafePresentationText(value, maximum)) {
    throw new InvalidCatalogError();
  }
  return value;
}

function isSafeSourceId(value: string): boolean {
  return (
    value.length > 0 && value.length <= 512 && !/[\u0000-\u001f\u007f-\u009f]/.test(value)
  );
}

function createCatalogId(sessionId: string): string {
  return `mission-${createHash('sha256')
    .update('droidvisx-mission-catalog\0')
    .update(sessionId)
    .digest('base64url')
    .slice(0, 32)}`;
}
