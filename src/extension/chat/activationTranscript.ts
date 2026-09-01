import type { RuntimeSessionTarget } from '../../runtime/DroidRuntime';
import type { SessionHistoryLoader } from '../../runtime/history/SessionHistory';
import { EMPTY_SESSION_TOKEN_USAGE } from '../../shared/tokenUsage';
import {
  createHostTranscriptState,
  type HostTranscriptState,
} from '../hostTranscriptState';
import { ingestConversationHistory } from '../ingestConversationHistory';
import {
  formatUnknownError,
  isUsableWorkspace,
  type ChatControllerInternals,
} from './internals';
import {
  elapsedMs,
  type SessionSwitchTimings,
} from './sessionSwitchTimings';

export async function prepareActivationTranscript(
  ctl: ChatControllerInternals,
  target: RuntimeSessionTarget,
  generation: number,
  phases?: SessionSwitchTimings,
): Promise<HostTranscriptState | null> {
  if (target.kind === 'new') {
    ctl.mission = null;
    ctl.tokenUsage = EMPTY_SESSION_TOKEN_USAGE;
    return createHostTranscriptState('complete');
  }

  const conversationId =
    ctl.recoveryStore.resolveConversationId(target.sessionId);
  const conversation =
    conversationId === undefined
      ? undefined
      : ctl.recoveryStore.readConversation(conversationId);
  const recovered = conversation?.display.transcript;
  const historyStartedAt = performance.now();
  const loaded = await loadHistoryTimed(
    ctl,
    target.cwd,
    target.sessionId,
  );
  if (phases !== undefined) {
    phases.historyMs = elapsedMs(historyStartedAt);
  }
  const workspace = ctl.getWorkspaceContext();
  if (
    ctl.disposed ||
    ctl.runtimeGeneration !== generation ||
    !isUsableWorkspace(workspace) ||
    workspace.cwd !== target.cwd
  ) {
    return null;
  }
  ctl.mission =
    loaded?.status === 'available' ? (loaded.mission ?? null) : null;
  ctl.tokenUsage = {
    cumulative:
      loaded?.status === 'available'
        ? (loaded.tokenUsage ?? null)
        : null,
    lastTurn: null,
  };
  if (loaded?.status !== 'available') {
    return recovered ?? createHostTranscriptState('unavailable');
  }

  const reconcileStart = performance.now();
  const activeNode = conversation?.nodes.find(
    (node) => node.sessionId === target.sessionId,
  );
  const reconciled =
    activeNode?.relation === 'compact' && recovered !== undefined
      ? recovered
      : ingestConversationHistory(
          recovered ?? createHostTranscriptState('unavailable'),
          loaded.state,
          {
            allowUnanchoredAppend:
              activeNode?.relation === 'handoff',
          },
        );
  ctl.recordHost({
    level: 'info',
    name: 'host.perf.recovery',
    attributes: {
      sessionId: target.sessionId,
      recovered: recovered?.transcript.length ?? 0,
      loaded: loaded.state.transcript.length,
      reconciled: reconciled.transcript.length,
      reconcileMs: Math.round(performance.now() - reconcileStart),
    },
  });
  return reconciled;
}

export async function loadHistoryTimed(
  ctl: ChatControllerInternals,
  cwd: string,
  sessionId: string,
): Promise<Awaited<
  ReturnType<SessionHistoryLoader['loadHistory']>
> | null> {
  const startedAt = performance.now();
  try {
    const loaded = await ctl.sessionHistory.loadHistory({
      cwd,
      sessionId,
    });
    ctl.recordHost({
      level: 'info',
      name: 'runtime.history.finished',
      attributes: {
        durationMs: Math.round(performance.now() - startedAt),
        outcome: loaded.status,
        sessionId,
        ...(loaded.status === 'available'
          ? {
              items: loaded.state.transcript.length,
              historyStatus: loaded.state.historyStatus,
            }
          : {}),
      },
    });
    return loaded;
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
