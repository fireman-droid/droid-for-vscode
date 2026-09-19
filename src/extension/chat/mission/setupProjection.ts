import type { MissionSetupCapabilities } from '../../../shared/protocol/missionProtocol';
import type { MissionControlSetupAuthority } from '../../panels/mission/MissionControlPanelController';
import type { SetupProjectionPort } from './setupProjectionMissionPort';

export function createMissionControlSetupProjection(ctl: SetupProjectionPort): {
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
  ctl: SetupProjectionPort,
): MissionControlSetupAuthority {
  const revisions = {
    workspaceAuthorityRevision: ctl.sessionState.workspaceContextGeneration,
    chatOwnerRevision: ctl.sessionState.runtimeGeneration,
  };
  if (ctl.missionGateway === undefined) {
    return unavailable(revisions, 'gateway-unavailable');
  }
  const workspace = ctl.sessionState.workspaceContext;
  if (workspace.cwd === null || !workspace.trusted) {
    return unavailable(revisions, 'workspace-unavailable');
  }
  if (
    ctl.sessionState.connection.status !== 'connected' ||
    ctl.sessionState.runtime === null ||
    ctl.sessionState.sessionId === null
  ) {
    return unavailable(revisions, 'selected-chat-unavailable');
  }
  const settings = ctl.metadata.settings.value;
  if (settings === null) {
    return unavailable(
      revisions,
      ctl.metadata.settings.status === 'loading' ? 'settings-loading' : 'settings-error',
      ctl.metadata.settings.status === 'loading' ? 'loading' : 'error',
    );
  }
  const capabilities = ctl.missionGateway.setupCapabilitiesFor(
    workspace.cwd,
    {
      modelId: settings.modelId,
      reasoningEffort: settings.reasoningEffort,
    },
    {
      status: ctl.metadata.modelCatalog.status,
      items:
        ctl.metadata.modelCatalog.status === 'ready'
          ? ctl.metadata.modelCatalog.items
          : [],
    },
  );
  if (
    ctl.metadata.settingsUpdate !== null ||
    ctl.sessionState.sessionOperationInProgress ||
    ctl.catalogState.refreshInProgress ||
    ctl.missionState.missionStartInProgress ||
    ctl.turnState.turn !== null
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

export function emitMissionSetupCapabilities(ctl: SetupProjectionPort): void {
  const workspace = ctl.getWorkspaceContext();
  const settings = ctl.metadata.settings.value;
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
    ctl.metadata.modelCatalog.status === 'ready'
      ? {
          status: 'ready',
          items: ctl.metadata.modelCatalog.items,
        }
      : {
          status: ctl.metadata.modelCatalog.status,
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
      ctl.sessionState.connection.status === 'connected' &&
      ctl.sessionState.runtime !== null
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

function setupAuthorityKey(ctl: SetupProjectionPort): readonly unknown[] {
  return [
    ctl.sessionState.workspaceContextGeneration,
    ctl.sessionState.runtimeGeneration,
    ctl.sessionState.connection.status,
    ctl.sessionState.runtime,
    ctl.sessionState.sessionId,
    ctl.metadata.settings.status,
    ctl.metadata.settings.value,
    ctl.metadata.modelCatalog,
    ctl.metadata.settingsUpdate !== null,
    ctl.sessionState.sessionOperationInProgress,
    ctl.catalogState.refreshInProgress,
    ctl.missionState.missionStartInProgress,
    ctl.turnState.turn !== null,
  ];
}

function sameAuthorityKey(left: readonly unknown[], right: readonly unknown[]): boolean {
  return left.every((value, index) => Object.is(value, right[index]));
}
