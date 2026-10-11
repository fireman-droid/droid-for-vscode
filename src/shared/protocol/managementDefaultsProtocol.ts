import { hasExactKeys, isStrictRecord } from '../validation/strictValidation';
import { SESSION_AUTONOMY_LEVELS, SESSION_INTERACTION_MODES, SESSION_REASONING_EFFORTS } from './bounds';

type Validator = (value: unknown) => boolean;
const text: Validator = v => typeof v === 'string' && v.trim().length > 0 && v.length <= 2048 && !/[\u0000-\u001f\u007f]/.test(v);
const tokens: Validator = v => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
const boolean: Validator = v => typeof v === 'boolean';
const oneOf = (values: readonly unknown[]): Validator => v => values.includes(v);
const nullable = (validator: Validator): Validator => v => v === null || validator(v);
const reasoning = oneOf(SESSION_REASONING_EFFORTS);
const validators = {
  modelId: text, reasoningEffort: reasoning,
  interactionMode: oneOf(SESSION_INTERACTION_MODES), autonomyLevel: oneOf(SESSION_AUTONOMY_LEVELS),
  specModeModelId: nullable(text), specModeReasoningEffort: nullable(reasoning), specSaveDir: nullable(text),
  compactionTokenLimit: tokens,
  compactionTokenLimitPerModel: (v: unknown) => isStrictRecord(v) && Object.entries(v).every(([key, count]) => text(key) && tokens(count)),
  compactionModel: text, compactionThresholdCheckEnabled: boolean,
  subagentAutonomyLevel: nullable(oneOf([...SESSION_AUTONOMY_LEVELS, 'inherit'])),
  'subagentModelSettings.lightModel': text, 'subagentModelSettings.lightReasoningEffort': reasoning,
  'subagentModelSettings.mediumModel': text, 'subagentModelSettings.mediumReasoningEffort': reasoning,
  'subagentModelSettings.heavyModel': text, 'subagentModelSettings.heavyReasoningEffort': reasoning,
  missionOrchestratorModel: nullable(text), missionOrchestratorReasoningEffort: nullable(reasoning),
  'missionModelSettings.workerModel': text, 'missionModelSettings.workerReasoningEffort': reasoning,
  'missionModelSettings.validationWorkerModel': text, 'missionModelSettings.validationWorkerReasoningEffort': reasoning,
  'missionModelSettings.skipScrutiny': boolean, 'missionModelSettings.skipUserTesting': boolean,
} satisfies Record<string, Validator>;

export type DefaultsScope = 'sessions' | 'missions';
export type DefaultField = keyof typeof validators;
export type DefaultValue = string | number | boolean | null | Record<string, number>;
export type DefaultValues = Partial<Record<DefaultField, DefaultValue>>;
export const DEFAULT_FIELDS = Object.keys(validators) as DefaultField[];
export function defaultsScope(field: DefaultField): DefaultsScope { return field.startsWith('mission') ? 'missions' : 'sessions'; }
export function isDefaultValues(v: unknown): v is DefaultValues {
  return isStrictRecord(v) && hasExactKeys(v, [], DEFAULT_FIELDS)
    && Object.entries(v).every(([key, value]) => validators[key as DefaultField](value));
}
export function isDefaultsPatch(v: unknown, scope: unknown): v is DefaultValues {
  return (scope === 'sessions' || scope === 'missions') && isDefaultValues(v) && Object.keys(v).length > 0
    && Object.keys(v).every(key => defaultsScope(key as DefaultField) === scope);
}
export interface DefaultsModel {
  readonly id: string;
  readonly label: string;
  readonly reasoning: readonly string[];
  readonly defaultReasoning: string;
  readonly disabledReason?: string;
}
export interface ManagementDefaults {
  readonly values: DefaultValues;
  readonly models: readonly DefaultsModel[];
  readonly locked: Partial<Record<DefaultField, string>>;
  readonly autonomyLevels?: readonly string[];
  readonly specDirectories: readonly { readonly label: string; readonly value: string }[];
}
export function isManagementDefaults(v: unknown): v is ManagementDefaults {
  return isStrictRecord(v) && isDefaultValues(v.values) && isStrictRecord(v.locked)
    && Object.entries(v.locked).every(([key, value]) => DEFAULT_FIELDS.includes(key as DefaultField) && typeof value === 'string')
    && (v.autonomyLevels === undefined || Array.isArray(v.autonomyLevels) && v.autonomyLevels.every(oneOf(SESSION_AUTONOMY_LEVELS)))
    && Array.isArray(v.specDirectories) && v.specDirectories.every(d => isStrictRecord(d) && text(d.label) && text(d.value))
    && Array.isArray(v.models) && v.models.every(m => isStrictRecord(m) && text(m.id) && text(m.label)
      && Array.isArray(m.reasoning) && m.reasoning.every(reasoning) && reasoning(m.defaultReasoning)
      && (m.disabledReason === undefined || typeof m.disabledReason === 'string'));
}
