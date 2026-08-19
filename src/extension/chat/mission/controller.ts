import type { MissionStartMessage } from '../../../shared/missionProtocol';
import type { ChatControllerInternals } from '../internals';
import { closeRuntime } from '../runtimeLifecycle';
import { handleSend } from '../turnFlow';
import { MissionSnapshotReducer } from './MissionSnapshotReducer';

export { handleMissionCommand } from './controls';

const MISSION_START_BLOCKED = 'Mission setup is still starting.';

export function handleMissionStart(
  ctl: ChatControllerInternals,
  message: MissionStartMessage,
): void {
  const workspace = ctl.getWorkspaceContext();
  const catalog = ctl.modelCatalog;
  if (
    ctl.missionGateway === undefined ||
    workspace.cwd === null ||
    !workspace.trusted ||
    ctl.connection.status !== 'connected' ||
    ctl.runtime === null ||
    ctl.sessionId === null ||
    catalog.status !== 'ready' ||
    ctl.turn !== null ||
    ctl.interactions.hasPending() ||
    ctl.missionStartInProgress
  ) {
    emitRejected(ctl, message.requestId, 'unavailable');
    return;
  }

  const ownerRuntime = ctl.runtime;
  const ownerSessionId = ctl.sessionId!;
  const ownerGeneration = ctl.runtimeGeneration;
  const ownerCwd = workspace.cwd;
  ctl.missionStartInProgress = true;
  void ctl.missionGateway
    .start({
      workspaceId: ownerCwd,
      cwd: ownerCwd,
      message,
      catalog: catalog.items,
    })
    .then(async (result) => {
      const ownerIsCurrent = () =>
        !ctl.disposed &&
        ctl.isCurrentSessionOperation(
          ownerRuntime,
          ownerGeneration,
          ownerSessionId,
          ownerCwd,
        );
      if (!ownerIsCurrent()) {
        if (result.status === 'ready') {
          await closeRuntime(ctl, result.runtime.runtime).catch(() => undefined);
        }
        return;
      }
      if (result.status === 'rejected') {
        emitRejected(ctl, message.requestId, 'invalid');
        return;
      }
      const oldRuntime = ctl.runtime;
      if (oldRuntime === null) {
        emitRejected(ctl, message.requestId, 'unavailable');
        return;
      }
      try {
        await closeRuntime(ctl, oldRuntime);
      } catch {
        await closeRuntime(ctl, result.runtime.runtime).catch(() => undefined);
        emitRejected(ctl, message.requestId, 'unavailable');
        return;
      }
      if (!ownerIsCurrent()) {
        await closeRuntime(ctl, result.runtime.runtime).catch(() => undefined);
        return;
      }

      ctl.runtimeGeneration += 1;
      ctl.runtime = result.runtime.runtime;
      ctl.managedRuntimes.add(result.runtime.runtime);
      ctl.activeRuntimeCwd = ownerCwd;
      ctl.sessionId = result.sessionId;
      ctl.turn = null;
      ctl.mission = { state: null, role: 'orchestrator' };
      ctl.missionRuntime = new MissionSnapshotReducer({
        scrutinyEnabled: !result.settings.skipScrutiny,
        userTestingEnabled: !result.settings.skipUserTesting,
      });
      ctl.transcript = {
        transcript: [],
        historyStatus: 'unavailable',
        truncated: false,
      };
      ctl.sessions = {
        status: ctl.sessions.status,
        items: [
          ...ctl.sessions.items.map((entry) => ({
            ...entry,
            active: false,
          })),
          {
            id: result.sessionId,
            title: 'New Mission',
            messageCount: 0,
            modifiedTime: new Date().toISOString(),
            active: true,
            isFavorite: false,
            missionRole: 'orchestrator',
          },
        ],
      };
      ctl.recoveryStore.writeSession(result.sessionId, ctl.transcript);
      ctl.recoveryStore.selectSession(result.sessionId);
      await ctl.recoveryStore.flush();
      if (ctl.disposed || ctl.sessionId !== result.sessionId) {
        return;
      }

      ctl.emitSnapshot();
      ctl.emit(ctl.missionRuntime.snapshot());
      ctl.emit({
        type: 'mission.controlResult',
        protocolVersion: 25,
        scope: 'selected-chat',
        requestId: message.requestId,
        action: 'start',
        status: 'accepted',
      });
      handleSend(
        ctl,
        result.sessionId,
        `mission:${message.requestId}`,
        message.task,
      );
    })
    .catch(() => {
      emitRejected(ctl, message.requestId, 'unavailable');
    })
    .finally(() => {
      ctl.missionStartInProgress = false;
    });
}

function emitRejected(
  ctl: ChatControllerInternals,
  requestId: string,
  rejectionCode: 'invalid' | 'unavailable',
): void {
  ctl.emit({
    type: 'mission.controlResult',
    protocolVersion: 25,
    scope: 'selected-chat',
    requestId,
    action: 'start',
    status: 'rejected',
    rejectionCode,
  });
  if (rejectionCode === 'unavailable') {
    ctl.emitSessionDiagnostic('mission-start-blocked', MISSION_START_BLOCKED);
  }
}
