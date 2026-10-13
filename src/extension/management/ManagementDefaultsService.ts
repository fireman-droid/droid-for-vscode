import type { DaemonApi } from '../../runtime/daemon/api';
import { parseDefaultSettingsPatch } from '../../runtime/daemon/defaultSettings';
import { DEFAULT_FIELDS, type DefaultField, type DefaultValues, type ManagementDefaults } from '../../shared/protocol/managementDefaultsProtocol';
import { isStrictRecord } from '../../shared/validation/strictValidation';
import type { ModelAvailability } from '../models/DisabledModelsStore';

type Defaults = Awaited<ReturnType<DaemonApi['settings']['getDefaults']>>;
const modelPairs = [
  ['modelId', 'reasoningEffort'], ['specModeModelId', 'specModeReasoningEffort'],
  ['missionOrchestratorModel', 'missionOrchestratorReasoningEffort'],
  ['subagentModelSettings.lightModel', 'subagentModelSettings.lightReasoningEffort'],
  ['subagentModelSettings.mediumModel', 'subagentModelSettings.mediumReasoningEffort'],
  ['subagentModelSettings.heavyModel', 'subagentModelSettings.heavyReasoningEffort'],
  ['missionModelSettings.workerModel', 'missionModelSettings.workerReasoningEffort'],
  ['missionModelSettings.validationWorkerModel', 'missionModelSettings.validationWorkerReasoningEffort'],
] as const;

/** Maps the SDK's read, write and policy names at the Host boundary. */
export class ManagementDefaultsService {
  constructor(private readonly getDroid: () => Promise<DaemonApi>, private readonly daemon: boolean,
    private readonly availability?: ModelAvailability) {}

  private async api(): Promise<DaemonApi> {
    if (!this.daemon) throw new Error('默认设置需要 daemon 运行模式。');
    return this.getDroid();
  }
  async read(): Promise<ManagementDefaults> {
    return this.project(await (await this.api()).settings.getDefaults());
  }
  async save(values: DefaultValues): Promise<ManagementDefaults> {
    const api = await this.api();
    const fresh = await this.project(await api.settings.getDefaults());
    const patch: Record<string, unknown> = {};
    for (const field of Object.keys(values) as DefaultField[]) {
      if (fresh.locked[field]) throw new Error(fresh.locked[field]);
      const [parent, child] = field.split('.');
      if (child) { const nested = (patch[parent] ??= {}) as Record<string, unknown>; nested[child] = values[field]; }
      else patch[parent] = values[field];
    }
    const previousLimits = fresh.values.compactionTokenLimitPerModel;
    const changedLimits = isStrictRecord(values.compactionTokenLimitPerModel)
      ? Object.entries(values.compactionTokenLimitPerModel).filter(([id, count]) => !isStrictRecord(previousLimits) || previousLimits[id] !== count).map(([id]) => id) : [];
    const modelIds = [...modelPairs.map(([model]) => values[model]), values.compactionModel, ...changedLimits];
    for (const id of new Set(modelIds)) {
      if (typeof id !== 'string' || id === 'current-model') continue;
      const model = fresh.models.find(m => m.id === id);
      if (!model || model.disabledReason) throw new Error(model?.disabledReason || `模型 ${id} 已不可用，请刷新后重新选择。`);
      await this.availability?.assertEnabled(id);
    }
    for (const [modelKey, effortKey] of modelPairs) {
      if (!(effortKey in values) && !(modelKey in values)) continue;
      const id = values[modelKey] === undefined ? fresh.values[modelKey] : values[modelKey];
      const effort = values[effortKey] === undefined ? fresh.values[effortKey] : values[effortKey];
      if (typeof id !== 'string' || typeof effort !== 'string') continue;
      const model = fresh.models.find(m => m.id === id);
      if (model?.disabledReason) throw new Error(model.disabledReason);
      if (!model || !(model.reasoning.length ? model.reasoning.includes(effort) : model.defaultReasoning === effort))
        throw new Error(`所选模型不支持推理强度 ${effort}，请重新选择。`);
    }
    for (const level of [values.autonomyLevel, values.subagentAutonomyLevel]) {
      if (typeof level === 'string' && level !== 'inherit' && !fresh.autonomyLevels?.includes(level))
        throw new Error('当前策略未提供此自主等级，请刷新后选择。');
    }
    const parsed = parseDefaultSettingsPatch(patch);
    if (!parsed) throw new Error('默认设置格式无效，请检查输入。');
    const result = await api.settings.updateDefaults(parsed);
    if (!result.success) throw new Error('Droid 未确认保存，请重试。');
    // Render the authoritative defaults returned with the successful write.
    try { return await this.project(result.defaults); }
    catch { throw new Error('设置已保存，但读取保存结果失败。请刷新默认设置。'); }
  }
  private async project(defaults: Defaults): Promise<ManagementDefaults> {
    const values: DefaultValues = {};
    const locked: ManagementDefaults['locked'] = {};
    const source: Record<string, unknown> = { ...defaults, missionModelSettings: defaults.missionSettings,
      interactionMode: defaults.interactionMode === 'agi' ? 'mission' : defaults.interactionMode };
    const policies: Record<string, unknown> = {
      ...defaults.management, subagentModelSettings: defaults.management?.subagent,
      missionModelSettings: defaults.management?.mission,
      missionOrchestratorModel: defaults.management?.mission?.orchestratorModel,
      missionOrchestratorReasoningEffort: defaults.management?.mission?.orchestratorReasoningEffort,
    };
    for (const field of DEFAULT_FIELDS) {
      const [parent, child] = field.split('.');
      const value = child && isStrictRecord(source[parent]) ? source[parent][child] : source[parent];
      if (value !== undefined) values[field] = value as DefaultValues[DefaultField];
      const policy = child && isStrictRecord(policies[parent]) ? policies[parent][child] : policies[parent];
      if (isStrictRecord(policy) && policy.disabled) locked[field] = '此设置由组织或项目策略管理。';
    }
    const catalog = await this.availability?.projectCatalog(defaults.availableModels ?? []) ?? defaults.availableModels ?? [];
    return {
      values, locked, autonomyLevels: defaults.availableAutonomyLevels,
      models: catalog.map(m => ({ id: m.id, label: m.displayName, reasoning: m.supportedReasoningEfforts,
        defaultReasoning: m.defaultReasoningEffort, isCustom: m.isCustom, ...(m.disabledReason ? { disabledReason: m.disabledReason } : {}) })),
      specDirectories: defaults.specSavePresets ? [
        { label: '用户目录', value: defaults.specSavePresets.userFactoryDir },
        ...(defaults.specSavePresets.projectFactoryDir ? [{ label: '项目目录', value: defaults.specSavePresets.projectFactoryDir }] : []),
      ] : [],
    };
  }
}
