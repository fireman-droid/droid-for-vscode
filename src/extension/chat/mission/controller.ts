import type { MissionStartMessage } from '../../../shared/missionProtocol';
import type { ChatControllerInternals } from '../internals';
import { closeRuntime } from '../runtimeLifecycle';
import { handleSend } from '../turnFlow';

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

  ctl.missionStartInProgress = true;
  void ctl.missionGateway
    .start({
      workspaceId: workspace.cwd,
      cwd: workspace.cwd,
      message,
      catalog: catalog.items,
    })
    .then(async (result) => {
      if (ctl.disposed) {
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
        emitRejected(ctl, message.requestId, 'unavailable');
        return;
      }
      if (ctl.disposed) {
        return;
      }

      ctl.runtimeGeneration += 1;
      ctl.runtime = result.runtime.runtime;
      ctl.managedRuntimes.add(result.runtime.runtime);
      ctl.activeRuntimeCwd = workspace.cwd;
      ctl.sessionId = result.sessionId;
      ctl.turn = null;
      ctl.mission = null;
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
      ctl.emit({
        type: 'mission.snapshot',
        protocolVersion: 25,
        scope: 'selected-chat',
        revision: 0,
        availability: 'attached',
        presentationPhase: 'loading',
        features: [],
        completedFeatureCount: 0,
        controls: {
          canPause: false,
          canResume: false,
          canStopCurrentFeature: false,
        },
        validator: {
          scrutinyEnabled: !result.settings.skipScrutiny,
          userTestingEnabled: !result.settings.skipUserTesting,
        },
      });
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
