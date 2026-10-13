import * as vscode from 'vscode';
import { SESSION_REASONING_EFFORTS } from '../../shared/protocol/bounds';
import type { SessionReasoningEffort, ModelCatalogItem, ConfirmedSessionSettings } from '../../shared/protocol/settings';
import { ModelAvailabilityError } from '../models/DisabledModelsStore';

export const REVIEW_QUESTION_MODEL_SETTING = 'reviewQuestion.modelId';
export const REVIEW_QUESTION_EFFORT_SETTING = 'reviewQuestion.reasoningEffort';

/** Empty preference follows the main chat; it never changes the main model. */
export function readReviewQuestionModel(): string | null {
  return vscode.workspace.getConfiguration('droidvisx').get<string>(REVIEW_QUESTION_MODEL_SETTING, '').trim() || null;
}

export function readReviewQuestionEffort(): SessionReasoningEffort | null {
  const value = vscode.workspace.getConfiguration('droidvisx').get<string>(REVIEW_QUESTION_EFFORT_SETTING, '');
  return SESSION_REASONING_EFFORTS.find(effort => effort === value) ?? null;
}

export function resolveReviewQuestionSelection(models: readonly ModelCatalogItem[], main: ConfirmedSessionSettings | null | undefined) {
  const configuredModel = readReviewQuestionModel();
  const modelId = configuredModel ?? main?.modelId;
  const model = models.find(item => item.id === modelId && !item.disabled);
  if (!model) throw new ModelAvailabilityError('The question model is unavailable. Choose a model in Settings > General > Code review questions.');
  const configuredEffort = readReviewQuestionEffort();
  if (configuredEffort && !model.supportedReasoningEfforts.includes(configuredEffort))
    throw new ModelAvailabilityError('The question reasoning level is unavailable. Choose a supported level in Settings > General > Code review questions.');
  const inheritedEffort = configuredModel === null ? main?.reasoningEffort : undefined;
  const reasoningEffort = configuredEffort ?? (inheritedEffort && model.supportedReasoningEfforts.includes(inheritedEffort) ? inheritedEffort : model.defaultReasoningEffort);
  return { modelId: model.id, reasoningEffort };
}
