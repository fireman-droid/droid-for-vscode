import type { HostToWebviewMessage } from '../../shared/bridgeMessages';
import { projectQueueState } from './queue';
import { withActiveSession } from './sessionDirectory';
import { stampRunningFlags } from './sessionRunning';
import type { ChatControllerInternals } from './internals';

export type HostSnapshotProjection = Omit<
  Extract<HostToWebviewMessage, { type: 'host.snapshot' }>,
  'sequence'
>;

export function buildHostSnapshot(
  ctl: ChatControllerInternals,
): HostSnapshotProjection {
  if (ctl.turn === null) {
    ctl.diagnostics?.endTurnScope?.();
  }
  const sessions = stampRunningFlags(
    ctl,
    withActiveSession(ctl, ctl.sessions),
  );
  const workspaceRoot = ctl.getWorkspaceContext().cwd;
  const snapshot = {
    type: 'host.snapshot',
    sessionId: ctl.sessionId,
    connection: ctl.connection,
    turn:
      ctl.turn === null
        ? null
        : {
            turnId: ctl.turn.turnId,
            status: ctl.turn.status,
            ...(ctl.turn.error === undefined
              ? {}
              : { error: ctl.turn.error }),
          },
    sessions,
    settings: ctl.settings,
    context: ctl.context,
    modelCatalog: ctl.modelCatalog,
    transcript: ctl.transcript.transcript,
    historyStatus: ctl.transcript.historyStatus,
    truncated: ctl.transcript.truncated,
    ...(ctl.mission === null || ctl.sessionId === null
      ? {}
      : { mission: ctl.mission }),
    ...(ctl.worktreeCreateAvailable
      ? { worktreeCreateAvailable: true }
      : {}),
    ...(ctl.btwSideChat === null ? {} : { btwAvailable: true }),
    ...(ctl.runtime?.supportsBackgroundTurns?.() === true
      ? { backgroundTurnsAvailable: true }
      : {}),
    ...(ctl.sessionId === null ||
    (ctl.tokenUsage.cumulative === null &&
      ctl.tokenUsage.lastTurn === null)
      ? {}
      : { tokenUsage: ctl.tokenUsage }),
    ...(ctl.sessionId === null ||
    ctl.queuedPrompts.items.length === 0
      ? {}
      : { queue: projectQueueState(ctl) }),
    ...(workspaceRoot === null ? {} : { workspaceRoot }),
  } satisfies HostSnapshotProjection;
  try {
    ctl.recordHost({
      level: 'debug',
      name: 'host.perf.snapshot',
      attributes: {
        bytes: JSON.stringify(snapshot).length,
        items: ctl.transcript.transcript.length,
      },
    });
  } catch {
    // Measurement failures never block the snapshot.
  }
  return snapshot;
}
