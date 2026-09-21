import type { SubagentWatchPort } from './subagentWatchPort';
import type { RuntimeSessionWorkingState } from '../../../runtime/DroidRuntime';
import type { SessionTokenUsageState } from '../../../shared/protocol/tokenUsage';
import type { HostTranscriptState } from '../../recovery/hostTranscriptState';
import { reconcileSessionHistory } from '../../recovery/reconcileSessionHistory';
import { isTurnActive } from '../internals';

const PARENT_FOLLOWUP_IDLE_GRACE_MS = 10_000;
const PARENT_FOLLOWUP_FALLBACK_MAX_MS = 30_000;
interface ParentFollowupSync {
  readonly sessionId: string;
  readonly runtimeGeneration: number;
  readonly assistantMarker: string;
  readonly settledAt: number;
  readonly fallbackDeadlineAt: number;
  sawRunning: boolean;
  lastRunningAt: number | null;
}
const parentFollowupSyncs = new WeakMap<object, ParentFollowupSync>();
export function clearParentFollowupSync(ctl: SubagentWatchPort): void { parentFollowupSyncs.delete(ctl); }
export function hasParentFollowupSync(ctl: SubagentWatchPort): boolean { return parentFollowupSyncs.has(ctl); }
export function startParentFollowupSync(ctl: SubagentWatchPort, sessionId: string): void {
  const now = Date.now();
  parentFollowupSyncs.set(ctl, {
    sessionId, runtimeGeneration: ctl.sessionState.runtimeGeneration,
    assistantMarker: transcriptAssistantMarker(ctl.recoveryState.transcript.transcript),
    settledAt: now, fallbackDeadlineAt: now + PARENT_FOLLOWUP_FALLBACK_MAX_MS,
    sawRunning: false, lastRunningAt: null,
  });
}

/**
 * Fallback reconciliation for missed automatic-parent notifications and
 * process backends. ParentFollowup owns live daemon deltas; this poll only
 * refreshes an idle transcript and never overwrites a newly adopted turn.
 */
export async function syncParentFollowupHistory(
  ctl: SubagentWatchPort,
  watch: NonNullable<SubagentWatchPort['subagentState']['zombieSubagentWatch']>,
  cwd: string,
): Promise<void> {
  const sync = parentFollowupSyncs.get(ctl);
  if (sync === undefined || sync.sessionId !== watch.sessionId) {
    return;
  }
  if (ctl.sessionState.runtimeGeneration !== sync.runtimeGeneration) {
    parentFollowupSyncs.delete(ctl);
    return;
  }
  // A user-started foreground turn owns transcript projection until
  // it settles. The parent follow-up history read can safely wait.
  if (ctl.sessionState.sessionOperationInProgress || isTurnActive(ctl.turnState.turn)) {
    return;
  }
  const turnGeneration = ctl.turnState.turnGeneration;

  const runtime = ctl.sessionState.runtime;
  let workingState: RuntimeSessionWorkingState | null = null;
  if (runtime !== null && runtime.readSessionWorkingState !== undefined) {
    try {
      workingState = await runtime.readSessionWorkingState();
    } catch {
      // Process sessions expose the Runtime method but cannot report
      // backend state. Treat that as the bounded fallback path.
      workingState = 'unknown';
    }
    if (
      ctl.subagentState.zombieSubagentWatch !== watch ||
      ctl.sessionState.runtime !== runtime ||
      ctl.sessionState.disposed ||
      ctl.sessionState.sessionId !== sync.sessionId ||
      ctl.turnState.turnGeneration !== turnGeneration ||
      isTurnActive(ctl.turnState.turn)
    ) {
      return;
    }
    if (workingState === 'running' || workingState === 'waiting-for-user') {
      sync.sawRunning = true;
      sync.lastRunningAt = Date.now();
      return;
    }
    if (
      workingState === 'idle' &&
      ((!sync.sawRunning &&
        Date.now() - sync.settledAt < PARENT_FOLLOWUP_IDLE_GRACE_MS) ||
        (sync.lastRunningAt !== null &&
          Date.now() - sync.lastRunningAt < PARENT_FOLLOWUP_IDLE_GRACE_MS))
    ) {
      return;
    }
    if (
      workingState === 'unknown' &&
      Date.now() - sync.settledAt < PARENT_FOLLOWUP_IDLE_GRACE_MS
    ) {
      return;
    }
  } else if (Date.now() - sync.settledAt < PARENT_FOLLOWUP_IDLE_GRACE_MS) {
    return;
  }

  const loaded = await ctl.sessionHistory
    .loadHistory({ cwd, sessionId: sync.sessionId })
    .catch(() => null);
  const currentSync = parentFollowupSyncs.get(ctl);
  if (
    ctl.subagentState.zombieSubagentWatch !== watch ||
    ctl.sessionState.disposed ||
    ctl.sessionState.sessionId !== sync.sessionId ||
    ctl.sessionState.runtimeGeneration !== sync.runtimeGeneration ||
    ctl.turnState.turnGeneration !== turnGeneration ||
    isTurnActive(ctl.turnState.turn) ||
    ctl.sessionState.sessionOperationInProgress ||
    currentSync !== sync
  ) {
    return;
  }
  const available = loaded?.status === 'available';
  let visibleAnswerChanged = false;
  if (available) {
    const mission = loaded.mission ?? null;
    const tokenUsage: SessionTokenUsageState = {
      cumulative: loaded.tokenUsage ?? ctl.metadata.tokenUsage.cumulative,
      lastTurn: ctl.metadata.tokenUsage.lastTurn,
    };
    const transcript = reconcileSessionHistory(
      loaded.state,
      ctl.recoveryState.transcript,
      { preserveLocalTail: true },
    );
    visibleAnswerChanged =
      transcriptAssistantMarker(transcript.transcript) !== sync.assistantMarker;
    const changed =
      !sameTranscriptState(transcript, ctl.recoveryState.transcript) ||
      !sameMission(mission, ctl.missionState.mission) ||
      !sameTokenUsage(tokenUsage, ctl.metadata.tokenUsage);
    ctl.missionState.mission = mission;
    ctl.metadata.tokenUsage = tokenUsage;
    ctl.recoveryState.transcript = transcript;
    if (changed && ctl.sessionState.conversationId !== null) {
      ctl.recoveryStore.writeActiveDisplay(
        ctl.sessionState.conversationId,
        sync.sessionId,
        transcript,
        ctl.turnState.turn === null
          ? null
          : {
              turnId: ctl.turnState.turn.turnId,
              status: ctl.turnState.turn.status,
              ...(ctl.turnState.turn.error === undefined
                ? {}
                : { error: ctl.turnState.turn.error }),
            },
      );
      ctl.recoveryStore.flushInBackground();
      ctl.emitSnapshot();
    }
    if (visibleAnswerChanged && workingState === 'idle' && sync.sawRunning) {
      parentFollowupSyncs.delete(ctl);
    }
  }
  ctl.recordHost({
    level: available ? 'info' : 'warn',
    name: 'host.subagent.parent-history-sync',
    attributes: {
      outcome: available ? 'ok' : 'failed',
      sessionId: sync.sessionId,
      ...(available ? { items: ctl.recoveryState.transcript.transcript.length } : {}),
    },
  });

  if (
    parentFollowupSyncs.get(ctl) === sync &&
    available &&
    (workingState === 'idle' || runtime?.supportsBackgroundTurns?.() !== true) &&
    Date.now() >=
      Math.max(
        sync.fallbackDeadlineAt,
        (sync.lastRunningAt ?? 0) + PARENT_FOLLOWUP_FALLBACK_MAX_MS,
      )
  ) {
    // A turn too short to observe can start after the first idle
    // history read. Keep the no-running/unknown fallback alive for
    // the full bounded window, then stop permanent background I/O.
    parentFollowupSyncs.delete(ctl);
  }
}

/**
 * Content-only marker for user-visible assistant output. History
 * projection synthesizes different ids than the live stream, so ids
 * cannot prove that the automatic parent turn added an answer.
 */
function transcriptAssistantMarker(
  transcript: HostTranscriptState['transcript'],
): string {
  let count = 0;
  let lastText = '';
  for (const item of transcript) {
    if (item.kind !== 'assistant') {
      continue;
    }
    count += 1;
    lastText = item.text;
  }
  return JSON.stringify([count, lastText]);
}

function sameMission(
  left: SubagentWatchPort['missionState']['mission'],
  right: SubagentWatchPort['missionState']['mission'],
): boolean {
  if (left === null || right === null) {
    return left === right;
  }
  return left.state === right.state && left.role === right.role;
}

function sameTokenUsage(
  left: SessionTokenUsageState,
  right: SessionTokenUsageState,
): boolean {
  return (
    sameTokenBreakdown(left.cumulative, right.cumulative) &&
    sameTokenBreakdown(left.lastTurn, right.lastTurn)
  );
}

function sameTranscriptState(
  left: HostTranscriptState,
  right: HostTranscriptState,
): boolean {
  return (
    left.historyStatus === right.historyStatus &&
    left.truncated === right.truncated &&
    JSON.stringify(left.transcript) === JSON.stringify(right.transcript)
  );
}

function sameTokenBreakdown(
  left: SessionTokenUsageState['cumulative'],
  right: SessionTokenUsageState['cumulative'],
): boolean {
  return (
    left?.inputTokens === right?.inputTokens &&
    left?.outputTokens === right?.outputTokens &&
    left?.cacheReadTokens === right?.cacheReadTokens &&
    left?.cacheCreationTokens === right?.cacheCreationTokens &&
    left?.thinkingTokens === right?.thinkingTokens &&
    left?.factoryCredits === right?.factoryCredits
  );
}
