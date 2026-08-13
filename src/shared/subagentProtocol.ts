import type { SessionTranscriptItem } from './bridgeMessages';
import { MAX_BRIDGE_ID_LENGTH } from './interactionProtocol';
import { hasExactKeys } from './strictValidation';

/**
 * Subagent panel bridge contract (待办 B slice 1;
 * subagent-transcript-playback-design.md §6.1 + the per-row stop and
 * live-activity extensions of mission-control-feasibility.md §0.8).
 *
 * Privacy invariant carried over from the existing subagent
 * projections: the child session id NEVER crosses the bridge. The
 * webview addresses a delegation exclusively by its parent-session
 * `toolUseId`; the host resolves `toolUseId → childSessionId` from
 * the invocation ledger and keeps that mapping to itself. Both
 * validators delegate here so the shape rules live once.
 */

/** Longest live-activity label (last tool name inside the child). */
export const MAX_SUBAGENT_ACTIVITY_LENGTH = 64;
/** Longest transcript-sheet title (sanitized description). */
export const MAX_SUBAGENT_SHEET_TITLE_LENGTH = 512;

/** Webview → Host: open the read-only transcript of one delegation. */
export interface SubagentOpenTranscriptMessage {
  readonly type: 'subagent.openTranscript';
  /** Parent session the Task row belongs to. */
  readonly sessionId: string;
  readonly toolUseId: string;
}

/** Webview → Host: stop one running delegation (daemon-backed). */
export interface SubagentStopMessage {
  readonly type: 'subagent.stop';
  readonly sessionId: string;
  readonly turnId: string;
  readonly toolUseId: string;
}

/**
 * Webview → Host: the working popup opened or closed; gates the
 * host-side live-activity polling so closed panels cost nothing.
 */
export interface SubagentPanelMessage {
  readonly type: 'subagent.panel';
  readonly sessionId: string;
  readonly open: boolean;
}

export const SUBAGENT_TRANSCRIPT_STATUSES = [
  'available',
  'unavailable',
] as const;
export type SubagentTranscriptStatus =
  (typeof SUBAGENT_TRANSCRIPT_STATUSES)[number];

/**
 * Host → Webview: the read-only transcript of one delegation, or the
 * quiet fail-closed refusal. `items` reuses the exact transcript item
 * shape (and, webview-side, the exact validator) of
 * `host.snapshot.transcript`.
 */
export interface SubagentTranscriptMessage {
  readonly type: 'subagent.transcript';
  readonly sequence: number;
  /** Parent session the request addressed. */
  readonly sessionId: string;
  readonly toolUseId: string;
  readonly status: SubagentTranscriptStatus;
  /** Sheet heading: the delegation's sanitized description or type. */
  readonly title: string;
  /** Present only when status is `available`. */
  readonly items?: readonly SessionTranscriptItem[];
  /** Present only when status is `available`. */
  readonly truncated?: boolean;
}

/**
 * Host → Webview: live activity of one running delegation — the last
 * tool observed inside the child session — plus whether the host can
 * actually stop it (daemon reachable and the child id resolved).
 * `stoppable: false` means the row renders no stop control at all
 * (user decision 2026-08-12: no disabled placeholders).
 */
export interface SubagentActivityMessage {
  readonly type: 'subagent.activity';
  readonly sequence: number;
  readonly sessionId: string;
  readonly turnId: string;
  readonly toolUseId: string;
  readonly action: string | null;
  readonly stoppable: boolean;
}

function isId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_BRIDGE_ID_LENGTH
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function parseSubagentOpenTranscriptMessage(
  value: unknown,
): SubagentOpenTranscriptMessage | null {
  if (
    !isRecord(value) ||
    value.type !== 'subagent.openTranscript' ||
    !hasExactKeys(value, ['type', 'sessionId', 'toolUseId']) ||
    !isId(value.sessionId) ||
    !isId(value.toolUseId)
  ) {
    return null;
  }
  return {
    type: 'subagent.openTranscript',
    sessionId: value.sessionId,
    toolUseId: value.toolUseId,
  };
}

export function parseSubagentStopMessage(
  value: unknown,
): SubagentStopMessage | null {
  if (
    !isRecord(value) ||
    value.type !== 'subagent.stop' ||
    !hasExactKeys(value, ['type', 'sessionId', 'turnId', 'toolUseId']) ||
    !isId(value.sessionId) ||
    !isId(value.turnId) ||
    !isId(value.toolUseId)
  ) {
    return null;
  }
  return {
    type: 'subagent.stop',
    sessionId: value.sessionId,
    turnId: value.turnId,
    toolUseId: value.toolUseId,
  };
}

export function parseSubagentPanelMessage(
  value: unknown,
): SubagentPanelMessage | null {
  if (
    !isRecord(value) ||
    value.type !== 'subagent.panel' ||
    !hasExactKeys(value, ['type', 'sessionId', 'open']) ||
    !isId(value.sessionId) ||
    typeof value.open !== 'boolean'
  ) {
    return null;
  }
  return {
    type: 'subagent.panel',
    sessionId: value.sessionId,
    open: value.open,
  };
}

/**
 * One-call dispatch for the W→H family, so the host validator's
 * switch delegates in a single default-case line.
 */
export function parseSubagentWebviewMessage(
  value: unknown,
):
  | SubagentOpenTranscriptMessage
  | SubagentStopMessage
  | SubagentPanelMessage
  | null {
  return (
    parseSubagentOpenTranscriptMessage(value) ??
    parseSubagentStopMessage(value) ??
    parseSubagentPanelMessage(value)
  );
}

/**
 * H→W activity parser (transcript parsing lives webview-side; this
 * message has no transcript payload so it validates fully here).
 */
export function parseSubagentActivityMessage(
  value: unknown,
): SubagentActivityMessage | null {
  if (
    !isRecord(value) ||
    value.type !== 'subagent.activity' ||
    !hasExactKeys(value, [
      'type',
      'sequence',
      'sessionId',
      'turnId',
      'toolUseId',
      'action',
      'stoppable',
    ]) ||
    typeof value.sequence !== 'number' ||
    !Number.isFinite(value.sequence) ||
    !isId(value.sessionId) ||
    !isId(value.turnId) ||
    !isId(value.toolUseId) ||
    typeof value.stoppable !== 'boolean' ||
    (value.action !== null &&
      (typeof value.action !== 'string' ||
        value.action.length === 0 ||
        value.action.length > MAX_SUBAGENT_ACTIVITY_LENGTH))
  ) {
    return null;
  }
  return {
    type: 'subagent.activity',
    sequence: value.sequence,
    sessionId: value.sessionId,
    turnId: value.turnId,
    toolUseId: value.toolUseId,
    action: value.action,
    stoppable: value.stoppable,
  };
}
