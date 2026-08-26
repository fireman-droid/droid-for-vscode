import type { MissionSetupCapabilities } from '../../../shared/missionProtocol';
import type { MissionControlSetupAuthority } from '../../MissionControlPanelController';
import type { ChatController } from '../../ChatController';
import type { ChatControllerInternals } from '../internals';

export function createMissionControlSetupProjection(ctl: ChatController): {
  readonly read: () => MissionControlSetupAuthority;
  readonly subscribe: (listener: () => void) => { dispose(): void };
} {
  let ownerRevision = 0;
  let key = setupAuthorityKey(ctl);
  const read = (): MissionControlSetupAuthority => {
    const nextKey = setupAuthorityKey(ctl);
    if (!sameAuthorityKey(key, nextKey)) {
      key = nextKey;
      ownerRevision += 1;
    }
    return {
      ...readMissionControlSetupAuthority(ctl),
      chatOwnerRevision: ownerRevision,
    };
  };
  return {
    read,
    subscribe: (listener) =>
      ctl.subscribe(() => {
        const previousRevision = ownerRevision;
        read();
        if (ownerRevision !== previousRevision) {
          listener();
        }
      }),
  };
}

export function readMissionControlSetupAuthority(
  ctl: ChatControllerInternals,
): MissionControlSetupAuthority {
  const revisions = {
    workspaceAuthorityRevision: ctl.workspaceContextGeneration,
    chatOwnerRevision: ctl.runtimeGeneration,
  };
  if (ctl.missionGateway === undefined) {
    return unavailable(revisions, 'gateway-unavailable');
  }
  const workspace = ctl.workspaceContext;
  if (workspace.cwd === null || !workspace.trusted) {
    return unavailable(revisions, 'workspace-unavailable');
  }
  if (
    ctl.connection.status !== 'connected' ||
    ctl.runtime === null ||
    ctl.sessionId === null
  ) {
    return unavailable(revisions, 'selected-chat-unavailable');
  }
  const settings = ctl.settings.value;
  if (settings === null) {
    return unavailable(
      revisions,
      ctl.settings.status === 'loading'
        ? 'settings-loading'
        : 'settings-error',
      ctl.settings.status === 'loading' ? 'loading' : 'error',
    );
  }
  const capabilities = ctl.missionGateway.setupCapabilitiesFor(
    workspace.cwd,
    {
      modelId: settings.modelId,
      reasoningEffort: settings.reasoningEffort,
    },
    {
      status: ctl.modelCatalog.status,
      items:
        ctl.modelCatalog.status === 'ready' ? ctl.modelCatalog.items : [],
    },
  );
  if (
    ctl.settingsUpdate !== null ||
    ctl.sessionOperationInProgress ||
    ctl.refreshInProgress ||
    ctl.missionStartInProgress ||
    ctl.turn !== null
  ) {
    return {
      ...revisions,
      availability: 'busy',
      reason: 'chat-busy',
      capabilities,
    };
  }
  if (capabilities.catalogStatus !== 'ready') {
    const status = capabilities.catalogStatus;
    return {
      ...revisions,
      availability: status === 'loading' ? 'loading' : 'error',
      reason:
        status === 'loading'
          ? 'model-catalog-loading'
          : status === 'unsupported'
            ? 'model-catalog-unsupported'
            : 'model-catalog-error',
      capabilities,
    };
  }
  return {
    ...revisions,
    availability: 'ready',
    reason: null,
    capabilities,
  };
}

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

function unavailable(
  revisions: Pick<
    MissionControlSetupAuthority,
    'workspaceAuthorityRevision' | 'chatOwnerRevision'
  >,
  reason: MissionControlSetupAuthority['reason'],
  availability: MissionControlSetupAuthority['availability'] = 'unavailable',
): MissionControlSetupAuthority {
  return {
    ...revisions,
    availability,
    reason,
    capabilities: null,
  };
}

function setupAuthorityKey(ctl: ChatController): readonly unknown[] {
  return [
    ctl.workspaceContextGeneration,
    ctl.runtimeGeneration,
    ctl.connection.status,
    ctl.runtime,
    ctl.sessionId,
    ctl.settings.status,
    ctl.settings.value,
    ctl.modelCatalog,
    ctl.settingsUpdate !== null,
    ctl.sessionOperationInProgress,
    ctl.refreshInProgress,
    ctl.missionStartInProgress,
    ctl.turn !== null,
  ];
}

function sameAuthorityKey(
  left: readonly unknown[],
  right: readonly unknown[],
): boolean {
  return left.every((value, index) => Object.is(value, right[index]));
}
