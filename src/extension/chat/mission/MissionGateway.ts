import type { DaemonApi, DaemonSessionHandle } from '../../../runtime/daemon/api';

import type { DroidRuntime } from '../../../runtime/DroidRuntime';
import {
  createRuntimeInteractionCallbacks,
  type RuntimeInteractionCallbacks,
  type RuntimeInteractionHandler,
} from '../../../runtime/events/runtimeInteractions';
import {
  createMissionOrchestrator,
  createMissionOrchestratorIdentity,
} from '../../../runtime/daemon/missionOrchestrator';
import type {
  MissionReasoningEffort,
  MissionSetupCapabilities,
  MissionStartMessage,
} from '../../../shared/protocol/missionProtocol';
import type { MissionReadinessWarning } from '../../../shared/protocol/missionControlSetupProtocol';
import { resolveMissionProfile } from '../../../shared/protocol/missionProtocol';
import {
  listMissionCatalog,
  type MissionCatalogProjectionOptions,
  type MissionCatalogResult,
  type MissionCatalogTarget,
} from './MissionCatalogProjection';
import {
  validatePair,
  validatePreferences,
  type MissionCatalogModel,
  type MissionPreferenceStore,
  type MissionProfilePair,
  type MissionWorkspacePreferences,
} from './MissionPreferences';

export interface MissionGatewayRuntime {
  readonly runtime: DroidRuntime;
  initialize(): Promise<void>;
}

export interface MissionRuntimeInteractions {
  readonly handler: RuntimeInteractionHandler;
  readonly callbacks: RuntimeInteractionCallbacks;
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
      activateInteractions(): void;
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
  readonly getSystemPrompt?: () => import('../../../shared/protocol/systemPromptProtocol').SessionSystemPrompt | undefined;
  readonly getDroid: () => Promise<DaemonApi>;
  readonly preferences: MissionPreferenceStore;
  readonly prepareInteractions: () => {
    readonly handler: RuntimeInteractionHandler;
    activate(): void;
  };
  readonly createRuntime: (
    session: DaemonSessionHandle,
    droid: DaemonApi,
    orchestrator: MissionProfilePair,
    interactions: MissionRuntimeInteractions,
  ) => MissionGatewayRuntime;
  readonly openWorkerViewer?: (target: {
    readonly sessionId: string;
    readonly title: string;
  }) => void;
}

export type { MissionCatalogResult } from './MissionCatalogProjection';

export type MissionReadinessResult =
  | {
      readonly status: 'ready';
      readonly warning: {
        readonly state: MissionReadinessWarning;
        readonly level: number | null;
      } | null;
    }
  | { readonly status: 'error' };

/**
 * Extension-Host Mission entry boundary. It validates every effective model
 * pair before creating a session, then applies and verifies the six-property
 * SDK settings object while retaining the original attached handle.
 */
export class MissionGateway {
  private catalogTargets = new Map<string, MissionCatalogTarget>();

  constructor(private readonly options: MissionGatewayOptions) {}

  async listCatalog(): Promise<MissionCatalogResult> {
    const targets = new Map<string, MissionCatalogTarget>();
    const result = await listMissionCatalog({
      ...this.options,
      rememberCatalogTarget: (catalogId, target) => {
        targets.set(catalogId, target);
      },
    });
    if (result.status === 'ready') {
      this.catalogTargets = targets;
    }
    return result;
  }

  targetForCatalogId(catalogId: string): MissionCatalogTarget | null {
    return this.catalogTargets.get(catalogId) ?? null;
  }

  async inspectReadiness(cwd: string): Promise<MissionReadinessResult> {
    try {
      const droid = await this.options.getDroid();
      const result = await droid.unstable.missions.inspectReadiness(cwd);
      const warning = result.warning;
      if (warning === undefined || warning.state === 'ok') {
        return { status: 'ready', warning: null };
      }
      return {
        status: 'ready',
        warning: {
          state: warning.state,
          level: typeof warning.level === 'number' ? warning.level : null,
        },
      };
    } catch {
      return { status: 'error' };
    }
  }

  async acknowledgeReadinessWarning(cwd: string): Promise<boolean> {
    try {
      const droid = await this.options.getDroid();
      await droid.unstable.missions.acknowledgeReadinessWarning(cwd);
      return true;
    } catch {
      return false;
    }
  }

  async start(input: MissionGatewayStart): Promise<MissionGatewayResult> {
    const requestedPreferences: MissionWorkspacePreferences = {
      worker: resolveMissionProfile(input.message.worker, input.message.orchestrator),
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

    let droid: DaemonApi;
    try {
      droid = await this.options.getDroid();
    } catch {
      return { status: 'rejected', code: 'daemon-unavailable' };
    }
    const settings = toMissionSettings(effective.value);
    let session: DaemonSessionHandle | undefined;
    let adopted = false;
    try {
      // Bind before attachment, but keep the previous chat's interaction owner
      // until the controller has successfully adopted this Mission runtime.
      const owner = this.options.prepareInteractions();
      const interactions = {
        handler: owner.handler,
        callbacks: createRuntimeInteractionCallbacks(owner.handler),
      };
      session = await createMissionOrchestrator({
        droid,
        cwd: input.cwd,
        systemPrompt: this.options.getSystemPrompt?.(),
        modelId: input.message.orchestrator.modelId,
        reasoningEffort: input.message.orchestrator
          .reasoningEffort as MissionReasoningEffort,
        missionId: createMissionOrchestratorIdentity(),
        callbacks: interactions.callbacks,
      });
      // Bridge reasoning values are catalog-validated. The SDK's public
      // daemon facade narrows this enum more than its actual 0.7.0 Mission
      // settings schema, so retain the exact verified six-property object.
      await droid.sessions.updateSettings(session.id, {
        missionSettings: settings as never,
      });
      if (!(await hasDurableMissionSettings(session, settings))) {
        return { status: 'rejected', code: 'settings-mismatch' };
      }

      const runtime = this.options.createRuntime(
        session,
        droid,
        input.message.orchestrator,
        interactions,
      );
      await runtime.initialize();
      await this.options.preferences.save(input.workspaceId, effective.value);
      adopted = true;
      return {
        status: 'ready',
        sessionId: session.id,
        runtime,
        settings,
        activateInteractions: owner.activate,
      };
    } catch {
      return { status: 'rejected', code: 'daemon-unavailable' };
    } finally {
      if (session !== undefined && !adopted) {
        await session.detach().catch(() => undefined);
      }
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
      await droid.sessions.killWorker(orchestratorSessionId, workerSessionId);
      return true;
    } catch {
      return false;
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

function toMissionSettings(preferences: MissionWorkspacePreferences): MissionSettings {
  return {
    workerModel: preferences.worker.modelId,
    workerReasoningEffort: preferences.worker.reasoningEffort,
    validationWorkerModel: preferences.validator.modelId,
    validationWorkerReasoningEffort: preferences.validator.reasoningEffort,
    skipScrutiny: !preferences.scrutinyEnabled,
    skipUserTesting: !preferences.userTestingEnabled,
  };
}

function sameMissionSettings(actual: unknown, expected: MissionSettings): boolean {
  if (actual === null || typeof actual !== 'object' || Array.isArray(actual)) {
    return false;
  }
  const value = actual as Partial<MissionSettings>;
  return (
    value.workerModel === expected.workerModel &&
    value.workerReasoningEffort === expected.workerReasoningEffort &&
    value.validationWorkerModel === expected.validationWorkerModel &&
    value.validationWorkerReasoningEffort === expected.validationWorkerReasoningEffort &&
    value.skipScrutiny === expected.skipScrutiny &&
    value.skipUserTesting === expected.skipUserTesting
  );
}

async function hasDurableMissionSettings(
  session: DaemonSessionHandle,
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
