// readers: moved verbatim from Thread.tsx (structure-only refactor).

import { type SentAttachmentSummary } from '../../../shared/protocol/attachments';
import {
  isToolResultPreview,
  type ToolResultPreview,
} from '../../../shared/transcript/toolResultPreview';

export interface ToolActivityPresentation {
  readonly turnId: string | null;
  readonly action: string;
  readonly status: string;
  readonly progressCount: number;
  readonly latestUpdateKind: string | null;
  readonly durationMs: number | null;
  readonly filePath: string | null;
  readonly detailKind: 'command' | 'plan' | null;
  readonly detail: string | null;
  readonly target: string | null;
  /** Error excerpt from a failed tool_result, shown when expanded. */
  readonly errorMessage: string | null;
  /**
   * Live trailing output of an execute-class tool (tier1 §1). Present
   * only in live sessions — history and recovery replays never carry
   * it — so playback stays previewless by construction.
   */
  readonly outputTail: string | null;
  readonly resultPreview?: ToolResultPreview | null;
  /**
   * True when the CLI launched this execute call as a detached
   * background process (fireAndForget). Display-only: the GUI holds
   * no process handle, so stopping stays a manual user action
   * (background-process design §2.3, fail-closed).
   */
  readonly background: boolean;
  /**
   * Subagent summary of a delegating Task tool: identity from the
   * delegation, terminal status and counters from the CLI's durable
   * invocation ledger. One level only — child sessions never stream
   * their internals into the parent transcript.
   */
  readonly subagent: {
    readonly type: string;
    readonly description: string;
    readonly status: string | null;
    readonly toolUseCount: number | null;
    readonly durationMs: number | null;
  } | null;
}

export function readToolActivity(part: unknown): ToolActivityPresentation {
  const fallback: ToolActivityPresentation = {
    turnId: null,
    action: 'Used a workspace tool',
    status: 'completed',
    progressCount: 0,
    latestUpdateKind: null,
    durationMs: null,
    filePath: null,
    detailKind: null,
    detail: null,
    target: null,
    errorMessage: null,
    outputTail: null,
    background: false,
    subagent: null,
  };
  const metadata = readDroidvisxMetadata(part);
  if (
    metadata !== null &&
    'action' in metadata &&
    typeof metadata.action === 'string' &&
    'status' in metadata &&
    typeof metadata.status === 'string' &&
    'progressCount' in metadata &&
    Number.isSafeInteger(metadata.progressCount) &&
    'latestUpdateKind' in metadata &&
    (metadata.latestUpdateKind === null || typeof metadata.latestUpdateKind === 'string')
  ) {
    const detailKind =
      metadata['detailKind'] === 'command' || metadata['detailKind'] === 'plan'
        ? metadata['detailKind']
        : null;
    return {
      ...(metadata as Omit<
        ToolActivityPresentation,
        | 'durationMs'
        | 'turnId'
        | 'filePath'
        | 'detailKind'
        | 'detail'
        | 'target'
        | 'errorMessage'
        | 'outputTail'
        | 'background'
        | 'subagent'
      >),
      turnId:
        typeof metadata['turnId'] === 'string' && metadata['turnId'].length > 0
          ? metadata['turnId']
          : null,
      durationMs: readMetadataDuration(metadata),
      filePath:
        typeof metadata['filePath'] === 'string' && metadata['filePath'].length > 0
          ? metadata['filePath']
          : null,
      detailKind,
      detail:
        detailKind !== null &&
        typeof metadata['detail'] === 'string' &&
        metadata['detail'].length > 0
          ? metadata['detail']
          : null,
      target:
        typeof metadata['target'] === 'string' && metadata['target'].length > 0
          ? metadata['target']
          : null,
      errorMessage:
        typeof metadata['errorMessage'] === 'string' &&
        metadata['errorMessage'].length > 0
          ? metadata['errorMessage']
          : null,
      outputTail:
        typeof metadata['outputTail'] === 'string' && metadata['outputTail'].length > 0
          ? metadata['outputTail']
          : null,
      resultPreview: isToolResultPreview(metadata['resultPreview'])
        ? metadata['resultPreview']
        : null,
      background: readMetadataBackground(metadata['backgroundHint']),
      subagent: readMetadataSubagent(metadata['subagent']),
    };
  }
  return fallback;
}

/** Fail-soft: only `{ fireAndForget: true }` marks a row. */
export function readMetadataBackground(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'fireAndForget' in value &&
    value.fireAndForget === true
  );
}

export function readMetadataSubagent(
  value: unknown,
): ToolActivityPresentation['subagent'] {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('type' in value) ||
    typeof value.type !== 'string' ||
    value.type.length === 0 ||
    !('description' in value) ||
    typeof value.description !== 'string'
  ) {
    return null;
  }
  const record = value as Record<string, unknown>;
  return {
    type: value.type,
    description: value.description,
    status: typeof record['status'] === 'string' ? record['status'] : null,
    toolUseCount: Number.isSafeInteger(record['toolUseCount'])
      ? (record['toolUseCount'] as number)
      : null,
    durationMs: Number.isSafeInteger(record['durationMs'])
      ? (record['durationMs'] as number)
      : null,
  };
}

export function readDroidvisxMetadata(part: unknown): Record<string, unknown> | null {
  if (
    typeof part === 'object' &&
    part !== null &&
    'providerMetadata' in part &&
    typeof part.providerMetadata === 'object' &&
    part.providerMetadata !== null &&
    'droidvisx' in part.providerMetadata &&
    typeof part.providerMetadata.droidvisx === 'object' &&
    part.providerMetadata.droidvisx !== null
  ) {
    return part.providerMetadata.droidvisx as Record<string, unknown>;
  }
  return null;
}

export function readMetadataDuration(metadata: Record<string, unknown>): number | null {
  return typeof metadata['durationMs'] === 'number' &&
    Number.isFinite(metadata['durationMs']) &&
    metadata['durationMs'] >= 0
    ? metadata['durationMs']
    : null;
}

export function readReasoningDuration(part: unknown): number | null {
  const metadata = readDroidvisxMetadata(part);
  return metadata === null ? null : readMetadataDuration(metadata);
}

export function readReasoningTruncated(part: unknown): boolean {
  const metadata = readDroidvisxMetadata(part);
  return metadata?.['truncated'] === true;
}

export function firstLine(text: string): string {
  const line = text.split('\n', 1)[0] ?? text;
  return line.length > 120 ? `${line.slice(0, 119)}…` : line;
}

// Completed Thinking rows read as a past-tense fact, mirroring the
// Cursor "Thought for Xs" affordance; sub-500ms runs are too short
// for a number to be meaningful.
export function formatThinkingLabel(
  statusType: string | undefined,
  durationMs: number | null,
): string {
  if (statusType === 'incomplete') {
    return 'Thinking stopped';
  }
  if (durationMs === null) {
    return 'Thought';
  }
  if (durationMs < 500) {
    return 'Thought briefly';
  }
  if (durationMs < 1_000) {
    return `Thought for ${(durationMs / 1_000).toFixed(1)}s`;
  }
  const totalSeconds = Math.round(durationMs / 1_000);
  if (totalSeconds < 60) {
    return `Thought for ${totalSeconds}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds === 0
    ? `Thought for ${minutes}m`
    : `Thought for ${minutes}m ${seconds}s`;
}

export function formatDuration(durationMs: number): string {
  if (durationMs < 1_000) {
    return `${(durationMs / 1_000).toFixed(1)}s`;
  }
  const totalSeconds = durationMs / 1_000;
  if (totalSeconds < 60) {
    return totalSeconds < 10
      ? `${totalSeconds.toFixed(1)}s`
      : `${Math.round(totalSeconds)}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);
  return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
}

export function formatToolLifecycle(status: string): string {
  switch (status) {
    case 'running':
      return 'Working';
    case 'failed':
      return 'Failed';
    case 'stopped':
      return 'Stopped';
    default:
      return 'Completed';
  }
}

export function formatToolProgress(activity: Pick<ToolActivityPresentation, 'progressCount' | 'latestUpdateKind' | 'status'>): string {
  if (activity.progressCount === 0 || activity.latestUpdateKind === null) {
    return `Lifecycle: ${formatToolLifecycle(activity.status)}`;
  }
  const count = `${activity.progressCount} progress ${
    activity.progressCount === 1 ? 'update' : 'updates'
  }`;
  return `${count} · Latest: ${formatUpdateKind(activity.latestUpdateKind)}`;
}

export function formatUpdateKind(kind: string): string {
  switch (kind) {
    case 'tool-call':
      return 'tool started';
    case 'tool-result':
      return 'tool result';
    case 'error':
      return 'error';
    case 'status':
      return 'status';
    default:
      return 'message';
  }
}

export function readUserMessageId(metadata: unknown): string | null {
  if (
    typeof metadata === 'object' &&
    metadata !== null &&
    'custom' in metadata &&
    typeof metadata.custom === 'object' &&
    metadata.custom !== null &&
    'messageId' in metadata.custom &&
    typeof metadata.custom.messageId === 'string' &&
    metadata.custom.messageId.length > 0
  ) {
    return metadata.custom.messageId;
  }
  return null;
}

export function readUserAttachments(metadata: unknown): readonly SentAttachmentSummary[] {
  if (
    typeof metadata === 'object' &&
    metadata !== null &&
    'custom' in metadata &&
    typeof metadata.custom === 'object' &&
    metadata.custom !== null &&
    'attachments' in metadata.custom &&
    Array.isArray(metadata.custom.attachments)
  ) {
    return metadata.custom.attachments as readonly SentAttachmentSummary[];
  }
  return [];
}

export function readMessageText(content: readonly unknown[]): string {
  return content
    .filter(
      (
        part,
      ): part is {
        readonly type: 'text';
        readonly text: string;
      } =>
        typeof part === 'object' &&
        part !== null &&
        'type' in part &&
        part.type === 'text' &&
        'text' in part &&
        typeof part.text === 'string',
    )
    .map((part) => part.text)
    .join('');
}

export function readDiagnostic(data: unknown): {
  readonly severity: 'info' | 'warning' | 'error';
  readonly code: string;
  readonly message: string;
  readonly relatedSessionId: string | null;
} {
  if (
    typeof data === 'object' &&
    data !== null &&
    'severity' in data &&
    (data.severity === 'info' ||
      data.severity === 'warning' ||
      data.severity === 'error') &&
    'code' in data &&
    typeof data.code === 'string' &&
    'message' in data &&
    typeof data.message === 'string'
  ) {
    const relatedSessionId =
      'relatedSessionId' in data &&
      typeof data.relatedSessionId === 'string' &&
      data.relatedSessionId.length > 0
        ? data.relatedSessionId
        : null;
    return {
      severity: data.severity,
      code: data.code,
      message: data.message,
      relatedSessionId,
    };
  }
  return {
    severity: 'warning',
    code: 'DIAGNOSTIC_UNAVAILABLE',
    message: 'Diagnostic details are unavailable.',
    relatedSessionId: null,
  };
}
