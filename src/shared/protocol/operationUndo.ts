import type { OperationDiffFile } from './operationDiff';

/** Static evidence eligibility shared by Chat and the authoritative Host preflight. */
export function operationUndoUnavailable(file: OperationDiffFile): string | undefined {
  if (file.scope !== undefined) return 'This file belongs to a read-only Mission artifact.';
  if (file.contentRestricted) return 'The recorded file content is restricted.';
  if (file.outcome !== 'applied') return 'The tool did not confirm that this operation was applied.';
  if (file.previousPath !== undefined || file.kind === 'renamed')
    return 'File-only undo has no complete rename record. Use message rewind with Droid checkpoints if available.';
  if (file.kind === 'deleted')
    return 'The deleted file contents were not recorded. Use message rewind with Droid checkpoints if available.';
  if (file.kind === 'added') return file.createdContentHash === undefined
    ? 'The result does not prove the original file was absent and record its exact created content.' : undefined;
  if (file.reversible !== true || !file.patch && !file.bodyRef)
    return 'A complete reversible text patch is unavailable for this operation.';
  return undefined;
}
