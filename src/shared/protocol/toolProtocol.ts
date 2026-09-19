import {
  type ToolActivityStatus,
  type ToolBackgroundHint,
  type ToolDetailKind,
  type ToolSubagentSummary,
  type TranscriptToolStatus,
} from './transcript';
import type { ToolActivityUpdateKind } from '../transcript/toolActivity';
import type { ToolResultPreview } from '../transcript/toolResultPreview';
import type { OperationDiff, ToolExecutionPhase } from './operationDiff';

interface ToolDisplayFields {
  readonly turnId: string;
  readonly toolUseId: string;
  readonly toolName: string;
  readonly action: string;
  readonly progressCount: number;
  readonly latestUpdateKind: ToolActivityUpdateKind | null;
  readonly durationMs?: number;
  /** Safe workspace-relative paths changed by this tool, not its read source. */
  readonly filePath?: string;
  readonly additionalFileCount?: number;
  readonly detailKind?: ToolDetailKind;
  readonly detail?: string;
  readonly target?: string;
  readonly errorMessage?: string;
  /** Bounded command output is live-only and never enters recovery or diagnostics. */
  readonly outputTail?: string;
  readonly resultPreview?: ToolResultPreview;
  readonly operationDiff?: OperationDiff;
  readonly executionPhase?: ToolExecutionPhase;
  readonly backgroundHint?: ToolBackgroundHint;
  readonly subagent?: ToolSubagentSummary;
}

export interface ToolTranscriptItem extends ToolDisplayFields {
  readonly id: string;
  readonly kind: 'tool';
  readonly status: TranscriptToolStatus;
}

export interface ToolActivityMessage extends ToolDisplayFields {
  readonly type: 'tool.activity';
  readonly sequence: number;
  readonly sessionId: string;
  readonly status: ToolActivityStatus;
}
