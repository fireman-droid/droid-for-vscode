import * as vscode from 'vscode';

export const REVIEW_QUESTION_MODEL_SETTING = 'reviewQuestion.modelId';

/** Empty preference follows the main chat; it never changes the main model. */
export function readReviewQuestionModel(): string | null {
  return vscode.workspace.getConfiguration('droidvisx').get<string>(REVIEW_QUESTION_MODEL_SETTING, '').trim() || null;
}
