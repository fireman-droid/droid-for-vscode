import { type ImageMediaType, type ImageOrigin } from '../shared/protocol/attachments';
import {
  type ToolBackgroundHint,
  type ToolDetailKind,
  type ToolSubagentSummary,
} from '../shared/protocol/transcript';
import type { ToolActivityUpdateKind } from '../shared/transcript/toolActivity';
import type { ToolResultPreview } from '../shared/transcript/toolResultPreview';
import type { TokenUsageBreakdown } from '../shared/protocol/tokenUsage';
import type { MissionLifecycle } from '../shared/protocol/missionProtocol';
import type {
  OperationDiff,
  ToolExecutionPhase,
} from '../shared/protocol/operationDiff';

export interface MissionRuntimeFeature {
  readonly id: string;
  readonly description: string;
  readonly status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  readonly skillName: string;
  readonly milestone?: string;
  readonly workerSessionIds?: readonly string[];
  readonly currentWorkerSessionId?: string | null;
  readonly completedWorkerSessionId?: string | null;
}

export interface MissionProgressSummary {
  readonly type:
    | 'mission_accepted'
    | 'mission_paused'
    | 'mission_resumed'
    | 'mission_run_started'
    | 'worker_started'
    | 'worker_selected_feature'
    | 'worker_completed'
    | 'worker_failed'
    | 'worker_paused'
    | 'handoff_items_dismissed'
    | 'milestone_validation_triggered';
  readonly timestamp: string;
  readonly workerSessionId?: string;
  readonly featureId?: string;
  readonly title?: string;
  readonly exitCode?: number;
}

export type RuntimeAvailability =
  | {
      status: 'available';
      sdkVersion: string;
      cliVersion: null;
      authenticationStatus: 'unknown';
      sessionId: string;
    }
  | {
      status: 'unavailable';
      sdkVersion: string;
      cliVersion: null;
      authenticationStatus: 'unknown';
      reason:
        | 'cli-not-found'
        | 'invalid-cwd'
        | 'daemon-not-logged-in'
        | 'daemon-credentials-unreadable'
        | 'daemon-refresh-failed'
        | 'daemon-unavailable'
        | 'sdk-protocol-incompatible'
        | 'initialization-failed';
      message: string;
    };

export type RuntimeEvent =
  | {
      type: 'mission-state';
      lifecycle: MissionLifecycle;
    }
  | {
      type: 'mission-features';
      features: readonly MissionRuntimeFeature[];
    }
  | {
      type: 'mission-progress';
      entries: readonly MissionProgressSummary[];
    }
  | {
      type: 'mission-heartbeat';
      timestamp: string;
    }
  | {
      type: 'mission-worker-started';
      workerSessionId: string;
    }
  | {
      type: 'mission-worker-completed';
      workerSessionId: string;
      exitCode: number;
    }
  | {
      type: 'text-delta';
      text: string;
    }
  | {
      type: 'thinking-delta';
      text: string;
      /**
       * SDK message id anchoring this thinking segment (probed
       * 2026-08-12: one messageId per think→tool→think segment).
       */
      messageId: string;
      /** Block index of the thinking block inside its message. */
      blockIndex: number;
    }
  | {
      type: 'thinking-complete';
      durationMs: number | null;
      messageId: string;
      blockIndex: number;
    }
  | {
      type: 'tool-start';
      toolName: string;
      toolUseId: string;
      action: string;
      /**
       * True only for the SDK's complete `tool_call`, never for a
       * partial `tool_call_delta`. Lets the host capture a stable
       * pre-write file baseline without trusting a truncated path.
       */
      inputComplete?: true;
      /** The partial input already names the complete modified-path set. */
      filePathsComplete?: true;
      /** Workspace-relative path changed by file-modifying tools. */
      filePath?: string;
      /**
       * Every changed workspace-relative path when one call names
       * several files (multi-file ApplyPatch). Present only with two
       * or more paths; `filePath` stays the first of them.
       */
      filePaths?: readonly string[];
      /** Present together with `detail`. */
      detailKind?: ToolDetailKind;
      /** Command or plan text extracted from the tool input. */
      detail?: string;
      /** Bounded one-line Read/Grep/Glob target extracted from input. */
      target?: string;
      /**
       * Fail-soft `fireAndForget` read from an Execute tool input:
       * the CLI detached the command as a background process.
       */
      backgroundHint?: ToolBackgroundHint;
      /**
       * Delegation identity read from a Task tool call's own input
       * (`subagent_type` + `description`), never carrying a lifecycle
       * status — that stays notification/ledger authority. Present
       * from the first tool_call event so the UI can say what was
       * delegated immediately: the `child_session_available`
       * notification only surfaces with the next stream event, which
       * on the process transport is the Task's own tool_result
       * (probed 2026-08-13, 39s after tool-start).
       */
      subagent?: ToolSubagentSummary;
      /** Non-authoritative proposal from one complete native tool input. */
      operationDiff?: OperationDiff;
    }
  | {
      type: 'tool-execution-phase';
      toolUseId: string;
      toolName: string;
      phase: ToolExecutionPhase;
    }
  | {
      type: 'tool-progress';
      toolName: string;
      toolUseId: string;
      action: string;
      updateKind: ToolActivityUpdateKind;
      /**
       * Sanitized trailing command output for execute-class tools
       * (bounded to `MAX_TOOL_OUTPUT_TAIL_LENGTH`). Display-only:
       * feeds the live output preview and must never enter
       * diagnostics logs.
       */
      outputTail?: string;
    }
  | {
      type: 'tool-result';
      toolName: string;
      toolUseId: string;
      action: string;
      isError: boolean;
      /** Bounded text excerpt from a failed tool_result's content. */
      errorText?: string;
      resultPreview?: ToolResultPreview;
      operationDiff?: OperationDiff;
    }
  | {
      type: 'user-message';
      messageId: string;
    }
  | {
      /**
       * One bounded image block from the live stream: an assistant
       * `create_message` image or an image embedded in a tool result.
       * `data` is pure base64; empty means the image exceeded
       * `MAX_IMAGE_DATA_LENGTH` and only `byteLength` survives.
       */
      type: 'image-block';
      origin: ImageOrigin;
      mediaType: ImageMediaType;
      data: string;
      generated: boolean;
      byteLength: number;
      /** Message id or toolUseId anchoring the block. */
      sourceId: string;
      blockIndex: number;
    }
  | {
      type: 'working-state';
      isWorking: boolean;
      compacting?: boolean;
    }
  | {
      type: 'settings-updated';
    }
  | {
      /**
       * A ProceedNewSession* spec approval handed implementation off to
       * a fresh Droid session. Emitted before `turn-complete` so the
       * host can adopt the implementation session once the turn ends.
       */
      type: 'spec-handoff';
      implementationSessionId: string;
    }
  | {
      /**
       * The active turn delegated work to a subagent (Task tool),
       * projected from the `child_session_available` session
       * notification. The child session id is dropped here on
       * purpose so it never leaves the Runtime.
       */
      type: 'subagent-started';
      /** Parent Task tool call this subagent hangs under, if known. */
      toolUseId: string | null;
      subagentType: string;
      description: string;
      startedAt?: number;
    }
  | {
      /**
       * Cumulative session token totals from one `token_usage_update`
       * stream event (the CLI pushes 2-4 per turn). The stream conversion
       * drops `factoryCredits`, so it is never present here.
       */
      type: 'token-usage';
      cumulative: TokenUsageBreakdown;
    }
  | {
      type: 'error';
      /** SDK error text; the Host sanitizes it before displaying it. */
      message?: string;
    }
  | {
      type: 'turn-complete';
      outcome:
        | 'success'
        | 'interrupted'
        | 'error_during_execution'
        | 'error_structured_output';
      /** Some SDK failures only carry their cause on the final result. */
      errorMessage?: string;
      /**
       * This turn's own consumption from `result.tokenUsage`
       * (per-turn, not cumulative). Absent when the SDK reported
       * `null` or an invalid shape.
       */
      turnUsage?: TokenUsageBreakdown;
    };
