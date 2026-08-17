import type { MissionSetupCapabilities } from '../../../shared/missionProtocol';
import type { ChatControllerInternals } from '../internals';

export function emitMissionSetupCapabilities(
  ctl: ChatControllerInternals,
): void {
  const workspace = ctl.getWorkspaceContext();
  const settings = ctl.settings.value;
  if (
    ctl.missionGateway === undefined ||
    workspace.cwd === null ||
    !workspace.trusted ||
    settings === null
  ) {
    return;
  }
  const catalog: {
    readonly status: MissionSetupCapabilities['catalogStatus'];
    readonly items: MissionSetupCapabilities['catalog'];
  } =
    ctl.modelCatalog.status === 'ready'
      ? {
          status: 'ready',
          items: ctl.modelCatalog.items,
        }
      : {
          status: ctl.modelCatalog.status,
          items: [],
        };
  const setup = ctl.missionGateway.setupCapabilitiesFor(
    workspace.cwd,
    {
      modelId: settings.modelId,
      reasoningEffort: settings.reasoningEffort,
    },
    catalog,
  );
  ctl.emit({
    type: 'mission.snapshot',
    protocolVersion: 25,
    scope: 'selected-chat',
    revision: 0,
    availability:
      ctl.connection.status === 'connected' && ctl.runtime !== null
        ? 'attached'
        : 'detached',
    features: [],
    completedFeatureCount: 0,
    controls: {
      canPause: false,
      canResume: false,
      canStopCurrentFeature: false,
    },
    validator: {
      scrutinyEnabled: setup.preferences.scrutinyEnabled,
      userTestingEnabled: setup.preferences.userTestingEnabled,
    },
    setup,
  });
}
