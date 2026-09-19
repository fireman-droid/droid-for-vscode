import { isId, isSafeWorkspaceRelativePath } from '../validation/guards';
import { hasExactKeys, isStrictRecord } from '../validation/strictValidation';
import { MAX_CHANGED_FILES_PER_TURN } from './bounds';

export const MAX_INLINE_DIFF_PATCH_LENGTH = 64 * 1024;
export const MAX_INLINE_DIFF_LINES = 600;

export interface FileReadDiffMessage {
  readonly type: 'file.readDiff';
  readonly sessionId: string;
  readonly turnId: string;
  readonly path: string;
  readonly requestId: string;
}

export interface FileOpenTurnDiffMessage {
  readonly type: 'file.openTurnDiff';
  readonly sessionId: string;
  readonly turnId: string;
  readonly path: string;
}

export function parseFileOpenTurnDiffMessage(value: unknown): FileOpenTurnDiffMessage | undefined {
  if (!isStrictRecord(value) ||
    !hasExactKeys(value, ['type', 'sessionId', 'turnId', 'path']) ||
    value.type !== 'file.openTurnDiff' || !isId(value.sessionId) || !isId(value.turnId) ||
    !isSafeWorkspaceRelativePath(value.path)) return undefined;
  return { type: 'file.openTurnDiff', sessionId: value.sessionId, turnId: value.turnId, path: value.path };
}

export type InlineDiffResult =
  | {
      readonly status: 'ready';
      /** Always cumulative from the before-turn snapshot, never Git HEAD. */
      readonly phase: 'live' | 'settled';
      readonly patch: string;
      readonly truncated: boolean;
    }
  | { readonly status: 'unavailable' | 'not-found' | 'too-large' | 'binary' | 'read-failed' };

export interface FileDiffMessage {
  readonly type: 'file.diff';
  readonly sequence: number;
  readonly sessionId: string;
  readonly turnId: string;
  readonly path: string;
  readonly requestId: string;
  readonly result: InlineDiffResult;
}

/** A refresh hint for attributed turn files, not evidence of a write or a saved patch. */
export interface FileDiffInvalidateMessage {
  readonly type: 'file.diff.invalidate';
  readonly sequence: number;
  readonly sessionId: string;
  readonly turnId: string;
  readonly paths: readonly string[];
}

export function parseFileDiffInvalidateMessage(value: unknown): FileDiffInvalidateMessage | undefined {
  if (!isStrictRecord(value) ||
    !hasExactKeys(value, ['type', 'sequence', 'sessionId', 'turnId', 'paths']) ||
    value.type !== 'file.diff.invalidate' ||
    !Number.isSafeInteger(value.sequence) || (value.sequence as number) < 0 ||
    !isId(value.sessionId) || !isId(value.turnId) ||
    !Array.isArray(value.paths) || value.paths.length === 0 || value.paths.length > MAX_CHANGED_FILES_PER_TURN ||
    !value.paths.every(isSafeWorkspaceRelativePath) || new Set(value.paths).size !== value.paths.length) return undefined;
  return {
    type: 'file.diff.invalidate', sequence: value.sequence as number,
    sessionId: value.sessionId, turnId: value.turnId, paths: value.paths,
  };
}

export function parseFileReadDiffMessage(value: unknown): FileReadDiffMessage | undefined {
  if (
    !isStrictRecord(value) ||
    !hasExactKeys(value, ['type', 'sessionId', 'turnId', 'path', 'requestId']) ||
    value.type !== 'file.readDiff' ||
    !isId(value.sessionId) || !isId(value.turnId) || !isId(value.requestId) ||
    !isSafeWorkspaceRelativePath(value.path)
  ) return undefined;
  return {
    type: 'file.readDiff', sessionId: value.sessionId, turnId: value.turnId,
    path: value.path, requestId: value.requestId,
  };
}

export function parseFileDiffMessage(value: unknown): FileDiffMessage | undefined {
  if (
    !isStrictRecord(value) ||
    !hasExactKeys(value, ['type', 'sequence', 'sessionId', 'turnId', 'path', 'requestId', 'result']) ||
    value.type !== 'file.diff' ||
    !Number.isSafeInteger(value.sequence) || (value.sequence as number) < 0 ||
    !isId(value.sessionId) || !isId(value.turnId) || !isId(value.requestId) ||
    !isSafeWorkspaceRelativePath(value.path) || !isInlineDiffResult(value.result)
  ) return undefined;
  return {
    type: 'file.diff', sequence: value.sequence as number, sessionId: value.sessionId,
    turnId: value.turnId, path: value.path, requestId: value.requestId, result: value.result,
  };
}

function isInlineDiffResult(value: unknown): value is InlineDiffResult {
  if (!isStrictRecord(value)) return false;
  if (value.status === 'ready') {
    return hasExactKeys(value, ['status', 'phase', 'patch', 'truncated']) &&
      (value.phase === 'live' || value.phase === 'settled') &&
      typeof value.patch === 'string' && value.patch.length <= MAX_INLINE_DIFF_PATCH_LENGTH &&
      value.patch.split('\n').length <= MAX_INLINE_DIFF_LINES + 1 &&
      typeof value.truncated === 'boolean';
  }
  return hasExactKeys(value, ['status']) &&
    (value.status === 'unavailable' || value.status === 'not-found' || value.status === 'too-large' ||
      value.status === 'binary' || value.status === 'read-failed');
}
