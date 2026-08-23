import type {
  ConnectedDroid,
  ConnectedDroidSession,
} from '@factory/droid-sdk';

import type { DroidRuntime } from '../../../runtime/DroidRuntime';
import {
  createMissionOrchestrator,
  createMissionOrchestratorIdentity,
} from '../../../runtime/daemon/missionOrchestrator';
import type {
  MissionReasoningEffort,
  MissionSetupCapabilities,
  MissionStartMessage,
} from '../../../shared/missionProtocol';
import { resolveMissionProfile } from '../../../shared/missionProtocol';
import {
  listMissionCatalog,
  type MissionCatalogProjectionOptions,
  type MissionCatalogResult,
} from './MissionCatalogProjection';
import {
  validatePair,
  validatePreferences,
  type MissionCatalogModel,
  type MissionPreferenceStore,
  type MissionProfilePair,
  type MissionWorkspacePreferences,
} from './MissionPreferences';
import {
  MissionSnapshotReducer,
  type MissionValidatorState,
} from './MissionSnapshotReducer';

export interface MissionGatewayRuntime {
  readonly runtime: DroidRuntime;
  initialize(): Promise<void>;
}

export interface MissionGatewayStart {
  readonly workspaceId: string;
  readonly cwd: string;
  readonly message: MissionStartMessage;
  readonly catalog: readonly MissionCatalogModel[];
}

export type MissionGatewayResult =
  | {
      readonly status: 'ready';
      readonly sessionId: string;
      readonly runtime: MissionGatewayRuntime;
      readonly settings: MissionSettings;
    }
  | {
      readonly status: 'rejected';
      readonly code:
        | 'unavailable-model'
        | 'unsupported-reasoning'
        | 'settings-mismatch'
        | 'daemon-unavailable';
    };

export interface MissionGatewayOptions extends MissionCatalogProjectionOptions {
  readonly getDroid: () => Promise<ConnectedDroid>;
  readonly preferences: MissionPreferenceStore;
  readonly createRuntime: (
    session: ConnectedDroidSession,
    droid: ConnectedDroid,
    orchestrator: MissionProfilePair,
  ) => MissionGatewayRuntime;
  readonly openWorkerViewer?: (target: {
    readonly sessionId: string;
    readonly title: string;
  }) => void;
}

export type { MissionCatalogResult } from './MissionCatalogProjection';

/**
 * Extension-Host Mission entry boundary. It validates every effective model
 * pair before creating a session, then applies and verifies the six-property
 * SDK settings object while retaining the original attached handle.
 */
export class MissionGateway {
  constructor(private readonly options: MissionGatewayOptions) {}

  async listCatalog(): Promise<MissionCatalogResult> {
    return listMissionCatalog(this.options);
  }

  async start(input: MissionGatewayStart): Promise<MissionGatewayResult> {
    const requestedPreferences: MissionWorkspacePreferences = {
      worker: resolveMissionProfile(
        input.message.worker,
        input.message.orchestrator,
      ),
      validator: resolveMissionProfile(
        input.message.validator,
        input.message.orchestrator,
      ),
      scrutinyEnabled: input.message.scrutinyEnabled,
      userTestingEnabled: input.message.userTestingEnabled,
    };
    const effective = validateStart(
      input.message.orchestrator,
      requestedPreferences,
      input.catalog,
    );
    if (effective.valid === false) {
      return { status: 'rejected', code: effective.reason };
    }

    let droid: ConnectedDroid;
    try {
      droid = await this.options.getDroid();
    } catch {
      return { status: 'rejected', code: 'daemon-unavailable' };
    }
    const settings = toMissionSettings(effective.value);
    let session: ConnectedDroidSession;
    try {
      session = await createMissionOrchestrator({
        droid,
        cwd: input.cwd,
        modelId: input.message.orchestrator.modelId,
        reasoningEffort: input.message.orchestrator
          .reasoningEffort as MissionReasoningEffort,
        missionId: createMissionOrchestratorIdentity(),
      });
      // Bridge reasoning values are catalog-validated. The SDK's public
      // daemon facade narrows this enum more than its actual 0.7.0 Mission
      // settings schema, so retain the exact verified six-property object.
      await droid.sessions.updateSettings(session.id, {
        missionSettings: settings as never,
      });
    } catch {
      return { status: 'rejected', code: 'daemon-unavailable' };
    }

    if (!(await hasDurableMissionSettings(session, settings))) {
      await session.detach().catch(() => undefined);
      return { status: 'rejected', code: 'settings-mismatch' };
    }

    try {
      const runtime = this.options.createRuntime(
        session,
        droid,
        input.message.orchestrator,
      );
      await runtime.initialize();
      await this.options.preferences.save(input.workspaceId, effective.value);
      return { status: 'ready', sessionId: session.id, runtime, settings };
    } catch {
      await session.detach().catch(() => undefined);
      return { status: 'rejected', code: 'daemon-unavailable' };
    }
  }

  preferencesFor(
    workspaceId: string,
    orchestrator: MissionProfilePair,
    catalog: readonly MissionCatalogModel[],
  ) {
    return this.options.preferences.validate(workspaceId, orchestrator, catalog);
  }

  setupCapabilitiesFor(
    workspaceId: string,
    orchestrator: MissionProfilePair,
    catalog: {
      readonly status: MissionSetupCapabilities['catalogStatus'];
      readonly items: MissionSetupCapabilities['catalog'];
    },
  ): MissionSetupCapabilities {
    return {
      currentChat: orchestrator,
      catalogStatus: catalog.status,
      catalog: catalog.status === 'ready' ? catalog.items : [],
      preferences: this.options.preferences.read(workspaceId, orchestrator),
    };
  }

  async killWorker(
    orchestratorSessionId: string,
    workerSessionId: string,
  ): Promise<boolean> {
    try {
      const droid = await this.options.getDroid();
      await droid.sessions.killWorker(
        orchestratorSessionId,
        workerSessionId,
      );
      return true;
    } catch {
      return false;
    }
  }

  async recover(
    sessionId: string,
    validator: MissionValidatorState,
  ): Promise<MissionSnapshotReducer | null> {
    try {
      const droid = await this.options.getDroid();
      const rows = await droid.sessions.list({ limit: 100 });
      const mission = rows.find((row) => row.id === sessionId)?.mission;
      const reducer = new MissionSnapshotReducer(validator);
      return reducer.hydrate(mission) ? reducer : null;
    } catch {
      return null;
    }
  }

  openWorkerViewer(target: { sessionId: string; title: string }): boolean {
    if (this.options.openWorkerViewer === undefined) {
      return false;
    }
    this.options.openWorkerViewer(target);
    return true;
  }

}

export interface MissionSettings {
  readonly workerModel: string;
  readonly workerReasoningEffort: MissionReasoningEffort;
  readonly validationWorkerModel: string;
  readonly validationWorkerReasoningEffort: MissionReasoningEffort;
  readonly skipScrutiny: boolean;
  readonly skipUserTesting: boolean;
}

function validateStart(
  orchestrator: MissionProfilePair,
  preferences: MissionWorkspacePreferences,
  catalog: readonly MissionCatalogModel[],
):
  | { readonly valid: true; readonly value: MissionWorkspacePreferences }
  | {
      readonly valid: false;
      readonly reason: 'unavailable-model' | 'unsupported-reasoning';
    } {
  const orchestratorFailure = validatePair(orchestrator, catalog);
  if (orchestratorFailure !== undefined) {
    return orchestratorFailure;
  }
  return validatePreferences(preferences, catalog);
}

function toMissionSettings(
  preferences: MissionWorkspacePreferences,
): MissionSettings {
  return {
    workerModel: preferences.worker.modelId,
    workerReasoningEffort: preferences.worker.reasoningEffort,
    validationWorkerModel: preferences.validator.modelId,
    validationWorkerReasoningEffort: preferences.validator.reasoningEffort,
    skipScrutiny: !preferences.scrutinyEnabled,
    skipUserTesting: !preferences.userTestingEnabled,
  };
}

function sameMissionSettings(
  actual: unknown,
  expected: MissionSettings,
): boolean {
  if (actual === null || typeof actual !== 'object' || Array.isArray(actual)) {
    return false;
  }
  const value = actual as Partial<MissionSettings>;
  return (
    value.workerModel === expected.workerModel &&
    value.workerReasoningEffort === expected.workerReasoningEffort &&
    value.validationWorkerModel === expected.validationWorkerModel &&
    value.validationWorkerReasoningEffort ===
      expected.validationWorkerReasoningEffort &&
    value.skipScrutiny === expected.skipScrutiny &&
    value.skipUserTesting === expected.skipUserTesting
  );
}

async function hasDurableMissionSettings(
  session: ConnectedDroidSession,
  expected: MissionSettings,
): Promise<boolean> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (sameMissionSettings(session.settings.missionSettings, expected)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return false;
}