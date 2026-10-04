import { createHash } from 'node:crypto';
import {
  MAX_OPERATION_BODY_UNITS, MAX_OPERATION_CONTENT_UNITS, MAX_OPERATION_DIFF_UNITS,
  isSafeOperationText, type OperationBodyRef, type OperationDiff, type OperationDiffFile,
} from '../../shared/protocol/operationDiff';

export interface OperationBodyRequest {
  readonly workspace: string;
  readonly sourceSessionId: string;
  readonly callId: string;
  readonly file: OperationDiffFile;
}
export interface OperationBody {
  readonly patch: string;
  readonly submittedContent?: string;
}
export function omitOversizedOperationBody(file: OperationDiffFile): OperationDiffFile {
  const { submittedContent: _submittedContent, bodyRef: _bodyRef, ...metadata } = file;
  return { ...metadata, patch: '', reversible: false,
    message: 'The recorded body for this file exceeds the 512,000-character preview limit.' };
}

/** Include the source identity and outcome, not just the text, in the saved reference. */
export function operationBodyReference(
  sourceSessionId: string, callId: string, file: OperationDiffFile,
): OperationBodyRef {
  const digest = createHash('sha256').update(JSON.stringify([
    sourceSessionId, callId, file.path, file.scope ?? null, file.previousPath ?? null,
    file.kind, file.outcome ?? null, file.reversible ?? null, file.message ?? null,
    file.patch, file.submittedContent ?? null,
  ])).digest('hex');
  return { digest, patchUnits: file.patch.length, contentUnits: file.submittedContent?.length ?? 0 };
}

/** Keep transport metadata compact; load the body from the original session on demand. */
export function summarizeOperationBodies(value: OperationDiff): OperationDiff {
  if (value.status !== 'ready') return value;
  let patchUnits = 0;
  let contentUnits = 0;
  const files: OperationDiffFile[] = [];
  for (const file of value.files) {
    const contentSize = file.submittedContent?.length ?? 0;
    if (file.patch.length + contentSize > MAX_OPERATION_BODY_UNITS) {
      files.push(omitOversizedOperationBody(file));
      continue;
    }
    if (!isSafeOperationText(file.patch, MAX_OPERATION_BODY_UNITS) ||
      file.submittedContent !== undefined && !isSafeOperationText(file.submittedContent, MAX_OPERATION_BODY_UNITS))
      return { status: 'unavailable', reason: 'too-large' };
    if (patchUnits + file.patch.length <= MAX_OPERATION_DIFF_UNITS &&
      contentUnits + contentSize <= MAX_OPERATION_CONTENT_UNITS) {
      files.push(file);
      patchUnits += file.patch.length;
      contentUnits += contentSize;
      continue;
    }
    if (!value.callId || !value.sourceSessionId) return { status: 'unavailable', reason: 'too-large' };
    const { submittedContent: _submittedContent, ...metadata } = file;
    files.push({ ...metadata, patch: '', bodyRef: operationBodyReference(value.sourceSessionId, value.callId, file) });
  }
  return { ...value, files };
}

export function matchingOperationBody(request: OperationBodyRequest, value: OperationDiff): OperationBody | undefined {
  if (value.status !== 'ready' || value.source !== 'tool-result' || value.callId !== request.callId ||
    value.sourceSessionId !== request.sourceSessionId || !request.file.bodyRef) return undefined;
  const matches = value.files.filter(file => file.path === request.file.path && file.scope === request.file.scope &&
    file.previousPath === request.file.previousPath && file.kind === request.file.kind);
  if (matches.length !== 1) return undefined;
  const file = matches[0]!;
  if (file.contentRestricted || !isSafeOperationText(file.patch, MAX_OPERATION_BODY_UNITS) ||
    file.submittedContent !== undefined && !isSafeOperationText(file.submittedContent, MAX_OPERATION_BODY_UNITS)) return undefined;
  const ref = operationBodyReference(request.sourceSessionId, request.callId, file);
  if (ref.digest !== request.file.bodyRef.digest || ref.patchUnits !== request.file.bodyRef.patchUnits ||
    ref.contentUnits !== request.file.bodyRef.contentUnits) return undefined;
  return { patch: file.patch, ...(file.submittedContent === undefined ? {} : { submittedContent: file.submittedContent }) };
}
