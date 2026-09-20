import {
  hasExactKeys,
  isStrictRecord,
  type UnknownRecord,
} from '../validation/strictValidation';

export const REVIEW_SCOPE_KINDS = ['operations', 'turn', 'workspace', 'branch', 'unstaged', 'staged'] as const;
export type ReviewScopeKind = (typeof REVIEW_SCOPE_KINDS)[number];
export const MAX_REVIEW_UNDO_FILES = 200;

export const REVIEW_LIFECYCLES = [
  'writing',
  'settled',
  'reviewing',
  'complete',
  'stale',
  'unavailable',
] as const;
export type ReviewLifecycle = (typeof REVIEW_LIFECYCLES)[number];

export const REVIEW_FILE_STATUSES = [
  'unreviewed',
  'current',
  'reviewed',
  'changed-after-review',
  'open-only',
  'restore-conflict',
] as const;
export type ReviewFileStatus = (typeof REVIEW_FILE_STATUSES)[number];

export interface ReviewFile {
  readonly changeKind?: 'added' | 'modified' | 'deleted' | 'untracked';
  readonly path: string;
  readonly additions: number | null;
  readonly deletions: number | null;
  readonly status: ReviewFileStatus;
  readonly version: string;
  readonly restorable: boolean;
}

export interface ReviewScopeState {
  readonly sessionId: string;
  readonly reviewScopeId: string;
  readonly scopeKind: ReviewScopeKind;
  readonly turnId?: string;
  readonly baseline: string;
  readonly baselineLabel: string;
  readonly lifecycle: ReviewLifecycle;
  readonly files: readonly ReviewFile[];
  readonly currentIndex: number | null;
  readonly reviewedCount: number;
  readonly reviewableCount: number;
  readonly branchCommitCount?: number;
  readonly recordedOnly?: true;
  readonly newerChangesAvailable?: boolean;
  readonly message?: string;
}

export type ReviewOpenMessage = {
  readonly type: 'review.open';
  readonly sessionId: string;
  readonly scopeKind: ReviewScopeKind;
  readonly turnId?: string;
  readonly openCurrent?: true;
};

export type ReviewNavigateMessage = {
  readonly type: 'review.navigate';
  readonly sessionId: string;
  readonly reviewScopeId: string;
  readonly baseline: string;
  readonly direction: 'previous' | 'next';
};

export type ReviewSelectFileMessage = {
  readonly type: 'review.selectFile';
  readonly sessionId: string;
  readonly reviewScopeId: string;
  readonly baseline: string;
  readonly path: string;
};

export type ReviewMarkReviewedMessage = {
  readonly type: 'review.markReviewed';
  readonly sessionId: string;
  readonly reviewScopeId: string;
  readonly baseline: string;
  readonly path: string;
  readonly version: string;
  readonly advance: boolean;
};

export type ReviewRefreshMessage = {
  readonly type: 'review.refresh';
  readonly sessionId: string;
  readonly reviewScopeId?: string;
};

export type ReviewRestorePreviewMessage = {
  readonly type: 'review.restorePreview';
  readonly sessionId: string;
  readonly reviewScopeId: string;
  readonly baseline: string;
  readonly target: 'file' | 'turn';
  readonly path?: string;
  readonly version?: string;
};

export type ReviewRestoreMessage = {
  readonly type: 'review.restoreFile' | 'review.restoreTurn';
  readonly sessionId: string;
  readonly reviewScopeId: string;
  readonly baseline: string;
  readonly previewId: string;
};

export type ReviewRunAgentMessage = {
  readonly type: 'review.runAgentReview';
  readonly sessionId: string;
  readonly reviewScopeId: string;
  readonly baseline: string;
};

export type ReviewWebviewMessage =
  | ReviewOpenMessage
  | ReviewNavigateMessage
  | ReviewSelectFileMessage
  | ReviewMarkReviewedMessage
  | ReviewRefreshMessage
  | ReviewRestorePreviewMessage
  | ReviewRestoreMessage
  | ReviewRunAgentMessage;

export interface ReviewStateMessage {
  readonly type: 'review.state';
  readonly sequence: number;
  readonly state: ReviewScopeState;
}

export interface ReviewRestorePreviewStateMessage {
  readonly type: 'review.restorePreview';
  readonly sequence: number;
  readonly sessionId: string;
  readonly reviewScopeId: string;
  readonly previewId: string;
  readonly target: 'file' | 'turn';
  readonly restorable: readonly string[];
  readonly conflicted: readonly string[];
  readonly created: readonly string[];
  readonly deleted: readonly string[];
}

export interface ReviewOperationResultMessage {
  readonly type: 'review.operationResult';
  readonly sequence: number;
  readonly sessionId: string;
  readonly reviewScopeId: string;
  readonly operation: 'open' | 'mark-reviewed' | 'restore-file' | 'restore-turn';
  readonly ok: boolean;
  readonly message: string;
}

export interface ReviewAgentStateMessage {
  readonly type: 'review.agentReviewState';
  readonly sequence: number;
  readonly sessionId: string;
  readonly reviewScopeId: string;
  readonly status: 'starting' | 'running' | 'complete' | 'failed';
  readonly reviewSessionId?: string;
  readonly message?: string;
}

export type ReviewHostMessage =
  | ReviewStateMessage
  | ReviewRestorePreviewStateMessage
  | ReviewOperationResultMessage
  | ReviewAgentStateMessage;

export function parseReviewWebviewMessage(
  value: UnknownRecord,
  isId: (value: unknown) => value is string,
  isPath: (value: unknown) => value is string,
): ReviewWebviewMessage | undefined {
  switch (value.type) {
    case 'review.open':
      return parseOpen(value, isId);
    case 'review.navigate':
      if (
        hasExactKeys(value, [
          'type',
          'sessionId',
          'reviewScopeId',
          'baseline',
          'direction',
        ]) &&
        isIds(value, isId) &&
        (value.direction === 'previous' || value.direction === 'next')
      ) {
        return value as unknown as ReviewNavigateMessage;
      }
      return undefined;
    case 'review.selectFile':
      if (
        hasExactKeys(value, ['type', 'sessionId', 'reviewScopeId', 'baseline', 'path']) &&
        isIds(value, isId) &&
        isPath(value.path)
      ) {
        return value as unknown as ReviewSelectFileMessage;
      }
      return undefined;
    case 'review.markReviewed':
      if (
        hasExactKeys(value, [
          'type',
          'sessionId',
          'reviewScopeId',
          'baseline',
          'path',
          'version',
          'advance',
        ]) &&
        isIds(value, isId) &&
        isPath(value.path) &&
        isId(value.version) &&
        typeof value.advance === 'boolean'
      ) {
        return value as unknown as ReviewMarkReviewedMessage;
      }
      return undefined;
    case 'review.refresh':
      if (
        (hasExactKeys(value, ['type', 'sessionId']) ||
          hasExactKeys(value, ['type', 'sessionId', 'reviewScopeId'])) &&
        isId(value.sessionId) &&
        (value.reviewScopeId === undefined || isId(value.reviewScopeId))
      ) {
        return value as unknown as ReviewRefreshMessage;
      }
      return undefined;
    case 'review.restorePreview':
      return parseRestorePreview(value, isId, isPath);
    case 'review.restoreFile':
    case 'review.restoreTurn':
      if (
        hasExactKeys(value, [
          'type',
          'sessionId',
          'reviewScopeId',
          'baseline',
          'previewId',
        ]) &&
        isIds(value, isId) &&
        isId(value.previewId)
      ) {
        return value as unknown as ReviewRestoreMessage;
      }
      return undefined;
    case 'review.runAgentReview':
      if (
        hasExactKeys(value, ['type', 'sessionId', 'reviewScopeId', 'baseline']) &&
        isIds(value, isId)
      ) {
        return value as unknown as ReviewRunAgentMessage;
      }
      return undefined;
    default:
      return undefined;
  }
}

function parseOpen(
  value: UnknownRecord,
  isId: (value: unknown) => value is string,
): ReviewOpenMessage | undefined {
  const required = ['type', 'sessionId', 'scopeKind'];
  const optional = ['turnId', 'openCurrent'];
  if (
    !hasOnlyKeys(value, required, optional) ||
    !isId(value.sessionId) ||
    !isReviewScopeKind(value.scopeKind) ||
    (value.turnId !== undefined && !isId(value.turnId)) ||
    (value.openCurrent !== undefined && value.openCurrent !== true) ||
    ((value.scopeKind === 'turn' || value.scopeKind === 'operations') && value.turnId === undefined) ||
    (value.scopeKind !== 'turn' && value.scopeKind !== 'operations' && value.turnId !== undefined)
  ) {
    return undefined;
  }
  return value as unknown as ReviewOpenMessage;
}

function parseRestorePreview(
  value: UnknownRecord,
  isId: (value: unknown) => value is string,
  isPath: (value: unknown) => value is string,
): ReviewRestorePreviewMessage | undefined {
  const common = ['type', 'sessionId', 'reviewScopeId', 'baseline', 'target'];
  if (
    !(
      hasExactKeys(value, common) || hasExactKeys(value, [...common, 'path', 'version'])
    ) ||
    !isIds(value, isId) ||
    (value.target !== 'file' && value.target !== 'turn')
  ) {
    return undefined;
  }
  if (value.target === 'file') {
    if (!isPath(value.path) || !isId(value.version)) {
      return undefined;
    }
  } else if (value.path !== undefined || value.version !== undefined) {
    return undefined;
  }
  return value as unknown as ReviewRestorePreviewMessage;
}

function isIds(value: UnknownRecord, isId: (value: unknown) => value is string): boolean {
  return isId(value.sessionId) && isId(value.reviewScopeId) && isId(value.baseline);
}

function isReviewScopeKind(value: unknown): value is ReviewScopeKind {
  return (
    typeof value === 'string' && (REVIEW_SCOPE_KINDS as readonly string[]).includes(value)
  );
}

export function parseReviewHostMessage(value: unknown): ReviewHostMessage | undefined {
  if (
    !isStrictRecord(value) ||
    typeof value.type !== 'string' ||
    !Number.isSafeInteger(value.sequence) ||
    (value.sequence as number) < 0
  ) {
    return undefined;
  }
  switch (value.type) {
    case 'review.state':
      return hasExactKeys(value, ['type', 'sequence', 'state']) &&
        isReviewState(value.state)
        ? (value as unknown as ReviewStateMessage)
        : undefined;
    case 'review.restorePreview':
      return hasExactKeys(value, [
        'type',
        'sequence',
        'sessionId',
        'reviewScopeId',
        'previewId',
        'target',
        'restorable',
        'conflicted',
        'created',
        'deleted',
      ]) &&
        strings(value, ['sessionId', 'reviewScopeId', 'previewId']) &&
        (value.target === 'file' || value.target === 'turn') &&
        pathArray(value.restorable) &&
        pathArray(value.conflicted) &&
        pathArray(value.created) &&
        pathArray(value.deleted)
        ? (value as unknown as ReviewRestorePreviewStateMessage)
        : undefined;
    case 'review.operationResult':
      return hasExactKeys(value, [
        'type',
        'sequence',
        'sessionId',
        'reviewScopeId',
        'operation',
        'ok',
        'message',
      ]) &&
        strings(value, ['sessionId', 'reviewScopeId', 'message']) &&
        ['open', 'mark-reviewed', 'restore-file', 'restore-turn'].includes(
          String(value.operation),
        ) &&
        typeof value.ok === 'boolean'
        ? (value as unknown as ReviewOperationResultMessage)
        : undefined;
    case 'review.agentReviewState':
      return parseAgentState(value);
    default:
      return undefined;
  }
}

function isReviewState(value: unknown): value is ReviewScopeState {
  if (!isStrictRecord(value)) {
    return false;
  }
  const required = [
    'sessionId',
    'reviewScopeId',
    'scopeKind',
    'baseline',
    'baselineLabel',
    'lifecycle',
    'files',
    'currentIndex',
    'reviewedCount',
    'reviewableCount',
  ];
  const optional = ['turnId', 'branchCommitCount', 'newerChangesAvailable', 'message', 'recordedOnly'];
  if (
    !hasOnlyKeys(value, required, optional) ||
    !strings(value, ['sessionId', 'reviewScopeId', 'baseline', 'baselineLabel']) ||
    !isReviewScopeKind(value.scopeKind) ||
    !enumIncludes(REVIEW_LIFECYCLES, value.lifecycle) ||
    !Array.isArray(value.files) ||
    !value.files.every(isReviewFile) ||
    !(
      value.currentIndex === null ||
      (Number.isSafeInteger(value.currentIndex) &&
        (value.currentIndex as number) >= 0 &&
        (value.currentIndex as number) < value.files.length)
    ) ||
    !isCount(value.reviewedCount) ||
    !isCount(value.reviewableCount)
  ) {
    return false;
  }
  return (
    (value.turnId === undefined || typeof value.turnId === 'string') &&
    (value.branchCommitCount === undefined || isCount(value.branchCommitCount)) &&
    (value.recordedOnly === undefined || value.recordedOnly === true) &&
    (value.newerChangesAvailable === undefined ||
      typeof value.newerChangesAvailable === 'boolean') &&
    (value.message === undefined || typeof value.message === 'string')
  );
}

function isReviewFile(value: unknown): value is ReviewFile {
  return (
    isStrictRecord(value) &&
    hasExactKeys(value, [
      'path',
      'additions',
      'deletions',
      'status',
      'version',
      'restorable',
    ], ['changeKind']) &&
    (value.changeKind === undefined || ['added', 'modified', 'deleted', 'untracked'].includes(String(value.changeKind))) &&
    typeof value.path === 'string' &&
    nullableCount(value.additions) &&
    nullableCount(value.deletions) &&
    enumIncludes(REVIEW_FILE_STATUSES, value.status) &&
    typeof value.version === 'string' &&
    typeof value.restorable === 'boolean'
  );
}

function parseAgentState(value: UnknownRecord): ReviewAgentStateMessage | undefined {
  if (
    !hasOnlyKeys(
      value,
      ['type', 'sequence', 'sessionId', 'reviewScopeId', 'status'],
      ['reviewSessionId', 'message'],
    ) ||
    !strings(value, ['sessionId', 'reviewScopeId']) ||
    !['starting', 'running', 'complete', 'failed'].includes(String(value.status)) ||
    (value.reviewSessionId !== undefined && typeof value.reviewSessionId !== 'string') ||
    (value.message !== undefined && typeof value.message !== 'string')
  ) {
    return undefined;
  }
  return value as unknown as ReviewAgentStateMessage;
}

function hasOnlyKeys(
  value: UnknownRecord,
  required: readonly string[],
  optional: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return (
    required.every((key) => keys.includes(key)) &&
    keys.every((key) => required.includes(key) || optional.includes(key))
  );
}

function strings(value: UnknownRecord, keys: readonly string[]): boolean {
  return keys.every((key) => typeof value[key] === 'string');
}

function pathArray(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length <= MAX_REVIEW_UNDO_FILES &&
    value.every((entry) => typeof entry === 'string')
  );
}

function nullableCount(value: unknown): boolean {
  return value === null || isCount(value);
}

function isCount(value: unknown): boolean {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function enumIncludes(values: readonly string[], value: unknown): boolean {
  return typeof value === 'string' && values.includes(value);
}
