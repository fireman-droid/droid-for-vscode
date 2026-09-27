import { isId, isSafeWorkspaceRelativePath } from '../validation/guards';
import { hasExactKeys, isStrictRecord } from '../validation/strictValidation';
import { isOperationDiff, isSafeOperationText, type OperationDiff, type OperationDiffFile } from './operationDiff';
import { REVIEW_SCOPE_KINDS, type ReviewScopeKind } from './reviewProtocol';

export type ReviewPanelOpen = {
  readonly type: 'review.panel.open'; readonly sessionId: string;
  readonly scopeKind: ReviewScopeKind; readonly turnId?: string;
  readonly toolUseId?: string; readonly path?: string;
  readonly action?: 'undo';
};
export type ReviewPanelRequest = ReviewPanelOpen | { readonly type: 'reviewPanel.ready' } |
  { readonly type: 'reviewPanel.readFile' | 'reviewPanel.openNative'; readonly requestId: string;
    readonly reviewScopeId: string; readonly baseline: string; readonly path: string; readonly context: 3 | 20 | 100 } |
  { readonly type: 'reviewPanel.gitStatus' | 'reviewPanel.openAgent' } |
  { readonly type: 'reviewPanel.commit'; readonly paths: readonly string[]; readonly message: string } |
  { readonly type: 'reviewPanel.openPath'; readonly path: string };
export type ReviewPanelContext = {
  readonly type: 'reviewPanel.context'; readonly sessionId: string | null;
  readonly latestTurnId: string | null; readonly valid: boolean;
  readonly operation: OperationDiff | null; readonly operationPath: string | null;
};
export interface ReviewRecordedEntry {
  readonly toolUseId: string;
  readonly patch: string;
  readonly source?: 'tool-input' | 'tool-result' | 'successful-tool-input';
  readonly outcome?: 'applied' | 'failed' | 'uncertain';
  readonly message?: string;
  readonly toolName?: string;
  readonly sequence?: number;
  readonly kind?: OperationDiffFile['kind'];
  /** Submitted text associated with a successful write, not a before/after diff. */
  readonly submittedContent?: string;
}
export interface ReviewRecordedContent {
  readonly content: string;
  readonly sourceToolUseId: string;
  readonly appliedEdits: number;
  readonly remainingOperations: number;
}
export type ReviewPanelFile = {
  readonly type: 'reviewPanel.file'; readonly requestId: string; readonly reviewScopeId: string;
  readonly path: string; readonly version: string; readonly patch: string;
  readonly truncated: boolean; readonly error: string | null;
  readonly recordedOperations?: readonly ReviewRecordedEntry[];
  /** Reconstructed only from a saved write and exact subsequent result patches. */
  readonly recordedContent?: ReviewRecordedContent;
};
export function parseReviewPanelRequest(value: unknown): ReviewPanelRequest | undefined {
  if (!isStrictRecord(value)) return undefined;
  if (value.type === 'review.panel.open') {
    return hasExactKeys(value, ['type', 'sessionId', 'scopeKind'], ['turnId', 'toolUseId', 'path', 'action']) &&
      isId(value.sessionId) && REVIEW_SCOPE_KINDS.includes(value.scopeKind as ReviewScopeKind) &&
      (value.scopeKind === 'turn' || value.scopeKind === 'operations' ? isId(value.turnId) : value.turnId === undefined) &&
      (value.toolUseId === undefined || ((value.scopeKind === 'turn' || value.scopeKind === 'operations') && isId(value.toolUseId))) &&
      (value.path === undefined || isSafeWorkspaceRelativePath(value.path)) &&
      (value.action === undefined || value.action === 'undo' && value.scopeKind === 'operations' && value.toolUseId === undefined)
      ? value as ReviewPanelOpen : undefined;
  }
  if (value.type === 'reviewPanel.ready' || value.type === 'reviewPanel.gitStatus' || value.type === 'reviewPanel.openAgent')
    return hasExactKeys(value, ['type']) ? value as ReviewPanelRequest : undefined;
  if (value.type === 'reviewPanel.openPath')
    return hasExactKeys(value, ['type', 'path']) && isSafeWorkspaceRelativePath(value.path) ? value as ReviewPanelRequest : undefined;
  if (value.type === 'reviewPanel.commit')
    return hasExactKeys(value, ['type', 'paths', 'message']) && Array.isArray(value.paths) &&
      value.paths.length > 0 && value.paths.length <= 100 && value.paths.every(isSafeWorkspaceRelativePath) &&
      typeof value.message === 'string' && value.message.trim().length > 0 && value.message.length <= 4_000
      ? value as ReviewPanelRequest : undefined;
  if (value.type === 'reviewPanel.readFile' || value.type === 'reviewPanel.openNative')
    return hasExactKeys(value, ['type', 'requestId', 'reviewScopeId', 'baseline', 'path', 'context']) &&
      isId(value.requestId) && isId(value.reviewScopeId) && isId(value.baseline) &&
      isSafeWorkspaceRelativePath(value.path) && [3, 20, 100].includes(Number(value.context)) && typeof value.context === 'number'
      ? value as ReviewPanelRequest : undefined;
  return undefined;
}
export function isReviewPanelContext(value: unknown): value is ReviewPanelContext {
  return isStrictRecord(value) && value.type === 'reviewPanel.context' &&
    hasExactKeys(value, ['type', 'sessionId', 'latestTurnId', 'valid', 'operation', 'operationPath']) &&
    (value.sessionId === null || isId(value.sessionId)) && (value.latestTurnId === null || isId(value.latestTurnId)) &&
    typeof value.valid === 'boolean' && (value.operation === null || isOperationDiff(value.operation)) &&
    (value.operationPath === null || isSafeWorkspaceRelativePath(value.operationPath));
}
export function isReviewPanelFile(value: unknown): value is ReviewPanelFile {
  return isStrictRecord(value) && value.type === 'reviewPanel.file' &&
    hasExactKeys(value, ['type', 'requestId', 'reviewScopeId', 'path', 'version', 'patch', 'truncated', 'error'], ['recordedOperations', 'recordedContent']) &&
    isId(value.requestId) && isId(value.reviewScopeId) && isSafeWorkspaceRelativePath(value.path) &&
    typeof value.version === 'string' && typeof value.patch === 'string' && value.patch.length <= 512_000 &&
    typeof value.truncated === 'boolean' && (value.error === null || typeof value.error === 'string') &&
    (value.recordedContent === undefined || isRecordedContent(value.recordedContent)) &&
    (value.recordedOperations === undefined || Array.isArray(value.recordedOperations) &&
      value.recordedOperations.length <= 200 &&
      value.recordedOperations.every((entry) => isStrictRecord(entry) &&
        hasExactKeys(entry, ['toolUseId', 'patch'], ['source', 'outcome', 'message', 'toolName', 'sequence', 'kind', 'submittedContent']) && isId(entry.toolUseId) &&
        (entry.source === undefined || ['tool-input', 'tool-result', 'successful-tool-input'].includes(String(entry.source))) &&
        (entry.outcome === undefined || ['applied', 'failed', 'uncertain'].includes(String(entry.outcome))) &&
        (entry.message === undefined || typeof entry.message === 'string' && entry.message.length <= 2_000) &&
        (entry.toolName === undefined || typeof entry.toolName === 'string' && entry.toolName.length <= 200) &&
        (entry.sequence === undefined || Number.isSafeInteger(entry.sequence) && Number(entry.sequence) >= 0) &&
        (entry.kind === undefined || ['added', 'modified', 'deleted', 'renamed'].includes(String(entry.kind))) &&
        (entry.submittedContent === undefined || isSafeOperationText(entry.submittedContent) && entry.patch === '' && entry.source === 'tool-result' && entry.outcome === 'applied') &&
        typeof entry.patch === 'string' && entry.patch.length <= 24_000) &&
      value.recordedOperations.reduce((sum: number, entry: ReviewRecordedEntry) => sum + entry.patch.length + (entry.submittedContent?.length ?? 0), 0) <= 512_000);
}

function isRecordedContent(value: unknown): value is ReviewRecordedContent {
  return isStrictRecord(value) && hasExactKeys(value, ['content', 'sourceToolUseId', 'appliedEdits', 'remainingOperations']) &&
    typeof value.content === 'string' && value.content.length <= 512_000 && isId(value.sourceToolUseId) &&
    Number.isSafeInteger(value.appliedEdits) && Number(value.appliedEdits) >= 0 &&
    Number.isSafeInteger(value.remainingOperations) && Number(value.remainingOperations) >= 0;
}
