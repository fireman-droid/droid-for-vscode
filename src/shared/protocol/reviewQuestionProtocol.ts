import { isId, isSafeModelId, isSafeWorkspaceRelativePath } from '../validation/guards';
import { hasExactKeys, isStrictRecord } from '../validation/strictValidation';
import { MAX_BTW_TEXT_LENGTH, parseSessionBtwMessage, type SessionBtwState } from './btwProtocol';

export const MAX_REVIEW_QUESTION_SELECTION = 8_000;
export const MAX_REVIEW_QUESTION_CONTEXT = 16_000;
export interface ReviewQuestionSelection {
  readonly path: string;
  readonly side: 'before' | 'after';
  readonly startLine: number | null;
  readonly endLine: number | null;
  readonly text: string;
  readonly context: string;
}
export type ReviewQuestionRequest =
  | { readonly type: 'reviewQuestion.models'; readonly sessionId: string }
  | { readonly type: 'reviewQuestion.close'; readonly sessionId: string; readonly questionId: string }
  | { readonly type: 'reviewQuestion.stop'; readonly sessionId: string; readonly questionId: string }
  | { readonly type: 'reviewQuestion.ask'; readonly sessionId: string; readonly questionId: string;
      readonly selection: ReviewQuestionSelection; readonly modelId: string; readonly text: string };
export type ReviewQuestionResponse =
  | { readonly type: 'reviewQuestion.state'; readonly sessionId: string; readonly questionId: string; readonly state: SessionBtwState }
  | { readonly type: 'reviewQuestion.models'; readonly sessionId: string; readonly status: 'loading' | 'ready' | 'error';
      readonly items: readonly { readonly id: string; readonly label: string }[]; readonly selectedId: string | null; readonly error: string | null };

function bounded(value: unknown, limit: number): value is string { return typeof value === 'string' && value.length <= limit; }
function isSelection(value: unknown): value is ReviewQuestionSelection {
  return isStrictRecord(value) && hasExactKeys(value, ['path', 'side', 'startLine', 'endLine', 'text', 'context']) &&
    isSafeWorkspaceRelativePath(value.path) && (value.side === 'before' || value.side === 'after') &&
    ((value.startLine === null && value.endLine === null) ||
      (Number.isSafeInteger(value.startLine) && Number(value.startLine) > 0 &&
       Number.isSafeInteger(value.endLine) && Number(value.endLine) >= Number(value.startLine))) &&
    bounded(value.text, MAX_REVIEW_QUESTION_SELECTION) && value.text.trim().length > 0 &&
    bounded(value.context, MAX_REVIEW_QUESTION_CONTEXT);
}
export function parseReviewQuestionRequest(value: unknown): ReviewQuestionRequest | null {
  if (!isStrictRecord(value) || !isId(value.sessionId)) return null;
  if (value.type === 'reviewQuestion.models') return hasExactKeys(value, ['type', 'sessionId']) ? value as ReviewQuestionRequest : null;
  if (!isId(value.questionId)) return null;
  if (value.type === 'reviewQuestion.close' || value.type === 'reviewQuestion.stop')
    return hasExactKeys(value, ['type', 'sessionId', 'questionId']) ? value as ReviewQuestionRequest : null;
  return value.type === 'reviewQuestion.ask' && hasExactKeys(value, ['type', 'sessionId', 'questionId', 'selection', 'modelId', 'text']) &&
    isSelection(value.selection) && isSafeModelId(value.modelId) && bounded(value.text, MAX_BTW_TEXT_LENGTH) && value.text.trim().length > 0
    ? value as ReviewQuestionRequest : null;
}
export function parseReviewQuestionResponse(value: unknown): ReviewQuestionResponse | null {
  if (!isStrictRecord(value) || !isId(value.sessionId)) return null;
  if (value.type === 'reviewQuestion.state' && hasExactKeys(value, ['type', 'sessionId', 'questionId', 'state']) && isId(value.questionId)) {
    const message = parseSessionBtwMessage({ type: 'session.btw', sequence: 0, sessionId: value.sessionId, btw: value.state });
    return message ? { type: value.type, sessionId: value.sessionId, questionId: value.questionId, state: message.btw } : null;
  }
  return value.type === 'reviewQuestion.models' && hasExactKeys(value, ['type', 'sessionId', 'status', 'items', 'selectedId', 'error']) &&
    ['loading', 'ready', 'error'].includes(String(value.status)) && Array.isArray(value.items) && value.items.length <= 2_000 &&
    value.items.every(item => isStrictRecord(item) && hasExactKeys(item, ['id', 'label']) && isSafeModelId(item.id) && bounded(item.label, 512)) &&
    (value.selectedId === null || isSafeModelId(value.selectedId)) && (value.error === null || bounded(value.error, 2_000))
    ? value as ReviewQuestionResponse : null;
}
