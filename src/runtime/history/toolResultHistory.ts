import type { ToolTranscriptItem } from '../../shared/bridgeMessages';
import { resultPreviewFields } from '../../shared/transcript/toolResultPreview';
import { extractToolResultText } from '../events/normalizeSdkEvent';
import { describeOperation, operationToolName } from '../tools/operationDiff';
import { parseOperationResult } from '../tools/operationResult';
import { operationDiffFields, type OperationDiff } from '../../shared/protocol/operationDiff';

export function historyOperationDiff(
  name: string,
  input: unknown,
  workspace: string | undefined,
  callId: string,
  sourceSessionId?: string,
) {
  return operationToolName(name)
    ? describeOperation(name, input, workspace, callId, sourceSessionId)
    : undefined;
}

export function historyResultOperationDiff(
  name: string,
  input: unknown,
  content: unknown,
  isError: boolean,
  workspace: string | undefined,
  callId: string,
  sourceSessionId?: string,
): OperationDiff | undefined {
  const tool = operationToolName(name);
  return tool === undefined
    ? undefined
    : parseOperationResult(
        tool,
        input,
        content,
        workspace,
        callId,
        sourceSessionId,
        isError,
      );
}
import {
  extractResultPreview,
  nativeResultTool,
  readResultSource,
  type ResultSource,
} from '../tools/toolResultPreview';

export function historyResultSource(
  name: string,
  input: unknown,
  workspace: string | undefined,
  callId: string,
): ResultSource | undefined {
  const tool = nativeResultTool(name);
  return tool === undefined
    ? undefined
    : readResultSource(tool, input, workspace, callId);
}

export function completeHistoryToolItem(
  existing: ToolTranscriptItem,
  content: unknown,
  isError: boolean,
  source?: ResultSource,
  operationDiff?: OperationDiff,
): ToolTranscriptItem {
  const errorMessage = isError ? extractToolResultText(content) : undefined;
  const resultPreview =
    existing.resultPreview ??
    (isError || source === undefined ? undefined : extractResultPreview(content, source));
  return {
    ...existing,
    status: isError ? 'failed' : 'completed',
    ...(errorMessage === undefined ? {} : { errorMessage }),
    ...resultPreviewFields({ resultPreview }),
    ...operationDiffFields({ operationDiff }),
  };
}
