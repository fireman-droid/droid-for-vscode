import type {
  MissionControlMessage,
  MissionDisclosureMessage,
  MissionViewerOpenMessage,
} from '../../../shared/missionProtocol';
import { isTurnActive, type ChatControllerInternals } from '../internals';
import { handleSend } from '../turnFlow';

const MISSION_CONTROL_SETTLE_MS = 30_000;

type MissionCommand =
  | MissionControlMessage
  | MissionDisclosureMessage
  | MissionViewerOpenMessage;

export function handleMissionCommand(
  ctl: ChatControllerInternals,
  message: MissionCommand,
): void {
  if (message.type === 'mission.disclosure.set') {
    emitResult(ctl, message.requestId, 'set-disclosure', 'accepted');
    return;
  }
  if (message.type === 'mission.viewer.open') {
    const mission = ctl.missionRuntime;
    const snapshot = mission?.snapshot();
    const feature = snapshot?.features.find(({ id }) => id === message.featureId);
    const workerSessionId = mission?.workerSessionIdForFeature(message.featureId);
    if (
      mission === null ||
      mission === undefined ||
      snapshot?.revision !== message.snapshotRevision ||
      feature?.workerViewAvailable !== true ||
      workerSessionId === null ||
      workerSessionId === undefined ||
      ctl.missionGateway === undefined
    ) {
      emitResult(ctl, message.requestId, 'open-viewer', 'rejected', 'stale');
      return;
    }
    if (!ctl.missionGateway.openWorkerViewer({
      sessionId: workerSessionId, title: feature.title,
    })) {
      emitResult(ctl, message.requestId, 'open-viewer', 'rejected', 'unavailable');
      return;
    }
    emitResult(ctl, message.requestId, 'open-viewer', 'accepted');
    return;
  }
  if (message.type === 'mission.dismissSetup') {
    emitResult(ctl, message.requestId, 'dismiss-setup', 'accepted');
    return;
  }
  const mission = ctl.missionRuntime;
  if (
    mission === null ||
    ctl.sessionId === null ||
    message.snapshotRevision !== mission.currentRevision()
  ) {
    emitResult(ctl, message.requestId, toAction(message.type), 'rejected', 'stale');
    return;
  }
  if (message.type === 'mission.refresh') {
    ctl.emit(mission.snapshot());
    emitResult(ctl, message.requestId, 'refresh', 'accepted');
    return;
  }
  const snapshot = mission.snapshot();
  if (snapshot.controls.busyAction !== undefined) {
    emitResult(ctl, message.requestId, toAction(message.type), 'rejected', 'busy');
    return;
  }
  if (
    message.type === 'mission.pause' &&
    snapshot.controls.canPause &&
    typeof ctl.runtime?.interruptSession === 'function'
  ) {
    mission.setBusyAction('pause');
    ctl.emit(mission.snapshot());
    scheduleBusyTimeout(ctl, mission, 'pause');
    void ctl.runtime.interruptSession().then(
      () => {
        if (ctl.missionRuntime === mission) {
          emitResult(ctl, message.requestId, 'pause', 'accepted');
        }
      },
      () => rejectOperation(ctl, mission, message.requestId, 'pause'),
    );
    return;
  }
  if (
    message.type === 'mission.resume' &&
    snapshot.controls.canResume &&
    ctl.runtime !== null &&
    !isTurnActive(ctl.turn) &&
    !ctl.interactions.hasPending()
  ) {
    mission.setBusyAction('resume');
    ctl.emit(mission.snapshot());
    scheduleBusyTimeout(ctl, mission, 'resume');
    emitResult(ctl, message.requestId, 'resume', 'accepted');
    handleSend(
      ctl,
      ctl.sessionId,
      `mission-resume:${message.requestId}`,
      'Resume the current Mission from its paused state.',
    );
    return;
  }
  if (
    message.type === 'mission.stopCurrentFeature' &&
    snapshot.controls.canStopCurrentFeature &&
    ctl.missionGateway !== undefined
  ) {
    const workerSessionId = mission.activeWorkerSessionId();
    if (workerSessionId !== null) {
      mission.setBusyAction('stop');
      ctl.emit(mission.snapshot());
      scheduleBusyTimeout(ctl, mission, 'stop');
      void ctl.missionGateway
        .killWorker(ctl.sessionId, workerSessionId)
        .then((accepted) => {
          if (ctl.missionRuntime !== mission) {
            return;
          }
          if (accepted) {
            emitResult(ctl, message.requestId, 'stop-current-feature', 'accepted');
          } else {
            rejectOperation(
              ctl,
              mission,
              message.requestId,
              'stop-current-feature',
            );
          }
        });
      return;
    }
  }
  emitResult(
    ctl,
    message.requestId,
    toAction(message.type),
    'rejected',
    'unavailable',
  );
}

function scheduleBusyTimeout(
  ctl: ChatControllerInternals,
  mission: NonNullable<ChatControllerInternals['missionRuntime']>,
  action: 'pause' | 'resume' | 'stop',
): void {
  setTimeout(() => {
    if (
      ctl.missionRuntime !== mission ||
      mission.snapshot().controls.busyAction !== action
    ) {
      return;
    }
    mission.setBusyAction(undefined);
    ctl.emit(mission.snapshot());
    ctl.emitSessionDiagnostic(
      'mission-control-timeout',
      'Mission control did not settle. Refresh Mission state and try again.',
    );
  }, MISSION_CONTROL_SETTLE_MS);
}

function rejectOperation(
  ctl: ChatControllerInternals,
  mission: NonNullable<ChatControllerInternals['missionRuntime']>,
  requestId: string,
  action: 'pause' | 'stop-current-feature',
): void {
  if (ctl.missionRuntime !== mission) {
    return;
  }
  mission.setBusyAction(undefined);
  ctl.emit(mission.snapshot());
  emitResult(ctl, requestId, action, 'rejected', 'unavailable');
}

function emitResult(
  ctl: ChatControllerInternals,
  requestId: string,
  action:
    | 'dismiss-setup'
    | 'pause'
    | 'resume'
    | 'stop-current-feature'
    | 'refresh'
    | 'set-disclosure'
    | 'open-viewer',
  status: 'accepted' | 'rejected',
  rejectionCode?: 'busy' | 'stale' | 'unavailable' | 'invalid',
): void {
  ctl.emit({
    type: 'mission.controlResult',
    protocolVersion: 25,
    scope: 'selected-chat',
    requestId,
    action,
    status,
    ...(rejectionCode === undefined ? {} : { rejectionCode }),
  });
}

function toAction(
  type: MissionControlMessage['type'],
):
  | 'dismiss-setup'
  | 'pause'
  | 'resume'
  | 'stop-current-feature'
  | 'refresh' {
  switch (type) {
    case 'mission.dismissSetup':
      return 'dismiss-setup';
    case 'mission.pause':
      return 'pause';
    case 'mission.resume':
      return 'resume';
    case 'mission.stopCurrentFeature':
      return 'stop-current-feature';
    case 'mission.refresh':
      return 'refresh';
  }
}
