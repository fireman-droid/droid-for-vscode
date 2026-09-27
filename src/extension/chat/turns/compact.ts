import type { DroidRuntime } from '../../../runtime/DroidRuntime';
import { type SessionMissionSummary } from '../../../shared/protocol/sessions';
import type { TokenUsageBreakdown } from '../../../shared/protocol/tokenUsage';
import { isSafeBridgeId } from '../internals';
import { evaluateActiveSessionTransform } from '../operationEligibility';
import { refreshContextAfterTurn } from './turnSettlement';
import type { CompactPort } from './turnFlowPort';

export const COMPACT_BLOCKED_MESSAGE =
  'Droid cannot compact right now. Wait for the current activity to finish.';

export const COMPACT_UNSUPPORTED_MESSAGE =
  'This Droid runtime does not support context compaction.';

export const COMPACT_FAILED_MESSAGE = 'Droid could not compact the conversation.';

export function handleSessionCompact(ctl: CompactPort, sessionId: string): void {
  const runtime = ctl.sessionState.runtime;
  if (runtime !== null && !ctl.effects.ensureActiveRuntimeWorkspaceCurrent()) {
    return;
  }
  if (
    runtime === null ||
    ctl.sessionState.connection.status !== 'connected' ||
    sessionId !== ctl.sessionState.sessionId
  ) {
    return;
  }
  if (
    evaluateActiveSessionTransform({
      turn: ctl.turnState.turn,
      hasPendingInteractions: ctl.interactions.hasPending(),
      sessionOperationInProgress: ctl.sessionState.sessionOperationInProgress,
      refreshInProgress: ctl.catalogState.refreshInProgress,
      settingsUpdateInProgress: ctl.metadata.settingsUpdate !== null,
    }).kind !== 'eligible'
  ) {
    ctl.emitSessionDiagnostic('session-compact-blocked', COMPACT_BLOCKED_MESSAGE);
    return;
  }
  if (typeof runtime.compact !== 'function') {
    ctl.emitSessionDiagnostic('session-compact-unsupported', COMPACT_UNSUPPORTED_MESSAGE);
    return;
  }

  ctl.sessionState.sessionOperationInProgress = true;
  void performCompact(ctl, runtime, sessionId).finally(() => {
    ctl.sessionState.sessionOperationInProgress = false;
  });
}

/**
 * Compacts the active session and adopts the continuation session
 * that Droid returns, reloading its summarized transcript.
 */
export async function performCompact(
  ctl: CompactPort,
  runtime: DroidRuntime,
  sessionId: string,
): Promise<void> {
  const generation = ctl.sessionState.runtimeGeneration;
  const cwd = ctl.sessionState.activeRuntimeCwd;
  const conversationId = ctl.sessionState.conversationId;
  if (cwd === null || conversationId === null) {
    return;
  }

  let compactedSessionId: string;
  let removedCount: number;
  try {
    const result = await runtime.compact!();
    compactedSessionId = result.sessionId;
    removedCount = result.removedCount;
  } catch {
    if (ctl.isCurrentSessionOperation(runtime, generation, sessionId, cwd)) {
      ctl.emitSessionDiagnostic('session-compact-failed', COMPACT_FAILED_MESSAGE);
    }
    return;
  }
  if (!ctl.isCurrentSessionOperation(runtime, generation, sessionId, cwd)) {
    return;
  }
  if (!isSafeBridgeId(compactedSessionId)) {
    ctl.emitSessionDiagnostic('session-compact-failed', COMPACT_FAILED_MESSAGE);
    return;
  }

  const previousTitle = ctl.effects.activeSessionSummary()?.title ?? 'Current session';
  if (
    !(await ctl.effects.adoptDurableSuccessor(
      conversationId,
      sessionId,
      compactedSessionId,
      'compact',
    ))
  ) {
    ctl.emitSessionDiagnostic('session-compact-failed', COMPACT_FAILED_MESSAGE);
    return;
  }
  // The compacted session stays in the catalog: its file remains on
  // disk with the full pre-compaction history, and the compaction
  // divider's "View full history" jump needs it selectable.
  ctl.sessionState.sessionId = compactedSessionId;
  ctl.turnState.turn = null;
  ctl.catalogState.sessions = ctl.effects.withActiveSession(ctl.catalogState.sessions, {
    id: compactedSessionId,
    title: previousTitle,
    messageCount: 0,
    modifiedTime: new Date().toISOString(),
    active: true,
    isFavorite: false,
  });

  let mission: SessionMissionSummary | null = null;
  let tokenUsage: TokenUsageBreakdown | null = null;
  {
    const loaded = await ctl.effects.loadHistoryTimed(cwd, compactedSessionId);
    if (loaded?.status === 'available') {
      mission = loaded.mission ?? null;
      tokenUsage = loaded.tokenUsage ?? null;
    }
  }
  if (!ctl.isCurrentSessionOperation(runtime, generation, compactedSessionId, cwd)) {
    return;
  }
  ctl.missionState.mission = mission;
  // The compacted successor is a new session; its counters restart.
  ctl.metadata.tokenUsage = { cumulative: tokenUsage, lastTurn: null };
  ctl.recoveryStore.selectConversation(conversationId);
  if (!(await ctl.effects.flushRecoveryCheckpointOrReport())) return;
  ctl.emitSnapshot();
  ctl.emit({
    type: 'runtime.diagnostic',
    sessionId: compactedSessionId,
    turnId: null,
    severity: 'info',
    code: 'session-compacted',
    message:
      removedCount > 0
        ? `Conversation compacted: ${removedCount} earlier messages summarized.`
        : 'Conversation compacted.',
  });
  refreshContextAfterTurn(ctl, compactedSessionId);
}
