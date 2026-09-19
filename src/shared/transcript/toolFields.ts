import {
  MAX_TOOL_DETAIL_LENGTH,
  MAX_TOOL_ERROR_MESSAGE_LENGTH,
  MAX_TOOL_FILE_PATH_LENGTH,
  MAX_TOOL_NAME_LENGTH,
} from '../protocol/bounds';
import { MAX_TOOL_ACTION_SUMMARY_LENGTH } from './toolActivity';
import { MAX_TOOL_OUTPUT_TAIL_LENGTH } from './toolOutput';
import type { ToolActivityMessage, ToolTranscriptItem } from '../protocol/toolProtocol';
import { enrichResultPreview, resultPreviewFields } from './toolResultPreview';
import { enrichOperationDiff, operationDiffFields } from '../protocol/operationDiff';

/** Safe display patch shared by live Host projection and the Webview reducer. */
export function projectToolFields(
  message: ToolActivityMessage,
  existing?: ToolTranscriptItem,
): Omit<ToolTranscriptItem, 'id' | 'kind'> {
  const filePath = message.filePath?.slice(0, MAX_TOOL_FILE_PATH_LENGTH);
  const detail =
    message.detailKind === undefined
      ? undefined
      : message.detail?.slice(0, MAX_TOOL_DETAIL_LENGTH);
  const errorMessage = message.errorMessage?.slice(0, MAX_TOOL_ERROR_MESSAGE_LENGTH);
  const outputTail = message.outputTail?.slice(0, MAX_TOOL_OUTPUT_TAIL_LENGTH);
  return {
    turnId: message.turnId,
    toolUseId: message.toolUseId,
    toolName: message.toolName.slice(0, MAX_TOOL_NAME_LENGTH),
    action: message.action.slice(0, MAX_TOOL_ACTION_SUMMARY_LENGTH),
    status: message.status,
    progressCount: message.progressCount,
    latestUpdateKind: message.latestUpdateKind,
    ...(message.durationMs === undefined ? {} : { durationMs: message.durationMs }),
    ...(filePath === undefined ? {} : { filePath }),
    ...(message.additionalFileCount === undefined
      ? {}
      : { additionalFileCount: message.additionalFileCount }),
    ...(detail === undefined ? {} : { detailKind: message.detailKind, detail }),
    ...(errorMessage === undefined ? {} : { errorMessage }),
    ...(outputTail === undefined ? {} : { outputTail }),
    ...(message.target === undefined ? {} : { target: message.target }),
    ...resultPreviewFields({
      resultPreview: enrichResultPreview(existing?.resultPreview, message.resultPreview),
    }),
    ...operationDiffFields({ operationDiff: enrichOperationDiff(existing?.operationDiff, message.operationDiff) }),
    ...((message.executionPhase ?? existing?.executionPhase) === undefined ? {}
      : { executionPhase: message.executionPhase ?? existing?.executionPhase }),
    ...(message.backgroundHint === undefined
      ? {}
      : { backgroundHint: message.backgroundHint }),
    ...(message.subagent === undefined ? {} : { subagent: message.subagent }),
  };
}
