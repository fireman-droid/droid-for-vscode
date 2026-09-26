import { isSafeWorkspaceRelativePath } from '../validation/guards';
import { hasExactKeys, isStrictRecord } from '../validation/strictValidation';
import { MAX_BRIDGE_ID_LENGTH } from './interactionProtocol';

export const MAX_OPERATION_DIFF_UNITS = 24_000;
export const MAX_OPERATION_DIFF_FILES = 20;
export const TOOL_EXECUTION_PHASES = [
  'streaming_input', 'queued', 'executing', 'settled_after_execution',
  'settled_without_execution', 'settled_unknown',
] as const;
export type ToolExecutionPhase = (typeof TOOL_EXECUTION_PHASES)[number];
export const isToolExecutionPhase = (value: unknown): value is ToolExecutionPhase =>
  typeof value === 'string' && (TOOL_EXECUTION_PHASES as readonly string[]).includes(value);
export type OperationDiff = {
  readonly status: 'ready';
  /** Legacy input excerpts never become confirmed execution evidence. */
  readonly source: 'successful-tool-input' | 'tool-input' | 'tool-result';
  readonly callId?: string;
  readonly sourceSessionId?: string;
  readonly files: readonly OperationDiffFile[];
} | {
  readonly status: 'unavailable';
  readonly reason: 'not-recorded' | 'unattributed' | 'failed' | 'too-large' | 'restricted' | 'evicted' | 'unchanged';
};
export interface OperationDiffFile {
  readonly path: string;
  readonly previousPath?: string;
  readonly kind: 'added' | 'modified' | 'deleted' | 'renamed';
  readonly outcome?: 'applied' | 'failed' | 'uncertain';
  readonly message?: string;
  /** The outcome is retained, but sensitive content is omitted from this file only. */
  readonly contentRestricted?: true;
  /** Only complete, exact result patches may be considered for inverse application. */
  readonly reversible?: boolean;
  /** @@ without coordinates means the tool did not record absolute line numbers. */
  readonly patch: string;
}
export function isOperationDiff(value: unknown): value is OperationDiff {
  if (!isStrictRecord(value)) return false;
  if (value.status === 'unavailable') return hasExactKeys(value, ['status', 'reason']) &&
    ['not-recorded', 'unattributed', 'failed', 'too-large', 'restricted', 'evicted', 'unchanged'].includes(String(value.reason));
  return value.status === 'ready' && ['successful-tool-input', 'tool-input', 'tool-result'].includes(String(value.source)) &&
    hasExactKeys(value, ['status', 'source', 'files'], ['callId', 'sourceSessionId']) &&
    (value.callId === undefined || typeof value.callId === 'string' && value.callId.length > 0 &&
      value.callId.length <= MAX_BRIDGE_ID_LENGTH && !/[\u0000-\u001f\u007f]/u.test(value.callId)) &&
    (value.sourceSessionId === undefined || typeof value.sourceSessionId === 'string' &&
      value.sourceSessionId.length > 0 && value.sourceSessionId.length <= MAX_BRIDGE_ID_LENGTH &&
      !/[\u0000-\u001f\u007f]/u.test(value.sourceSessionId)) && Array.isArray(value.files) &&
    value.files.length > 0 && value.files.length <= MAX_OPERATION_DIFF_FILES &&
    value.files.every((file) => isStrictRecord(file) &&
      hasExactKeys(file, ['path', 'kind', 'patch'], ['previousPath', 'outcome', 'message', 'reversible', 'contentRestricted']) &&
      isSafeWorkspaceRelativePath(file.path) &&
      (file.previousPath === undefined || isSafeWorkspaceRelativePath(file.previousPath)) &&
      ['added', 'modified', 'deleted', 'renamed'].includes(String(file.kind)) &&
      (file.outcome === undefined || ['applied', 'failed', 'uncertain'].includes(String(file.outcome))) &&
      (file.message === undefined || typeof file.message === 'string' && file.message.length <= 2_000 &&
        !/[\u0000-\u0008\u000b-\u001f\u007f]/u.test(file.message)) &&
      (file.reversible === undefined || typeof file.reversible === 'boolean') &&
      (file.contentRestricted === undefined || file.contentRestricted === true && file.patch === '' && file.reversible === false) &&
      (value.source !== 'tool-result' || file.outcome !== undefined) &&
      (file.reversible !== true || value.source === 'tool-result' && file.outcome === 'applied') &&
      typeof file.patch === 'string' && file.patch.length <= MAX_OPERATION_DIFF_UNITS &&
      !/[\u0000-\u0008\u000b-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(file.patch)) &&
    value.files.reduce((size, file: OperationDiffFile) => size + file.patch.length, 0) <= MAX_OPERATION_DIFF_UNITS;
}
export function operationDiffFields(value: { readonly operationDiff?: OperationDiff }) {
  return value.operationDiff === undefined ? {} : { operationDiff: value.operationDiff };
}

/** Compare each hunk separately: identical replacement text is not a change. */
export function hasOperationTextChanges(patch: string): boolean {
  let before: string[] = [];
  let after: string[] = [];
  const changed = () => before.length !== after.length || before.some((line, index) => line !== after[index]);
  for (const line of patch.split('\n')) {
    if (line.startsWith('@@')) {
      if (changed()) return true;
      before = []; after = [];
    } else if (line.startsWith('-')) before.push(line.slice(1));
    else if (line.startsWith('+')) after.push(line.slice(1));
    else if (line.startsWith(' ')) { before.push(line.slice(1)); after.push(line.slice(1)); }
  }
  return changed();
}

export function hasOperationChanges(file: Pick<OperationDiffFile, 'kind' | 'patch'>): boolean {
  return file.kind !== 'modified' || hasOperationTextChanges(file.patch);
}

/** Also applies to already persisted evidence from older extension versions. */
export function operationDiffWithChanges(value: OperationDiff): OperationDiff {
  if (value.status !== 'ready') return value;
  const files = value.files.filter((file) => file.contentRestricted || file.outcome === 'failed' || file.outcome === 'uncertain' ||
    value.source === 'tool-result' && file.patch === '' || hasOperationChanges(file));
  return !files.length ? { status: 'unavailable', reason: 'unchanged' }
    : files.length === value.files.length ? value : { ...value, files };
}

export function enrichOperationDiff(saved: OperationDiff | undefined, incoming: OperationDiff | undefined): OperationDiff | undefined {
  if (saved === undefined) return incoming;
  if (incoming === undefined) return saved;
  if (saved.status === 'ready' && saved.source === 'tool-result') return saved;
  if (incoming.status === 'ready' && incoming.source === 'tool-result') return incoming;
  if (saved.status === 'ready' && saved.source === 'tool-input') return incoming;
  return saved.status === 'unavailable' && (saved.reason === 'not-recorded' || saved.reason === 'unattributed') &&
    incoming?.status === 'ready' ? incoming : saved;
}

export function isConfirmedOperationFile(diff: OperationDiff, file: OperationDiffFile): boolean {
  return diff.status === 'ready' && diff.source === 'tool-result' && file.outcome === 'applied';
}
