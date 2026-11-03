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

const COMPACT_ADOPTION_FAILED_MESSAGE =
  'The conversation was compacted, but the chat could not switch to its new session. Retry to reconnect to the original session, or refresh History to open the compacted session.';

export function handleSessionCompact(ctl: CompactPort, sessionId: string, mode?: 'handoff'): void {
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
  void performCompact(ctl, runtime, sessionId, mode).finally(() => {
    ctl.sessionState.sessionOperationInProgress = false;
  });
}

/**
 * Reload compacted history without replacing an unchanged session identity.
 * Handoff (and older backends) may return a successor that must be adopted.
 */
export async function performCompact(
  ctl: CompactPort,
  runtime: DroidRuntime,
  sessionId: string,
  mode?: 'handoff',
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
    const result = await runtime.compact!(mode);
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

  const inPlace = compactedSessionId === sessionId;
  if (!inPlace) {
    const previousTitle = ctl.effects.activeSessionSummary()?.title ?? 'Current session';
    const adopted = await ctl.effects.adoptDurableSuccessor(
      conversationId, sessionId, compactedSessionId, mode ?? 'compact',
    );
    if (!ctl.isCurrentSessionOperation(runtime, generation, sessionId, cwd)) return;
    if (!adopted) {
      ctl.sessionState.connection = { status: 'unavailable', message: COMPACT_ADOPTION_FAILED_MESSAGE };
      ctl.emitSessionDiagnostic('session-compact-failed', COMPACT_ADOPTION_FAILED_MESSAGE);
      ctl.emitSnapshot();
      return;
    }
    ctl.effects.commitSessionBinding({
      sessionId: compactedSessionId, conversationId,
      transcript: ctl.recoveryState.transcript, turn: null,
      catalogEntry: {
        id: compactedSessionId, title: previousTitle, messageCount: 0,
        modifiedTime: new Date().toISOString(), active: true, isFavorite: false,
      },
    });
  }

  // Any page request started before compaction now belongs to an obsolete window.
  ctl.recoveryState.historyWindow = null;
  ctl.recoveryState.historyView = null;
  let mission: SessionMissionSummary | null = inPlace ? ctl.missionState.mission : null;
  let tokenUsage: TokenUsageBreakdown | null = inPlace ? ctl.metadata.tokenUsage.cumulative : null;
  {
    const loaded = await ctl.effects.loadHistoryTimed(cwd, compactedSessionId);
    if (loaded?.status === 'available') {
      mission = loaded.mission ?? null;
      tokenUsage = loaded.tokenUsage ?? tokenUsage;
    }
  }
  if (!ctl.isCurrentSessionOperation(runtime, generation, compactedSessionId, cwd)) {
    return;
  }
  ctl.missionState.mission = mission;
  ctl.metadata.tokenUsage = {
    cumulative: tokenUsage, lastTurn: inPlace ? ctl.metadata.tokenUsage.lastTurn : null,
  };
  ctl.recoveryStore.selectConversation(conversationId);
  const checkpointSaved = await ctl.effects.flushRecoveryCheckpointOrReport();
  if (!ctl.isCurrentSessionOperation(runtime, generation, compactedSessionId, cwd)) return;
  if (!checkpointSaved) {
    ctl.sessionState.connection = {
      status: 'unavailable',
      message: 'The compacted session is active, but its chat state could not be saved. Retry to reconnect to it.',
    };
    ctl.emitSnapshot();
    return;
  }
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
