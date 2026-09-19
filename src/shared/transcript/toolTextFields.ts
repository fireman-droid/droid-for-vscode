import { MAX_TOOL_ERROR_MESSAGE_LENGTH } from '../protocol/bounds';
import { MAX_TOOL_OUTPUT_TAIL_LENGTH } from '../bridgeMessages';
import type { ToolTranscriptItem } from '../protocol/toolProtocol';
import { hasValidResultPreview, resultPreviewFields } from './toolResultPreview';
import { isValidToolTarget } from '../validation/validateToolTarget';
import { isOperationDiff, isToolExecutionPhase, operationDiffFields } from '../protocol/operationDiff';

type ToolTextFields = Pick<
  ToolTranscriptItem,
  'target' | 'errorMessage' | 'outputTail' | 'resultPreview' | 'operationDiff' | 'executionPhase'
>;

export function hasValidToolTextFields(
  value: Record<string, unknown>,
): value is Record<string, unknown> & ToolTextFields {
  return (
    isValidToolTarget(value.target) &&
    optionalText(value.errorMessage, MAX_TOOL_ERROR_MESSAGE_LENGTH) &&
    optionalText(value.outputTail, MAX_TOOL_OUTPUT_TAIL_LENGTH) &&
    hasValidResultPreview(value)
    && (value.operationDiff === undefined || isOperationDiff(value.operationDiff))
    && (value.executionPhase === undefined || isToolExecutionPhase(value.executionPhase))
  );
}

export function toolTextFields(validated: Record<string, unknown>): ToolTextFields {
  const value = validated as ToolTextFields;
  return {
    ...(value.target === undefined ? {} : { target: value.target }),
    ...(value.errorMessage === undefined ? {} : { errorMessage: value.errorMessage }),
    ...(value.outputTail === undefined ? {} : { outputTail: value.outputTail }),
    ...resultPreviewFields(value),
    ...operationDiffFields(value),
    ...(value.executionPhase === undefined ? {} : { executionPhase: value.executionPhase }),
  };
}

function optionalText(value: unknown, limit: number): boolean {
  return (
    value === undefined ||
    (typeof value === 'string' && value.length > 0 && value.length <= limit)
  );
}
