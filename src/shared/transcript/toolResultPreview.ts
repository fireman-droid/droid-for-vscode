import { hasExactKeys, isStrictRecord } from '../validation/strictValidation';
import { MAX_BRIDGE_ID_LENGTH } from '../protocol/interactionProtocol';
import { type SessionTranscriptItem } from '../protocol/transcript';
import { enrichOperationDiff, operationDiffFields, type OperationDiff } from '../protocol/operationDiff';

export const MAX_TOOL_RESULT_TEXT_UNITS = 8_000;
export const MAX_TOOL_RESULT_LINES = 120;
export const MAX_CONVERSATION_TOOL_RESULT_UNITS = 128_000;
export const MAX_TOOL_RESULT_SOURCE_LENGTH = 512;
export const RESULT_TOOLS = ['Read', 'Grep', 'Glob', 'LS', 'WebSearch', 'github___get_file_contents'] as const;
export type ResultTool = (typeof RESULT_TOOLS)[number];
export const RESULT_UNAVAILABLE_REASONS = [
  'empty',
  'not-saved',
  'evicted',
  'restricted',
  'unsupported',
  'untrusted',
] as const;
export type ResultUnavailableReason = (typeof RESULT_UNAVAILABLE_REASONS)[number];

export interface ToolResultSource {
  readonly tool: ResultTool;
  /** Workspace-relative path, repository path, or a fixed remote-search label. */
  readonly path: string;
  readonly callId: string;
}
export type ToolResultPreview =
  | {
      readonly availability: 'available';
      readonly source: ToolResultSource;
      readonly text: string;
      readonly truncated: boolean;
    }
  | {
      readonly availability: 'unavailable';
      readonly reason: ResultUnavailableReason;
      readonly source?: ToolResultSource;
    };

export function isToolResultPreview(value: unknown): value is ToolResultPreview {
  if (
    !isStrictRecord(value) ||
    !hasExactKeys(value, ['availability'], ['reason', 'source', 'text', 'truncated'])
  )
    return false;
  if (value.availability === 'unavailable') {
    return (
      hasExactKeys(value, ['availability', 'reason'], ['source']) &&
      RESULT_UNAVAILABLE_REASONS.includes(value.reason as ResultUnavailableReason) &&
      (value.source === undefined ||
        (value.reason === 'evicted' && isToolResultSource(value.source)))
    );
  }
  return (
    value.availability === 'available' &&
    hasExactKeys(value, ['availability', 'source', 'text', 'truncated']) &&
    typeof value.text === 'string' &&
    value.text.length > 0 &&
    value.text.length <= MAX_TOOL_RESULT_TEXT_UNITS &&
    value.text.split('\n').length <= MAX_TOOL_RESULT_LINES &&
    !/[\u0000-\u0008\u000b-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(value.text) &&
    typeof value.truncated === 'boolean' &&
    isToolResultSource(value.source)
  );
}

function isToolResultSource(source: unknown): source is ToolResultSource {
  return (
    isStrictRecord(source) &&
    hasExactKeys(source, ['tool', 'path', 'callId']) &&
    RESULT_TOOLS.includes(source.tool as ResultTool) &&
    typeof source.callId === 'string' &&
    source.callId.length > 0 &&
    source.callId.length <= MAX_BRIDGE_ID_LENGTH &&
    typeof source.path === 'string' &&
    source.path.length > 0 &&
    source.path.length <= MAX_TOOL_RESULT_SOURCE_LENGTH &&
    !/^(?:[\\/]|[A-Za-z]:)/u.test(source.path) &&
    !source.path.split(/[\\/]/u).includes('..') &&
    !/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(source.path + source.callId)
  );
}

export function hasValidResultPreview<T extends {
  readonly resultPreview?: unknown;
}>(value: T): value is T & { readonly resultPreview?: ToolResultPreview } {
  return value.resultPreview === undefined || isToolResultPreview(value.resultPreview);
}

export function resultPreviewFields(value: {
  readonly resultPreview?: ToolResultPreview;
}): {
  readonly resultPreview?: ToolResultPreview;
} {
  return value.resultPreview === undefined ? {} : { resultPreview: value.resultPreview };
}

export function unavailableResult(reason: ResultUnavailableReason): ToolResultPreview {
  return { availability: 'unavailable', reason };
}

// All owners retain newest snippets first; tombstones prevent history from refilling them.
export function enforceToolResultBudget<T extends object>(
  items: readonly T[],
): {
  readonly items: readonly T[];
  readonly evicted: boolean;
} {
  let units = 0;
  let exhausted = false;
  let operationUnits = 0;
  let result: T[] | undefined;
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]!;
    const operation = (item as { operationDiff?: OperationDiff }).operationDiff;
    if (operation?.status === 'ready') {
      const size = operation.files.reduce((sum, file) =>
        sum + file.patch.length + (file.submittedContent?.length ?? 0) + file.path.length +
        (file.previousPath?.length ?? 0) + (file.message?.length ?? 0), 0);
      if (operationUnits + size > MAX_CONVERSATION_TOOL_RESULT_UNITS) {
        result ??= [...items];
        result[index] = { ...item, operationDiff: { status: 'unavailable', reason: 'evicted' } };
      } else operationUnits += size;
    }
    const preview = (item as { readonly resultPreview?: ToolResultPreview })
      .resultPreview;
    if (preview?.availability !== 'available') continue;
    if (exhausted || units + preview.text.length > MAX_CONVERSATION_TOOL_RESULT_UNITS) {
      exhausted = true;
      result ??= [...items];
      result[index] = {
        ...(result[index] ?? item),
        resultPreview: {
          availability: 'unavailable',
          reason: 'evicted',
          source: preview.source,
        },
      };
    } else {
      units += preview.text.length;
    }
  }
  return { items: result ?? items, evicted: result !== undefined };
}

export function preserveToolResultPreviews(
  loaded: readonly SessionTranscriptItem[],
  saved: readonly SessionTranscriptItem[],
): readonly SessionTranscriptItem[] {
  const previews = new Map<string, ToolResultPreview>();
  const operations = new Map<string, OperationDiff>();
  for (const item of saved) {
    if (item.kind === 'tool' && item.operationDiff) {
      const session = item.operationDiff.status === 'ready' ? item.operationDiff.sourceSessionId ?? '' : '';
      operations.set(`${session}\u0000${item.toolName}\u0000${item.toolUseId}`, item.operationDiff);
      if (item.operationDiff.status === 'ready' && item.operationDiff.callId)
        operations.set(`${session}\u0000${item.toolName}\u0000${item.operationDiff.callId}`, item.operationDiff);
    }
    if (item.kind !== 'tool' || item.resultPreview === undefined) continue;
    const id = item.resultPreview.source?.callId ?? item.toolUseId;
    previews.set(`${item.toolName}\u0000${id}`, item.resultPreview);
  }
  if (previews.size === 0 && operations.size === 0) return enforceToolResultBudget(loaded).items;
  return enforceToolResultBudget(
    loaded.map((item) => {
      if (item.kind !== 'tool') return item;
      const id = item.resultPreview?.source?.callId ?? item.toolUseId;
      const prior = previews.get(`${item.toolName}\u0000${id}`);
      const callId = item.operationDiff?.status === 'ready' ? item.operationDiff.callId : undefined;
      const session = item.operationDiff?.status === 'ready' ? item.operationDiff.sourceSessionId ?? '' : '';
      const operationDiff = enrichOperationDiff(operations.get(`${session}\u0000${item.toolName}\u0000${callId ?? item.toolUseId}`), item.operationDiff);
      if (prior === undefined) return { ...item, ...operationDiffFields({ operationDiff }) };
      return {
        ...item,
        ...operationDiffFields({ operationDiff }),
        ...resultPreviewFields({
          resultPreview: enrichResultPreview(prior, item.resultPreview),
        }),
      };
    }),
  ).items;
}

export function enrichResultPreview(
  canonical: ToolResultPreview | undefined,
  candidate: ToolResultPreview | undefined,
): ToolResultPreview | undefined {
  return canonical === undefined ||
    (canonical.availability === 'unavailable' && canonical.reason === 'not-saved')
    ? (candidate ?? canonical)
    : canonical;
}
