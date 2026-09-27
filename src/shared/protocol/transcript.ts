import { type AskUserResultTranscriptItem } from './interactionProtocol';
import type { ToolTranscriptItem } from './toolProtocol';
import type { ImageTranscriptItem, SentAttachmentSummary } from './attachments';
import {
  DIAGNOSTIC_SEVERITIES,
  SUBAGENT_STATUSES,
  TOOL_ACTIVITY_STATUSES,
  TOOL_DETAIL_KINDS,
  TRANSCRIPT_THINKING_STATUSES,
  TRANSCRIPT_TOOL_STATUSES,
  WEBVIEW_DIAGNOSTIC_KINDS,
} from './bounds';

export type ToolDetailKind = (typeof TOOL_DETAIL_KINDS)[number];

export type ToolActivityStatus = (typeof TOOL_ACTIVITY_STATUSES)[number];

export type DiagnosticSeverity = (typeof DIAGNOSTIC_SEVERITIES)[number];

export type TranscriptThinkingStatus = (typeof TRANSCRIPT_THINKING_STATUSES)[number];

export type TranscriptToolStatus = (typeof TRANSCRIPT_TOOL_STATUSES)[number];

export type SubagentStatus = (typeof SUBAGENT_STATUSES)[number];

/**
 * Marks an Execute tool call the CLI launched as a detached
 * background process (`fireAndForget: true` in the tool input;
 * probed on CLI 0.193.0). Read fail-soft: the field is absent from
 * the SDK type surface, so a missing or malformed value simply means
 * no hint. The GUI never gets a process handle — this is display
 * metadata only (background-process design §2.3 keeps kill
 * fail-closed).
 */
export interface ToolBackgroundHint {
  readonly fireAndForget: boolean;
}

/**
 * Summary of the subagent one Task tool call delegated to. Data
 * comes from the `child_session_available` notification (live) and
 * `loadSession().subagentInvocations` (final/history); the child
 * session id stays in the host and never crosses the bridge.
 */
export interface ToolSubagentSummary {
  readonly type: string;
  readonly description: string;
  /** Absent until the SDK reports a lifecycle status. */
  readonly status?: SubagentStatus;
  /** Tools the subagent used; only when the SDK reported it. */
  readonly toolUseCount?: number;
  /** Subagent run duration; only when the SDK reported it. */
  readonly durationMs?: number;
  /** Recorded invocation start time in Unix milliseconds, never a UI mount time. */
  readonly startedAt?: number;
}

export type WebviewDiagnosticKind = (typeof WEBVIEW_DIAGNOSTIC_KINDS)[number];

/**
 * Boot and failure beacons from the webview. They exist so a blank or
 * frozen webview leaves a trace in the local diagnostics log instead of
 * failing silently.
 */
export interface WebviewDiagnosticMessage {
  readonly type: 'webview.diagnostic';
  readonly kind: WebviewDiagnosticKind;
  readonly detail: string;
}

export interface UserTranscriptItem {
  readonly id: string;
  readonly kind: 'user';
  readonly text: string;
  /** Recorded message time in Unix milliseconds; absent when the source has no time. */
  readonly timestamp?: number;
  /** SDK message id; present when this message can anchor a rewind. */
  readonly messageId?: string;
  /** Attachments this message was sent with; metadata only. */
  readonly attachments?: readonly SentAttachmentSummary[];
}

export interface AssistantTranscriptItem {
  readonly id: string;
  readonly kind: 'assistant';
  readonly turnId: string;
  readonly text: string;
  /** Recorded message time in Unix milliseconds, preserved across history and recovery. */
  readonly timestamp?: number;
}

export interface ThinkingTranscriptItem {
  readonly id: string;
  readonly kind: 'thinking';
  readonly turnId: string;
  readonly text: string;
  readonly status: TranscriptThinkingStatus;
  readonly durationMs?: number;
  readonly truncated: boolean;
}

export interface DiagnosticTranscriptItem {
  readonly id: string;
  readonly kind: 'diagnostic';
  readonly turnId: string | null;
  readonly severity: DiagnosticSeverity;
  readonly code: string;
  readonly message: string;
  /** See `RuntimeDiagnosticMessage.relatedSessionId`. */
  readonly relatedSessionId?: string;
}

/**
 * One workspace-relative file a turn changed. Line counts are measured
 * against the captured before-turn content, with git HEAD as the
 * history fallback; null when no textual comparison is available.
 */
export interface ChangedFileSummary {
  readonly path: string;
  readonly additions: number | null;
  readonly deletions: number | null;
}

/**
 * Per-turn ledger of the files its tools created or modified.
 * `writing` is a live-turn display flag; the host transcript and
 * replays only hold settled items (flag absent), so history replays
 * never animate a "writing" header.
 */
export interface ChangesTranscriptItem {
  readonly id: string;
  readonly kind: 'changes';
  readonly turnId: string;
  readonly files: readonly ChangedFileSummary[];
  readonly writing?: boolean;
}

export type SessionTranscriptItem =
  | UserTranscriptItem
  | AssistantTranscriptItem
  | ThinkingTranscriptItem
  | ToolTranscriptItem
  | ChangesTranscriptItem
  | AskUserResultTranscriptItem
  | DiagnosticTranscriptItem
  | ImageTranscriptItem;

export interface LatestConversationChanges {
  readonly turnId: string;
  readonly prompt: string | null;
  readonly files: readonly ChangedFileSummary[];
}

export interface AssistantDeltaMessage {
  readonly type: 'assistant.delta';
  readonly sequence: number;
  readonly sessionId: string;
  readonly turnId: string;
  readonly delta: string;
  /** Host-observed content time in Unix milliseconds, never assigned by the Webview. */
  readonly timestamp?: number;
}

export interface ThinkingDeltaMessage {
  readonly type: 'thinking.delta';
  readonly sequence: number;
  readonly sessionId: string;
  readonly turnId: string;
  readonly delta: string;
  readonly truncated: boolean;
  /**
   * 0-based thinking segment ordinal within the turn (monotonic;
   * think→tool→think turns produce segments 0 and 1). The webview
   * keys transcript items per segment so interleaved thinking keeps
   * its timeline position.
   */
  readonly segmentIndex: number;
}

export interface ThinkingCompleteMessage {
  readonly type: 'thinking.complete';
  readonly sequence: number;
  readonly sessionId: string;
  readonly turnId: string;
  readonly durationMs: number | null;
  /** Segment this completion targets; other segments stay intact. */
  readonly segmentIndex: number;
}

/**
 * Settles one delegation's subagent summary out of band — after the
 * parent turn already reached a terminal state. Background Task
 * dispatches outlive their turn (probed 2026-08-12: the invocation
 * ledger keeps them `running` for minutes after the turn ends, and
 * no session notification announces the change), so the Host's
 * post-turn ledger reconcile pushes settlements through this message
 * instead of `tool.activity`, which the webview rightly drops once
 * the turn is over. Only the `subagent` field of the addressed tool
 * row may change.
 */
export interface SubagentUpdateMessage {
  readonly type: 'subagent.update';
  readonly sequence: number;
  readonly sessionId: string;
  readonly turnId: string;
  readonly toolUseId: string;
  readonly subagent: ToolSubagentSummary;
}

export interface RuntimeDiagnosticMessage {
  readonly type: 'runtime.diagnostic';
  readonly sequence: number;
  readonly sessionId: string | null;
  readonly turnId: string | null;
  readonly severity: DiagnosticSeverity;
  readonly code: string;
  readonly message: string;
  /**
   * Another session this diagnostic points at. Currently used by
   * `session-compacted` to carry the pre-compaction session id, which
   * the webview offers as a "View full history" jump.
   */
  readonly relatedSessionId?: string;
}
