import type { MissionStartMessage } from '../../../shared/protocol/missionProtocol';
import type { ControllerPort } from './controllerMissionPort';
import { recoverMissionProjection } from './recovery';

export { handleMissionCommand } from './controls';

const MISSION_START_BLOCKED = 'Mission setup is still starting.';

export function handleMissionStart(
  ctl: ControllerPort,
  message: MissionStartMessage,
): void {
  const workspace = ctl.getWorkspaceContext();
  const catalog = ctl.metadata.modelCatalog;
  if (
    ctl.missionGateway === undefined ||
    workspace.cwd === null ||
    !workspace.trusted ||
    ctl.sessionState.connection.status !== 'connected' ||
    ctl.sessionState.runtime === null ||
    ctl.sessionState.sessionId === null ||
    catalog.status !== 'ready' ||
    ctl.turnState.turn !== null ||
    ctl.interactions.hasPending() ||
    ctl.missionState.missionStartInProgress
  ) {
    emitRejected(ctl, message.requestId, 'unavailable');
    return;
  }

  const ownerRuntime = ctl.sessionState.runtime;
  const ownerSessionId = ctl.sessionState.sessionId!;
  const ownerGeneration = ctl.sessionState.runtimeGeneration;
  const ownerCwd = workspace.cwd;
  ctl.missionState.missionStartInProgress = true;
  void ctl.missionGateway
    .start({
      workspaceId: ownerCwd,
      cwd: ownerCwd,
      message,
      catalog: catalog.items.filter((model) => !model.disabled),
    })
    .then(async (result) => {
      const ownerIsCurrent = () =>
        !ctl.sessionState.disposed &&
        ctl.isCurrentSessionOperation(
          ownerRuntime,
          ownerGeneration,
          ownerSessionId,
          ownerCwd,
        );
      if (!ownerIsCurrent()) {
        if (result.status === 'ready') {
          await ctl.effects.closeRuntime(result.runtime.runtime).catch(() => undefined);
        }
        return;
      }
      if (result.status === 'rejected') {
        emitRejected(ctl, message.requestId, 'invalid');
        return;
      }
      const oldRuntime = ctl.sessionState.runtime;
      if (oldRuntime === null) {
        emitRejected(ctl, message.requestId, 'unavailable');
        return;
      }
      try {
        await ctl.effects.closeRuntime(oldRuntime);
      } catch {
        await ctl.effects.closeRuntime(result.runtime.runtime).catch(() => undefined);
        emitRejected(ctl, message.requestId, 'unavailable');
        return;
      }
      if (!ownerIsCurrent()) {
        await ctl.effects.closeRuntime(result.runtime.runtime).catch(() => undefined);
        return;
      }

      result.activateInteractions();
      ctl.sessionState.runtimeGeneration += 1;
      ctl.sessionState.runtime = result.runtime.runtime;
      ctl.sessionState.managedRuntimes.add(result.runtime.runtime);
      ctl.sessionState.activeRuntimeCwd = ownerCwd;
      ctl.sessionState.sessionId = result.sessionId;
      ctl.turnState.turn = null;
      ctl.missionState.mission = { state: null, role: 'orchestrator' };
      recoverMissionProjection(ctl, result.runtime.runtime,
        ctl.sessionState.runtimeGeneration, result.sessionId, ownerCwd);
      ctl.effects.loadSessionMetadata(result.runtime.runtime,
        ctl.sessionState.runtimeGeneration, result.sessionId, ownerCwd);
      ctl.recoveryState.transcript = {
        transcript: [],
        historyStatus: 'unavailable',
        truncated: false,
      };
      const conversationId = ctl.recoveryStore.createConversation(
        result.sessionId,
        ctl.recoveryState.transcript,
      );
      if (conversationId === undefined) {
        emitRejected(ctl, message.requestId, 'unavailable');
        return;
      }
      ctl.sessionState.conversationId = conversationId;
      ctl.catalogState.sessions = {
        status: ctl.catalogState.sessions.status,
        items: [
          ...ctl.catalogState.sessions.items.map((entry) => ({
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
      ctl.recoveryStore.selectConversation(conversationId);
      await ctl.recoveryStore.flush();
      if (ctl.sessionState.disposed || ctl.sessionState.sessionId !== result.sessionId) {
        return;
      }

      ctl.emitSnapshot();
      if (ctl.missionState.missionRuntime) ctl.emit(ctl.missionState.missionRuntime.snapshot());
      ctl.emit({
        type: 'mission.controlResult',
        protocolVersion: 25,
        scope: 'selected-chat',
        requestId: message.requestId,
        action: 'start',
        status: 'accepted',
      });
      ctl.effects.handleSend(
        result.sessionId,
        `mission:${message.requestId}`,
        message.task,
      );
    })
    .catch(() => {
      emitRejected(ctl, message.requestId, 'unavailable');
    })
    .finally(() => {
      ctl.missionState.missionStartInProgress = false;
      if (!ctl.sessionState.disposed) ctl.emitSnapshot();
    });
}

function emitRejected(
  ctl: ControllerPort,
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
