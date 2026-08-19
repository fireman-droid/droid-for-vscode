import type { SessionHistoryLoader } from '../runtime/history/SessionHistory';
import type { HostTranscriptState } from '../shared/hostTranscriptState';
import type {
  ChangeStatsReader,
  CommittedTurnRecord,
} from './changeStats';

/**
 * Restores exact counts on the newest synthesized Changes row after
 * Reload. History-generated turn ids can differ from the live id, so
 * the durable committed paths, rather than the id, anchor the merge.
 */
export function createCommittedStatsHistoryLoader(
  base: SessionHistoryLoader,
  changeStats: ChangeStatsReader,
): SessionHistoryLoader {
  return {
    async loadHistory(request) {
      const loaded = await base.loadHistory(request);
      if (loaded.status !== 'available') {
        return loaded;
      }
      const committed = changeStats.readCommittedTurn?.(
        request.sessionId,
      );
      if (committed?.stats === undefined) {
        return loaded;
      }
      return {
        ...loaded,
        state: restoreCommittedHistoryStats(
          loaded.state,
          committed,
        ),
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

export function restoreCommittedHistoryStats(
  state: HostTranscriptState,
  committed: CommittedTurnRecord,
): HostTranscriptState {
  let latestChangesIndex = -1;
  for (
    let index = state.transcript.length - 1;
    index >= 0;
    index -= 1
  ) {
    if (state.transcript[index]?.kind === 'changes') {
      latestChangesIndex = index;
      break;
    }
  }
  if (latestChangesIndex === -1 || committed.stats === undefined) {
    return state;
  }
  const latest = state.transcript[latestChangesIndex];
  if (latest?.kind !== 'changes') {
    return state;
  }
  const stats = new Map(
    committed.stats.map((file) => [file.path, file]),
  );
  if (!latest.files.some((file) => stats.has(file.path))) {
    return state;
  }
  return {
    ...state,
    transcript: state.transcript.map((item, index) =>
      index !== latestChangesIndex || item.kind !== 'changes'
        ? item
        : {
            ...item,
            files: item.files.map((file) => {
              const restored = stats.get(file.path);
              return restored === undefined
                ? file
                : {
                    path: file.path,
                    additions: restored.additions,
                    deletions: restored.deletions,
                  };
            }),
          },
    ),
  };
}
