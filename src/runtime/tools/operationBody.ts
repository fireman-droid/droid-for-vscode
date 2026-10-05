import { isOperationBodyRef, isOperationDiff } from '../../shared/protocol/operationDiff';
import { isStrictRecord } from '../../shared/validation/strictValidation';
import { defaultSessionsDirectory } from '../catalog/sessionFavorites';
import { readPersistedSessionMessages } from '../history/persistedSessionMessages';
import { operationToolName } from './operationDiff';
import { INCONSISTENT_OPERATION_PATCH_MESSAGE, parseOperationResultBody } from './operationResult';
import { matchingOperationBody, type OperationBody, type OperationBodyRequest } from './operationBodyReference';

export type { OperationBody, OperationBodyRequest } from './operationBodyReference';
export type OperationMessagePageReader = (
  sessionId: string, options: { readonly limit: number; readonly cursor?: string },
) => Promise<readonly unknown[]>;
export interface OperationBodySource {
  readonly sessionsDirectory?: string;
  /** Existing client only: this reader must not create/resume a session. */
  readonly readMessagePage?: OperationMessagePageReader;
}

/** Recover one attributed result from its source log, including after a host reload.
 * Live notifications do not guarantee the log has flushed; the existing daemon
 * connection can read that same session when the persisted pair is not available.
 */
export async function readOperationBody(
  request: OperationBodyRequest, source: OperationBodySource = {},
): Promise<OperationBody | undefined> {
  if (!validRequest(request)) return undefined;
  const saved = await readPersistedSessionMessages(source.sessionsDirectory ?? defaultSessionsDirectory(), request.sourceSessionId);
  if (saved !== null) {
    const body = bodyFromMessages(request, saved.messages);
    if (body !== undefined) return body;
  }
  if (!source.readMessagePage) return undefined;
  return readOperationBodyPages(request, source.readMessagePage);
}

async function readOperationBodyPages(
  request: OperationBodyRequest, readPage: OperationMessagePageReader,
): Promise<OperationBody | undefined> {
  const matching: unknown[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  // Same bounded history window as the existing daemon history reader, but keep
  // only messages containing this call. Stop as soon as the exact pair matches.
  for (let page = 0; page < 1_000; page++) {
    const messages = await readPage(request.sourceSessionId, { limit: 100, ...(cursor === undefined ? {} : { cursor }) });
    if (!Array.isArray(messages)) return undefined;
    for (const message of messages) {
      if (!isStrictRecord(message) || typeof message.id !== 'string' || seen.has(message.id)) continue;
      seen.add(message.id);
      if (Array.isArray(message.content) && message.content.some(block => isSelectedBlock(block, request.callId)))
        matching.push(message);
    }
    const body = bodyFromMessages(request, matching);
    if (body !== undefined) return body;
    if (messages.length < 100) return undefined;
    const last = messages.at(-1);
    if (!isStrictRecord(last) || typeof last.id !== 'string' || !last.id || last.id === cursor) return undefined;
    cursor = last.id;
  }
  return undefined;
}

function bodyFromMessages(request: OperationBodyRequest, messages: readonly unknown[]): OperationBody | undefined {
  const calls: Record<string, unknown>[] = [];
  const results: Record<string, unknown>[] = [];
  for (const message of messages) {
    if (!isStrictRecord(message) || !Array.isArray(message.content)) continue;
    for (const block of message.content) {
      if (!isSelectedBlock(block, request.callId)) continue;
      if (block.type === 'tool_use') calls.push(block);
      else results.push(block);
    }
  }
  if (calls.length !== 1 || results.length !== 1) return undefined;
  const call = calls[0]!;
  const result = results[0]!;
  const tool = typeof call.name === 'string' ? operationToolName(call.name) : undefined;
  if (tool === undefined || result.isError !== undefined && typeof result.isError !== 'boolean') return undefined;
  // Already persisted large-body references hash the original count warning and
  // patch. Preserve that representation without weakening the digest check.
  const preservePatchCounts = request.file.reversible === false && request.file.message === INCONSISTENT_OPERATION_PATCH_MESSAGE;
  return matchingOperationBody(request, parseOperationResultBody(tool, call.input, result.content,
    request.workspace, request.callId, request.sourceSessionId, result.isError === true, preservePatchCounts));
}

function isSelectedBlock(value: unknown, callId: string): value is Record<string, unknown> {
  return isStrictRecord(value) && (value.type === 'tool_use' && value.id === callId ||
    value.type === 'tool_result' && value.toolUseId === callId);
}

function validRequest(request: OperationBodyRequest): boolean {
  const { path, scope, previousPath, kind, outcome, reversible, message, patch, submittedContent, contentRestricted, bodyRef } = request.file;
  return typeof request.workspace === 'string' && request.workspace.length > 0 &&
    !/[\u0000-\u001f]/u.test(request.workspace) && isOperationBodyRef(bodyRef) &&
    !/[\\/]/u.test(request.sourceSessionId) && isOperationDiff({
      status: 'ready', source: 'tool-result', callId: request.callId, sourceSessionId: request.sourceSessionId,
      files: [{ path, kind, patch, ...(scope === undefined ? {} : { scope }),
        ...(previousPath === undefined ? {} : { previousPath }), ...(outcome === undefined ? {} : { outcome }),
        ...(reversible === undefined ? {} : { reversible }), ...(message === undefined ? {} : { message }),
        ...(submittedContent === undefined ? {} : { submittedContent }),
        ...(contentRestricted === undefined ? {} : { contentRestricted }), bodyRef }],
    });
}
