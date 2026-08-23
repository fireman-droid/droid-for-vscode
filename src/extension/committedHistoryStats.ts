import type { SessionHistoryLoader } from '../runtime/history/SessionHistory';
import type { HostTranscriptState } from '../shared/hostTranscriptState';
import type { TurnSnapshotRecord, TurnSnapshotStore } from './turnSnapshots';

/**
 * Restores exact counts on synthesized Changes rows after Reload.
 * History-generated turn ids can differ from the live id, so path-set
 * overlap is the fallback anchor when the id does not match.
 */
export function createTurnStatsHistoryLoader(
  base: SessionHistoryLoader,
  snapshots: Pick<TurnSnapshotStore, 'readTurns'>,
): SessionHistoryLoader {
  return {
    async loadHistory(request) {
      const loaded = await base.loadHistory(request);
      if (loaded.status !== 'available') {
        return loaded;
      }
      const records = snapshots.readTurns(request.sessionId);
      if (records.length === 0) {
        return loaded;
      }
      return {
        ...loaded,
        state: restoreTurnChangeStats(loaded.state, records),
      };
    },
    ...(base.loadSubagentSummaries === undefined
      ? {}
      : {
          loadSubagentSummaries: (request) =>
            base.loadSubagentSummaries!(request),
        }),
    ...(base.loadSubagentInvocations === undefined
      ? {}
      : {
          loadSubagentInvocations: (request) =>
            base.loadSubagentInvocations!(request),
        }),
  };
}

export function restoreTurnChangeStats(
  state: HostTranscriptState,
  records: readonly TurnSnapshotRecord[],
): HostTranscriptState {
  const unused = records.filter(
    (record) => record.files !== undefined && record.files.length > 0,
  );
  const claimed = new Set<TurnSnapshotRecord>();
  const byTurnId = new Map<string, TurnSnapshotRecord>();
  for (const record of unused) {
    if (!byTurnId.has(record.turnId)) {
      byTurnId.set(record.turnId, record);
    }
  }

  const matches = new Map<string, TurnSnapshotRecord>();
  for (const item of state.transcript) {
    if (item.kind !== 'changes') {
      continue;
    }
    const exact = byTurnId.get(item.turnId);
    if (exact !== undefined && !claimed.has(exact)) {
      claimed.add(exact);
      matches.set(item.id, exact);
    }
  }
  for (let index = state.transcript.length - 1; index >= 0; index -= 1) {
    const item = state.transcript[index];
    if (item?.kind !== 'changes' || matches.has(item.id)) {
      continue;
    }
    const overlap = pickMaxOverlap(item.files, unused, claimed);
    if (overlap !== undefined) {
      claimed.add(overlap);
      matches.set(item.id, overlap);
    }
  }

  return {
    ...state,
    transcript: state.transcript.map((item) => {
      if (item.kind !== 'changes') {
        return item;
      }
      const match = matches.get(item.id);
      if (match?.files === undefined) {
        return item;
      }
      const stats = new Map(match.files.map((file) => [file.path, file]));
      return {
        ...item,
        files: item.files.map((file) => {
          if (file.additions !== null || file.deletions !== null) {
            return file;
          }
          const restored = stats.get(file.path);
          return restored === undefined
            ? file
            : {
                path: file.path,
                additions: restored.additions,
                deletions: restored.deletions,
              };
        }),
      };
    }),
  };
}

function pickMaxOverlap(
  files: readonly { readonly path: string }[],
  unused: readonly TurnSnapshotRecord[],
  claimed: ReadonlySet<TurnSnapshotRecord>,
): TurnSnapshotRecord | undefined {
  const paths = new Set(files.map((file) => file.path));
  let best: TurnSnapshotRecord | undefined;
  let bestOverlap = 0;
  for (let index = unused.length - 1; index >= 0; index -= 1) {
    const record = unused[index]!;
    if (claimed.has(record) || record.files === undefined) {
      continue;
    }
    let overlap = 0;
    for (const file of record.files) {
      if (paths.has(file.path)) {
        overlap += 1;
      }
    }
    if (overlap > bestOverlap) {
      best = record;
      bestOverlap = overlap;
    }
  }
  return best;
}
