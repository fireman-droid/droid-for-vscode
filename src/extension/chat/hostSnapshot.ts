import type { HostToWebviewMessage } from '../../shared/bridgeMessages';
import type { HostSnapshotPort } from './hostSnapshotPort';
import { collapseStoredConversationCatalog } from './sessions/sessionCatalogProjection';

export type HostSnapshotProjection = Omit<
  Extract<HostToWebviewMessage, { type: 'host.snapshot' }>,
  'sequence'
>;

export function buildHostSnapshot(ctl: HostSnapshotPort): HostSnapshotProjection {
  if (ctl.turnState.turn === null) {
    ctl.diagnostics?.endTurnScope?.();
  }
  const sessions = ctl.effects.stampRunningFlags(
    collapseStoredConversationCatalog(
      ctl.effects.withActiveSession(ctl.catalogState.sessions),
      ctl.recoveryStore,
    ),
  );
  const workspaceRoot = ctl.getWorkspaceContext().cwd;
  const latestChanges =
    ctl.sessionState.conversationId === null
      ? undefined
      : ctl.recoveryStore.readLatestChanges(ctl.sessionState.conversationId);
  const latestPrompt = latestChanges?.messageId === undefined ? undefined :
    ctl.recoveryState.transcript.transcript.find(
      (item) => item.kind === 'user' && item.messageId === latestChanges.messageId,
    );
  const snapshot = {
    type: 'host.snapshot',
    conversationId: ctl.sessionState.conversationId,
    sessionId: ctl.sessionState.sessionId,
    connection: ctl.sessionState.connection,
    ...(ctl.readIdeState ? { ide: ctl.readIdeState() } : {}),
    turn:
      ctl.turnState.turn === null
        ? null
        : {
            turnId: ctl.turnState.turn.turnId,
            status: ctl.turnState.turn.status,
            ...(ctl.turnState.turn.compacting === true ? { compacting: true } : {}),
            ...(ctl.turnState.turn.error === undefined
              ? {}
              : { error: ctl.turnState.turn.error }),
          },
    sessions,
    settings: ctl.metadata.settings,
    context: ctl.metadata.context,
    modelCatalog: ctl.metadata.modelCatalog,
    transcript: ctl.recoveryState.transcript.transcript,
    historyStatus: ctl.recoveryState.transcript.historyStatus,
    truncated: ctl.recoveryState.transcript.truncated,
    ...(latestChanges === undefined
      ? {}
      : {
          latestChanges: {
            turnId: latestChanges.turnId,
            prompt: latestPrompt?.kind === 'user' ? latestPrompt.text : null,
            files: latestChanges.files,
          },
        }),
    ...(ctl.missionState.mission === null || ctl.sessionState.sessionId === null
      ? {}
      : { mission: ctl.missionState.mission }),
    ...(ctl.catalogState.worktreeCreateAvailable
      ? { worktreeCreateAvailable: true }
      : {}),
    ...(ctl.btwSideChat === null ? {} : { btwAvailable: true }),
    ...(ctl.sessionState.runtime?.supportsBackgroundTurns?.() === true
      ? { backgroundTurnsAvailable: true }
      : {}),
    ...(ctl.sessionState.sessionId === null ||
    (ctl.metadata.tokenUsage.cumulative === null &&
      ctl.metadata.tokenUsage.lastTurn === null)
      ? {}
      : { tokenUsage: ctl.metadata.tokenUsage }),
    ...(ctl.sessionState.sessionId === null ||
    ctl.queueState.queuedPrompts.items.length === 0
      ? {}
      : { queue: ctl.effects.projectQueueState() }),
    ...(workspaceRoot === null ? {} : { workspaceRoot }),
  } satisfies HostSnapshotProjection;
  try {
    ctl.recordHost({
      level: 'debug',
      name: 'host.perf.snapshot',
      attributes: {
        bytes: JSON.stringify(snapshot).length,
        items: ctl.recoveryState.transcript.transcript.length,
        sessionId: ctl.sessionState.sessionId,
        currentTurnId: ctl.turnState.turn?.turnId ?? null,
        latestChangesTurnId: latestChanges?.turnId ?? null,
        latestChangesFileCount: latestChanges?.files.length ?? 0,
        changesSource: 'latest-nonempty-settled-turn',
      },
    });
  } catch {
    // Measurement failures never block the snapshot.
  }
  return snapshot;
}
