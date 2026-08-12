import {
  ATTACHMENT_KINDS,
  MAX_ATTACHMENT_NAME_LENGTH,
  MAX_PENDING_ATTACHMENTS,
  MAX_TURN_TEXT_LENGTH,
  type AttachmentKind,
  type SentAttachmentSummary,
} from './bridgeMessages';
import { MAX_BRIDGE_ID_LENGTH } from './interactionProtocol';
import { hasExactKeys } from './strictValidation';

/**
 * Queued-messages bridge contract (queued-messages-design.md §5.1).
 *
 * While a turn is running the composer enqueues prompts on the host
 * (FIFO, host-owned); the host answers with whole-queue state
 * snapshots. Both directions are strictly validated here so
 * `validateMessage.ts` (host inbound) and `validateHostMessage.ts`
 * (webview inbound) can delegate without duplicating the shape
 * rules. `bridgeMessages.ts` must only `import type` from this
 * module: the runtime dependency points the other way (shared text
 * and attachment bounds come from the main contract).
 */

/** Most prompts the host queue holds; both sides enforce the cap. */
export const MAX_QUEUED_MESSAGES = 10;

/**
 * Why automatic dispatch is suspended. `stopped` and `turn-failed`
 * preserve user intent after Stop or a failed turn; only an explicit
 * `queue.resume` (or emptying the queue) leaves the paused state.
 * `dispatch-blocked` marks a dispatch attempt vetoed by a transient
 * guard (settings update, session operation, pending interaction).
 */
export const QUEUE_PAUSED_REASONS = [
  'stopped',
  'turn-failed',
  'dispatch-blocked',
] as const;
export type QueuePausedReason = (typeof QUEUE_PAUSED_REASONS)[number];

/**
 * One queued prompt as the webview sees it. `text` carries the full
 * prompt (inline editing needs it); attachments cross the bridge as
 * the existing bounded metadata projection only — payloads stay on
 * the host until dispatch.
 */
export interface QueuedMessageSummary {
  readonly queueId: string;
  readonly text: string;
  readonly attachments: readonly SentAttachmentSummary[];
}

/** Whole-queue projection carried by `queue.state` and snapshots. */
export interface SessionQueueState {
  readonly items: readonly QueuedMessageSummary[];
  readonly paused: QueuePausedReason | null;
}

export const EMPTY_SESSION_QUEUE_STATE: SessionQueueState = {
  items: [],
  paused: null,
};

/**
 * Webview → Host: enqueue a prompt while a turn is active. The
 * webview-generated `queueId` becomes the turn id when the prompt is
 * dispatched, so the queued card and the accepted turn correlate
 * naturally.
 */
export interface QueueAddMessage {
  readonly type: 'queue.add';
  readonly sessionId: string;
  readonly queueId: string;
  readonly text: string;
}

/** Webview → Host: replace the text of a still-queued prompt. */
export interface QueueUpdateMessage {
  readonly type: 'queue.update';
  readonly sessionId: string;
  readonly queueId: string;
  readonly text: string;
}

/** Webview → Host: drop one queued prompt. */
export interface QueueRemoveMessage {
  readonly type: 'queue.remove';
  readonly sessionId: string;
  readonly queueId: string;
}

/** Webview → Host: leave the paused state and dispatch if possible. */
export interface QueueResumeMessage {
  readonly type: 'queue.resume';
  readonly sessionId: string;
}

/** Webview → Host: drop every queued prompt. */
export interface QueueClearMessage {
  readonly type: 'queue.clear';
  readonly sessionId: string;
}

/** Host → Webview: authoritative queue state of the session. */
export interface QueueStateMessage {
  readonly type: 'queue.state';
  readonly sequence: number;
  readonly sessionId: string;
  readonly items: readonly QueuedMessageSummary[];
  readonly paused: QueuePausedReason | null;
}

function isId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_BRIDGE_ID_LENGTH
  );
}

function isQueueText(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_TURN_TEXT_LENGTH
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function parseQueueAddMessage(
  value: unknown,
): QueueAddMessage | null {
  if (
    !isRecord(value) ||
    value.type !== 'queue.add' ||
    !hasExactKeys(value, ['type', 'sessionId', 'queueId', 'text']) ||
    !isId(value.sessionId) ||
    !isId(value.queueId) ||
    !isQueueText(value.text)
  ) {
    return null;
  }
  return {
    type: 'queue.add',
    sessionId: value.sessionId,
    queueId: value.queueId,
    text: value.text,
  };
}

export function parseQueueUpdateMessage(
  value: unknown,
): QueueUpdateMessage | null {
  if (
    !isRecord(value) ||
    value.type !== 'queue.update' ||
    !hasExactKeys(value, ['type', 'sessionId', 'queueId', 'text']) ||
    !isId(value.sessionId) ||
    !isId(value.queueId) ||
    !isQueueText(value.text)
  ) {
    return null;
  }
  return {
    type: 'queue.update',
    sessionId: value.sessionId,
    queueId: value.queueId,
    text: value.text,
  };
}

export function parseQueueRemoveMessage(
  value: unknown,
): QueueRemoveMessage | null {
  if (
    !isRecord(value) ||
    value.type !== 'queue.remove' ||
    !hasExactKeys(value, ['type', 'sessionId', 'queueId']) ||
    !isId(value.sessionId) ||
    !isId(value.queueId)
  ) {
    return null;
  }
  return {
    type: 'queue.remove',
    sessionId: value.sessionId,
    queueId: value.queueId,
  };
}

export function parseQueueResumeMessage(
  value: unknown,
): QueueResumeMessage | null {
  if (
    !isRecord(value) ||
    value.type !== 'queue.resume' ||
    !hasExactKeys(value, ['type', 'sessionId']) ||
    !isId(value.sessionId)
  ) {
    return null;
  }
  return { type: 'queue.resume', sessionId: value.sessionId };
}

export function parseQueueClearMessage(
  value: unknown,
): QueueClearMessage | null {
  if (
    !isRecord(value) ||
    value.type !== 'queue.clear' ||
    !hasExactKeys(value, ['type', 'sessionId']) ||
    !isId(value.sessionId)
  ) {
    return null;
  }
  return { type: 'queue.clear', sessionId: value.sessionId };
}

function parseQueuedAttachmentSummary(
  value: unknown,
): SentAttachmentSummary | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['kind', 'name', 'sizeBytes']) ||
    typeof value.kind !== 'string' ||
    !(ATTACHMENT_KINDS as readonly string[]).includes(value.kind) ||
    typeof value.name !== 'string' ||
    value.name.length === 0 ||
    value.name.length > MAX_ATTACHMENT_NAME_LENGTH ||
    !Number.isSafeInteger(value.sizeBytes) ||
    (value.sizeBytes as number) < 0
  ) {
    return null;
  }
  return {
    kind: value.kind as AttachmentKind,
    name: value.name,
    sizeBytes: value.sizeBytes as number,
  };
}

function parseQueuedMessageSummary(
  value: unknown,
  seenIds: Set<string>,
): QueuedMessageSummary | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['queueId', 'text', 'attachments']) ||
    !isId(value.queueId) ||
    seenIds.has(value.queueId) ||
    !isQueueText(value.text) ||
    !Array.isArray(value.attachments) ||
    value.attachments.length > MAX_PENDING_ATTACHMENTS
  ) {
    return null;
  }
  const attachments: SentAttachmentSummary[] = [];
  for (const raw of value.attachments) {
    const attachment = parseQueuedAttachmentSummary(raw);
    if (attachment === null) {
      return null;
    }
    attachments.push(attachment);
  }
  seenIds.add(value.queueId);
  return { queueId: value.queueId, text: value.text, attachments };
}

function isQueuePausedReason(
  value: unknown,
): value is QueuePausedReason {
  return (
    typeof value === 'string' &&
    (QUEUE_PAUSED_REASONS as readonly string[]).includes(value)
  );
}

/**
 * Validates the `{ items, paused }` projection shared by
 * `queue.state` and the snapshot `queue` field. A paused reason with
 * no items is contradictory (the host clears the pause whenever the
 * queue empties), so it is rejected as a whole (fail closed).
 */
export function parseSessionQueueState(
  value: unknown,
): SessionQueueState | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['items', 'paused']) ||
    !Array.isArray(value.items) ||
    value.items.length > MAX_QUEUED_MESSAGES ||
    (value.paused !== null && !isQueuePausedReason(value.paused)) ||
    (value.paused !== null && value.items.length === 0)
  ) {
    return null;
  }
  const seenIds = new Set<string>();
  const items: QueuedMessageSummary[] = [];
  for (const raw of value.items) {
    const item = parseQueuedMessageSummary(raw, seenIds);
    if (item === null) {
      return null;
    }
    items.push(item);
  }
  return { items, paused: value.paused as QueuePausedReason | null };
}

export function parseQueueStateMessage(
  value: unknown,
): QueueStateMessage | null {
  if (
    !isRecord(value) ||
    value.type !== 'queue.state' ||
    !hasExactKeys(value, [
      'type',
      'sequence',
      'sessionId',
      'items',
      'paused',
    ]) ||
    typeof value.sequence !== 'number' ||
    !Number.isFinite(value.sequence) ||
    !isId(value.sessionId)
  ) {
    return null;
  }
  const state = parseSessionQueueState({
    items: value.items,
    paused: value.paused,
  });
  if (state === null) {
    return null;
  }
  return {
    type: 'queue.state',
    sequence: value.sequence,
    sessionId: value.sessionId,
    items: state.items,
    paused: state.paused,
  };
}
