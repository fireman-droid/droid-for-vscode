import type { DroidStreamEvent } from '@factory/droid-sdk/node';
import {
  MAX_OPERATION_DIFF_FILES, MAX_OPERATION_DIFF_UNITS,
  operationDiffWithChanges, type OperationDiff,
} from '../../shared/protocol/operationDiff';
import { MAX_TOOL_ACTIVITIES_PER_TURN } from '../../shared/protocol/bounds';
import { isRestrictedToolContent, readResultSource } from './toolResultPreview';
import { toolNameCandidates } from '../../shared/transcript/toolActivity';
import { MAX_BRIDGE_ID_LENGTH } from '../../shared/protocol/interactionProtocol';
import {
  parseOperationResult,
  readDeclaredFiles,
  type OperationTool,
} from './operationResult';

const modifying = new Set<OperationTool>([
  'applypatch',
  'edit',
  'create',
  'write',
]);
export const operationToolName = (name: string): OperationTool | undefined =>
  toolNameCandidates(name).find((candidate): candidate is OperationTool =>
    modifying.has(candidate as OperationTool),
  );
const unavailable = (reason: Extract<OperationDiff, { status: 'unavailable' }>['reason']): OperationDiff =>
  ({ status: 'unavailable', reason });

/** Never interprets arbitrary command output as proof that a command changed a file. */
export function createOperationDiffCollector(
  workspace?: string,
  sourceSessionId?: string,
) {
  const inputs = new Map<
    string,
    { name: string; input: unknown }
  >();
  return (event: DroidStreamEvent): OperationDiff | undefined => {
    if (event.type === 'tool_call' && operationToolName(event.name)) {
      const name = operationToolName(event.name)!;
      const proposal = describeOperation(
        event.name,
        event.input,
        workspace,
        event.toolUseId,
        sourceSessionId,
      );
      if (inputs.size < MAX_TOOL_ACTIVITIES_PER_TURN)
        inputs.set(event.toolUseId, { name, input: event.input });
      return proposal;
    }
    if (event.type !== 'tool_result') return undefined;
    const input = inputs.get(event.toolUseId);
    inputs.delete(event.toolUseId);
    const name = operationToolName(event.toolName);
    if (!name) return undefined;
    if (!input || input.name !== name) return unavailable('not-recorded');
    return parseOperationResult(
      name,
      input.input,
      event.content,
      workspace,
      event.toolUseId,
      sourceSessionId,
      event.isError,
    );
  };
}

export function describeOperation(
  name: string,
  rawInput: unknown,
  workspace?: string,
  callId?: string,
  sourceSessionId?: string,
): OperationDiff {
  const tool = operationToolName(name);
  if (!workspace || !tool) return unavailable('not-recorded');
  const files = readDeclaredFiles(tool, rawInput, workspace);
  if (!files) return unavailable('unattributed');
  if (!files.length) return unavailable('not-recorded');
  if (files.length > MAX_OPERATION_DIFF_FILES || files.reduce((size, file) => size + file.patch.length, 0) > MAX_OPERATION_DIFF_UNITS)
    return unavailable('too-large');
  for (const file of files) {
    const source = readResultSource('Read', { file_path: file.path }, workspace, 'operation');
    if (typeof source === 'string' || isRestrictedToolContent(file.patch))
      return unavailable('restricted');
    if (file.previousPath && typeof readResultSource('Read', { file_path: file.previousPath }, workspace, 'operation') === 'string')
      return unavailable('restricted');
  }
  const identity =
    callId &&
    callId.length <= MAX_BRIDGE_ID_LENGTH &&
    !/[\u0000-\u001f\u007f]/u.test(callId)
      ? { callId }
      : {};
  const sessionIdentity =
    sourceSessionId &&
    sourceSessionId.length <= MAX_BRIDGE_ID_LENGTH &&
    !/[\u0000-\u001f\u007f]/u.test(sourceSessionId)
      ? { sourceSessionId }
      : {};
  return operationDiffWithChanges({
    status: 'ready',
    source: 'tool-input',
    ...identity,
    ...sessionIdentity,
    files,
  });
}
