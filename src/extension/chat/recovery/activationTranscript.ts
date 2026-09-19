import type { RuntimeSessionTarget } from '../../../runtime/DroidRuntime';
import type { SessionHistoryLoader } from '../../../runtime/history/SessionHistory';
import { EMPTY_SESSION_TOKEN_USAGE } from '../../../shared/protocol/tokenUsage';
import {
  createHostTranscriptState,
  type HostTranscriptState,
} from '../../recovery/hostTranscriptState';
import { historyWithLocalChanges } from '../../recovery/historyWithLocalChanges';
import { trimTranscriptToLimits } from '../../../shared/transcript/transcriptLimits';
import { formatUnknownError, isUsableWorkspace } from '../internals';
import type { ActivationTranscriptPort } from './activationTranscriptPort';
import { elapsedMs, type SessionSwitchTimings } from '../sessions/sessionSwitchTimings';

export async function prepareActivationTranscript(
  ctl: ActivationTranscriptPort,
  target: RuntimeSessionTarget,
  generation: number,
  phases?: SessionSwitchTimings,
): Promise<HostTranscriptState | null> {
  if (target.kind === 'new') {
    ctl.missionState.mission = null;
    ctl.metadata.tokenUsage = EMPTY_SESSION_TOKEN_USAGE;
    return createHostTranscriptState('complete');
  }

  const conversationId = ctl.recoveryStore.resolveConversationId(target.sessionId);
  const conversation =
    conversationId === undefined
      ? undefined
      : ctl.recoveryStore.readConversation(conversationId);
  const verifiedTranscript = (value: HostTranscriptState): HostTranscriptState => ({
    ...value,
    transcript: value.transcript.filter((item) => {
      if (item.kind !== 'changes') return true;
      const owner = conversation?.turns.find((turn) => turn.turnId === item.turnId)?.sessionId ?? target.sessionId;
      const snapshot = ctl.turnSnapshots?.read(owner, item.turnId);
      return snapshot?.before === undefined || snapshot.before !== snapshot.after;
    }),
  });
  const historyStartedAt = performance.now();
  const loaded = await loadHistoryTimed(ctl, target.cwd, target.sessionId);
  if (phases !== undefined) {
    phases.historyMs = elapsedMs(historyStartedAt);
  }
  const workspace = ctl.getWorkspaceContext();
  if (
    ctl.sessionState.disposed ||
    ctl.sessionState.runtimeGeneration !== generation ||
    !isUsableWorkspace(workspace) ||
    workspace.cwd !== target.cwd
  ) {
    return null;
  }
  if (loaded?.status !== 'available') {
    throw new Error('Droid session history could not be loaded. Retry to open this session.');
  }
  ctl.missionState.mission =
    loaded?.status === 'available' ? (loaded.mission ?? null) : null;
  ctl.metadata.tokenUsage = {
    cumulative: loaded?.status === 'available' ? (loaded.tokenUsage ?? null) : null,
    lastTurn: null,
  };
  const reconciled = historyWithLocalChanges(loaded.state, conversation);
  ctl.recordHost({
    level: 'info',
    name: 'host.perf.recovery',
    attributes: {
      sessionId: target.sessionId,
      source: 'droid-history',
      loaded: loaded.state.transcript.length,
      reconciled: reconciled.transcript.length,
    },
  });
  return verifiedTranscript(reconciled);
}

export async function loadHistoryTimed(
  ctl: ActivationTranscriptPort,
  cwd: string,
  sessionId: string,
): Promise<Awaited<ReturnType<SessionHistoryLoader['loadHistory']>> | null> {
  const startedAt = performance.now();
  try {
    const conversationId = ctl.recoveryStore.resolveConversationId(sessionId);
    const nodes = conversationId === undefined ? [] :
      ctl.recoveryStore.readConversation(conversationId)?.nodes ?? [];
    const sessionIds = [sessionId];
    let node = nodes.find((candidate) => candidate.sessionId === sessionId);
    while (node !== undefined && (node.relation === 'compact' || node.relation === 'handoff') &&
      node.parentSessionId !== null && !sessionIds.includes(node.parentSessionId)) {
      const parent = node.parentSessionId;
      sessionIds.unshift(parent);
      node = nodes.find((candidate) => candidate.sessionId === parent);
    }
    let combined = createHostTranscriptState('complete');
    let loaded: Awaited<ReturnType<SessionHistoryLoader['loadHistory']>> | null = null;
    const generation = ctl.sessionState.runtimeGeneration;
    const seen = new Set<string>();
    for (const id of sessionIds) {
      loaded = await ctl.sessionHistory.loadHistory({ cwd, sessionId: id });
      if (ctl.sessionState.disposed || ctl.sessionState.runtimeGeneration !== generation) return null;
      if (loaded.status !== 'available') {
        throw new Error('Droid session history is unavailable.');
      }
      const incoming = loaded.state.transcript.filter((item) => {
        if (seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
      });
      const bounded = trimTranscriptToLimits([...combined.transcript, ...incoming]);
      combined = {
        transcript: bounded.transcript,
        historyStatus: bounded.trimmed || combined.truncated || loaded.state.truncated
          ? 'partial' : loaded.state.historyStatus,
        truncated: bounded.trimmed || combined.truncated || loaded.state.truncated,
      };
    }
    ctl.recordHost({
      level: 'info',
      name: 'runtime.history.finished',
      attributes: {
        durationMs: Math.round(performance.now() - startedAt),
        outcome: loaded?.status ?? 'unavailable',
        sessionId,
        ...(loaded?.status === 'available'
          ? {
              items: combined.transcript.length,
              historyStatus: combined.historyStatus,
            }
          : {}),
      },
    });
    return loaded?.status === 'available' ? { ...loaded, state: combined } : loaded;
  } catch (error) {
    ctl.recordHost({
      level: 'error',
      name: 'runtime.history.finished',
      attributes: {
        durationMs: Math.round(performance.now() - startedAt),
        outcome: 'failed',
        sessionId,
      },
      detail: formatUnknownError(error),
    });
    return null;
  }
}
