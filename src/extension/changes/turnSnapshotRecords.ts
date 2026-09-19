import { MAX_BRIDGE_ID_LENGTH } from '../../shared/bridgeMessages';
import { MAX_CHANGED_FILES_PER_TURN } from '../../shared/protocol/bounds';
import { isSafeWorkspaceRelativePath } from '../../shared/validation/guards';
import type {
  ChangeStatsPersistence,
  ChangeStatsScope,
  CommittedFileStat,
} from './changeStats';

export const MAX_SNAPSHOT_SESSIONS = 8;
export const MAX_SNAPSHOT_TURNS_PER_SESSION = 24;
export const TURN_SNAPSHOTS_VERSION = 1;
const TREE_OID = /^[0-9a-f]{40}$/;

export interface TurnSnapshotRecord {
  readonly turnId: string;
  readonly before?: string;
  readonly after?: string;
  readonly snapshotPaths?: readonly string[];
  readonly files?: readonly CommittedFileStat[];
}

export function readTurn(
  sessions: Map<string, TurnSnapshotRecord[]>,
  sessionId: string,
  turnId?: string,
): TurnSnapshotRecord | undefined {
  const turns = sessions.get(sessionId);
  if (turns === undefined || turns.length === 0) {
    return undefined;
  }
  if (turnId === undefined) {
    return turns[turns.length - 1];
  }
  return turns.find((turn) => turn.turnId === turnId);
}

export function upsertTurn(
  sessions: Map<string, TurnSnapshotRecord[]>,
  scope: ChangeStatsScope,
  patch: Partial<Omit<TurnSnapshotRecord, 'turnId'>>,
): void {
  let turns = sessions.get(scope.sessionId);
  if (turns === undefined) {
    while (sessions.size >= MAX_SNAPSHOT_SESSIONS) {
      const oldest = sessions.keys().next().value as string | undefined;
      if (oldest === undefined) {
        break;
      }
      sessions.delete(oldest);
    }
    turns = [];
    sessions.set(scope.sessionId, turns);
  }
  const index = turns.findIndex((turn) => turn.turnId === scope.turnId);
  if (index === -1) {
    turns.push({ turnId: scope.turnId, ...patch });
    if (turns.length > MAX_SNAPSHOT_TURNS_PER_SESSION) {
      turns.splice(0, turns.length - MAX_SNAPSHOT_TURNS_PER_SESSION);
    }
    return;
  }
  turns[index] = { ...turns[index]!, ...patch };
}

export function cloneSessions(
  source: ReadonlyMap<string, readonly TurnSnapshotRecord[]>,
): Map<string, TurnSnapshotRecord[]> {
  return new Map(
    [...source.entries()].map(([sessionId, turns]) => [
      sessionId,
      turns.map((record) => cloneRecord(record)!),
    ]),
  );
}

export function serializeSessions(sessions: Map<string, TurnSnapshotRecord[]>): {
  readonly version: typeof TURN_SNAPSHOTS_VERSION;
  readonly sessions: ReadonlyArray<{
    readonly sessionId: string;
    readonly turns: readonly TurnSnapshotRecord[];
  }>;
} {
  return {
    version: TURN_SNAPSHOTS_VERSION,
    sessions: [...sessions.entries()].map(([sessionId, turns]) => ({
      sessionId,
      turns: turns.map(({ files: _files, ...turn }) => turn),
    })),
  };
}

export function readPersistedSessions(
  persistence: ChangeStatsPersistence,
): Map<string, TurnSnapshotRecord[]> {
  const records = new Map<string, TurnSnapshotRecord[]>();
  const value = persistence.get<unknown>('droidvisx.turnSnapshots');
  if (
    typeof value !== 'object' ||
    value === null ||
    (value as { version?: unknown }).version !== TURN_SNAPSHOTS_VERSION ||
    !Array.isArray((value as { sessions?: unknown }).sessions)
  ) {
    return records;
  }
  for (const entry of (value as { sessions: unknown[] }).sessions.slice(
    -MAX_SNAPSHOT_SESSIONS,
  )) {
    const parsed = parseSessionEntry(entry);
    if (parsed !== undefined) {
      records.set(parsed.sessionId, parsed.turns);
    }
  }
  return records;
}

export function sanitizeFiles(
  values: readonly unknown[],
): CommittedFileStat[] | undefined {
  if (values.length > MAX_CHANGED_FILES_PER_TURN) {
    return undefined;
  }
  const files: CommittedFileStat[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (typeof value !== 'object' || value === null) {
      return undefined;
    }
    const candidate = value as {
      path?: unknown;
      additions?: unknown;
      deletions?: unknown;
    };
    if (
      !isSafeWorkspaceRelativePath(candidate.path) ||
      seen.has(candidate.path) ||
      !isNullableCount(candidate.additions) ||
      !isNullableCount(candidate.deletions)
    ) {
      return undefined;
    }
    seen.add(candidate.path);
    files.push({
      path: candidate.path,
      additions: candidate.additions,
      deletions: candidate.deletions,
    });
  }
  return files;
}

export function cloneRecord(
  record: TurnSnapshotRecord | undefined,
): TurnSnapshotRecord | undefined {
  if (record === undefined) {
    return undefined;
  }
  return {
    turnId: record.turnId,
    ...(record.before === undefined ? {} : { before: record.before }),
    ...(record.after === undefined ? {} : { after: record.after }),
    ...(record.snapshotPaths === undefined
      ? {}
      : { snapshotPaths: [...record.snapshotPaths] }),
    ...(record.files === undefined
      ? {}
      : { files: record.files.map((file) => ({ ...file })) }),
  };
}

function parseSessionEntry(
  entry: unknown,
): { readonly sessionId: string; readonly turns: TurnSnapshotRecord[] } | undefined {
  if (typeof entry !== 'object' || entry === null) {
    return undefined;
  }
  const sessionId = (entry as { sessionId?: unknown }).sessionId;
  const turnsValue = (entry as { turns?: unknown }).turns;
  if (
    !isBridgeId(sessionId) ||
    !Array.isArray(turnsValue) ||
    turnsValue.length > MAX_SNAPSHOT_TURNS_PER_SESSION
  ) {
    return undefined;
  }
  const turns: TurnSnapshotRecord[] = [];
  for (const turn of turnsValue) {
    const parsed = parseTurnEntry(turn);
    if (parsed !== undefined) {
      turns.push(parsed);
    }
  }
  return turns.length === 0 ? undefined : { sessionId, turns };
}

function parseTurnEntry(entry: unknown): TurnSnapshotRecord | undefined {
  if (typeof entry !== 'object' || entry === null) {
    return undefined;
  }
  const turnId = (entry as { turnId?: unknown }).turnId;
  if (!isBridgeId(turnId)) {
    return undefined;
  }
  const before = optionalOid((entry as { before?: unknown }).before);
  const after = optionalOid((entry as { after?: unknown }).after);
  if (before === 'invalid' || after === 'invalid') {
    return undefined;
  }
  const filesValue = (entry as { files?: unknown }).files;
  const snapshotPathsValue = (entry as { snapshotPaths?: unknown }).snapshotPaths;
  const snapshotPaths =
    snapshotPathsValue === undefined
      ? undefined
      : sanitizeSnapshotPaths(snapshotPathsValue);
  if (snapshotPathsValue !== undefined && snapshotPaths === undefined) {
    return undefined;
  }
  if (filesValue === undefined) {
    return {
      turnId,
      ...(before === undefined ? {} : { before }),
      ...(after === undefined ? {} : { after }),
      ...(snapshotPaths === undefined || snapshotPaths.length === 0
        ? {}
        : { snapshotPaths }),
    };
  }
  if (!Array.isArray(filesValue) || filesValue.length > MAX_CHANGED_FILES_PER_TURN) {
    return undefined;
  }
  const files = sanitizeFiles(filesValue);
  if (files === undefined || files.length !== filesValue.length) {
    return undefined;
  }
  return {
    turnId,
    ...(before === undefined ? {} : { before }),
    ...(after === undefined ? {} : { after }),
    ...(snapshotPaths === undefined || snapshotPaths.length === 0
      ? {}
      : { snapshotPaths }),
    files,
  };
}

function optionalOid(value: unknown): string | undefined | 'invalid' {
  if (value === undefined) {
    return undefined;
  }
  return typeof value === 'string' && TREE_OID.test(value.toLowerCase())
    ? value.toLowerCase()
    : 'invalid';
}

function sanitizeSnapshotPaths(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.length > MAX_CHANGED_FILES_PER_TURN) return;
  const paths: string[] = [];
  const seen = new Set<string>();
  for (const path of value) {
    if (!isSafeWorkspaceRelativePath(path) || seen.has(path)) return;
    seen.add(path);
    paths.push(path);
  }
  return paths;
}

function isNullableCount(value: unknown): value is number | null {
  return value === null || (Number.isSafeInteger(value) && (value as number) >= 0);
}

function isBridgeId(value: unknown): value is string {
  return (
    typeof value === 'string' && value.length > 0 && value.length <= MAX_BRIDGE_ID_LENGTH
  );
}
