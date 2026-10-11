import type { DaemonApi } from '../../../runtime/daemon/api';
import type { MissionControlSetupDraft } from '../../../shared/protocol/missionControlSetupProtocol';
import type { MissionProfile, MissionSetupCapabilities } from '../../../shared/protocol/missionProtocol';

type Defaults = Awaited<ReturnType<DaemonApi['settings']['getDefaults']>>;
export type MissionCreationDefaults = Pick<Defaults, 'missionOrchestratorModel' | 'missionOrchestratorReasoningEffort' | 'missionSettings'>;

export function createSetupDraft(capabilities: MissionSetupCapabilities | null, task: string,
  defaults?: MissionCreationDefaults): MissionControlSetupDraft {
  const settings = defaults?.missionSettings;
  if (!capabilities) return { task, orchestrator: null, worker: null, validator: null,
    scrutinyEnabled: settings?.skipScrutiny !== true, userTestingEnabled: settings?.skipUserTesting !== true };
  const pair = (modelId: string | undefined, reasoningEffort: string | undefined,
    fallback: Omit<MissionProfile, 'mode'>): Omit<MissionProfile, 'mode'> => ({
    modelId: modelId ?? fallback.modelId,
    reasoningEffort: (reasoningEffort ?? (modelId ? capabilities.catalog.find(m => m.id === modelId)?.defaultReasoningEffort : undefined)
      ?? fallback.reasoningEffort) as MissionProfile['reasoningEffort'],
  });
  const orchestrator = pair(defaults?.missionOrchestratorModel, defaults?.missionOrchestratorReasoningEffort, capabilities.currentChat);
  const profile = (model: string | undefined, effort: string | undefined, fallback: MissionProfile): MissionProfile => {
    if (model || effort) return { mode: 'override', ...pair(model, effort, orchestrator) };
    return fallback.mode === 'same-as-orchestrator' ? { mode: fallback.mode, ...orchestrator } : fallback;
  };
  return {
    task, orchestrator,
    worker: profile(settings?.workerModel, settings?.workerReasoningEffort, capabilities.preferences.worker),
    validator: profile(settings?.validationWorkerModel, settings?.validationWorkerReasoningEffort, capabilities.preferences.validator),
    scrutinyEnabled: settings?.skipScrutiny === undefined ? capabilities.preferences.scrutinyEnabled : !settings.skipScrutiny,
    userTestingEnabled: settings?.skipUserTesting === undefined ? capabilities.preferences.userTestingEnabled : !settings.skipUserTesting,
  };
}
