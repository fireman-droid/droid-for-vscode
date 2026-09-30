import { AutonomyLevel, DroidInteractionMode, ReasoningEffort } from '@factory/droid-sdk';
import type { DaemonApi } from './api';
import { hasExactKeys, isStrictRecord } from '../../shared/validation/strictValidation';

export type DefaultSettingsPatch = Parameters<DaemonApi['settings']['updateDefaults']>[0];

type Validator = (value: unknown) => boolean;
const text: Validator = (value) => typeof value === 'string' && value.trim().length > 0 && value.length <= 2048 && !/[\u0000-\u001f\u007f]/.test(value);
const boolean: Validator = (value) => typeof value === 'boolean';
const tokens: Validator = (value) => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const oneOf = (values: readonly unknown[]): Validator => (value) => values.includes(value);
const nullable = (validate: Validator): Validator => (value) => value === null || validate(value);
const reasoning = oneOf(Object.values(ReasoningEffort));
const fields = (validators: Readonly<Record<string, Validator>>): Validator => (value) =>
  isStrictRecord(value) && hasExactKeys(value, [], Object.keys(validators)) &&
  Object.entries(value).every(([key, field]) => validators[key](field));
const validators: Record<keyof DefaultSettingsPatch, Validator> = {
  modelId: text, reasoningEffort: reasoning,
  interactionMode: oneOf(Object.values(DroidInteractionMode)),
  autonomyLevel: oneOf(Object.values(AutonomyLevel)),
  specModeModelId: nullable(text), specModeReasoningEffort: nullable(reasoning),
  compactionTokenLimit: tokens,
  compactionTokenLimitPerModel: (value) => isStrictRecord(value) && Object.entries(value).every(([key, count]) => text(key) && tokens(count)),
  compactionModel: text, compactionThresholdCheckEnabled: boolean,
  enableOneHourAnthropicCaching: boolean,
  compactionModelMode: oneOf(['current-model', 'factory-default']), cloudSessionSync: boolean,
  subagentModelSettings: fields({
    lightModel: text, lightReasoningEffort: reasoning,
    mediumModel: text, mediumReasoningEffort: reasoning,
    heavyModel: text, heavyReasoningEffort: reasoning,
  }),
  subagentInheritTiers: (value) => Array.isArray(value) && value.length <= 3 &&
    value.every(oneOf(['light', 'medium', 'heavy'])) && new Set(value).size === value.length,
  subagentAutonomyLevel: nullable(oneOf(['off', 'low', 'medium', 'high', 'inherit'])),
  specSaveDir: nullable(text), missionOrchestratorModel: nullable(text),
  missionOrchestratorReasoningEffort: nullable(reasoning),
  missionModelSettings: fields({
    workerModel: text, workerReasoningEffort: reasoning,
    validationWorkerModel: text, validationWorkerReasoningEffort: reasoning,
    skipScrutiny: boolean, skipUserTesting: boolean,
  }),
  runInWorktree: nullable(boolean), worktreeDirectory: nullable(text),
  worktreeAutoDeleteLimit: nullable((value) => typeof value === 'number' && Number.isInteger(value) && value >= 1),
};

/** Validate the exposed public defaults fields, never accept a full settings file. */
export function parseDefaultSettingsPatch(input: unknown): DefaultSettingsPatch | null {
  return isStrictRecord(input) && Object.keys(input).length > 0 && fields(validators)(input)
    ? input as DefaultSettingsPatch : null;
}
