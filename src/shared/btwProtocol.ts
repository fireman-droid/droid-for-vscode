import { MAX_BRIDGE_ID_LENGTH } from './interactionProtocol';
import { hasExactKeys } from './strictValidation';

/**
 * `/btw` Side Chat bridge contract (side-question-design.md §5.4).
 *
 * The webview asks side questions against a hidden fork of the main
 * session; the host answers with whole-card state snapshots. Both
 * directions are strictly validated here so `validateMessage.ts`
 * (host inbound) and `validateHostMessage.ts` (webview inbound) can
 * delegate without duplicating the shape rules.
 */

/** Longest side-question text accepted from the composer. */
export const MAX_BTW_TEXT_LENGTH = 4_000;
/** Most Q&A entries kept on the side-chat card. */
export const MAX_BTW_ENTRIES = 20;
/** Bounded answer projection; longer answers are truncated. */
export const MAX_BTW_ANSWER_LENGTH = 32_000;
/** Longest status message shown on the card (error/unsupported). */
export const MAX_BTW_MESSAGE_LENGTH = 512;

export const BTW_STATUSES = [
  'idle',
  'forking',
  'ready',
  'error',
  'unsupported',
] as const;
export type BtwStatus = (typeof BTW_STATUSES)[number];

export const BTW_ENTRY_STATES = ['streaming', 'done', 'error'] as const;
export type BtwEntryState = (typeof BTW_ENTRY_STATES)[number];

/** One question/answer pair on the side-chat card. */
export interface BtwEntry {
  readonly id: string;
  readonly question: string;
  /** Accumulated answer text, bounded to MAX_BTW_ANSWER_LENGTH. */
  readonly answer: string;
  readonly state: BtwEntryState;
  /** Quiet error copy for `state: 'error'` (e.g. permission guidance). */
  readonly message: string | null;
}

/** Whole-card state snapshot projected by the host. */
export interface SessionBtwState {
  readonly status: BtwStatus;
  readonly entries: readonly BtwEntry[];
  readonly message: string | null;
}

/** Webview → Host: ask one side question (opens the fork lazily). */
export interface BtwAskMessage {
  readonly type: 'btw.ask';
  readonly sessionId: string;
  readonly text: string;
}

/** Webview → Host: card closed; discard the fork and all entries. */
export interface BtwDismissMessage {
  readonly type: 'btw.dismiss';
  readonly sessionId: string;
}

/** Host → Webview: side-chat card state snapshot. */
export interface SessionBtwMessage {
  readonly type: 'session.btw';
  readonly sequence: number;
  readonly sessionId: string;
  readonly btw: SessionBtwState;
}

export const EMPTY_SESSION_BTW_STATE: SessionBtwState = {
  status: 'idle',
  entries: [],
  message: null,
};

function isId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_BRIDGE_ID_LENGTH
  );
}

function isBoundedString(
  value: unknown,
  maximumLength: number,
): value is string {
  return typeof value === 'string' && value.length <= maximumLength;
}

function isNonEmptyBoundedString(
  value: unknown,
  maximumLength: number,
): value is string {
  return isBoundedString(value, maximumLength) && value.length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function parseBtwAskMessage(
  value: unknown,
): BtwAskMessage | null {
  if (
    !isRecord(value) ||
    value.type !== 'btw.ask' ||
    !hasExactKeys(value, ['type', 'sessionId', 'text']) ||
    !isId(value.sessionId) ||
    !isNonEmptyBoundedString(value.text, MAX_BTW_TEXT_LENGTH)
  ) {
    return null;
  }
  return {
    type: 'btw.ask',
    sessionId: value.sessionId,
    text: value.text,
  };
}

export function parseBtwDismissMessage(
  value: unknown,
): BtwDismissMessage | null {
  if (
    !isRecord(value) ||
    value.type !== 'btw.dismiss' ||
    !hasExactKeys(value, ['type', 'sessionId']) ||
    !isId(value.sessionId)
  ) {
    return null;
  }
  return { type: 'btw.dismiss', sessionId: value.sessionId };
}

function parseBtwEntry(
  value: unknown,
  seenIds: Set<string>,
): BtwEntry | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['id', 'question', 'answer', 'state'], [
      'message',
    ]) ||
    !isId(value.id) ||
    seenIds.has(value.id) ||
    !isNonEmptyBoundedString(value.question, MAX_BTW_TEXT_LENGTH) ||
    !isBoundedString(value.answer, MAX_BTW_ANSWER_LENGTH) ||
    !BTW_ENTRY_STATES.includes(value.state as BtwEntryState)
  ) {
    return null;
  }
  // Hosts serialize the shared state shape directly, so a message-less
  // entry arrives as an explicit null; both spellings mean "none".
  if (
    value.message !== undefined &&
    value.message !== null &&
    !isNonEmptyBoundedString(value.message, MAX_BTW_MESSAGE_LENGTH)
  ) {
    return null;
  }
  seenIds.add(value.id);
  return {
    id: value.id,
    question: value.question,
    answer: value.answer,
    state: value.state as BtwEntryState,
    message: value.message ?? null,
  };
}

export function parseSessionBtwMessage(
  value: unknown,
): SessionBtwMessage | null {
  if (
    !isRecord(value) ||
    value.type !== 'session.btw' ||
    !hasExactKeys(value, ['type', 'sequence', 'sessionId', 'btw']) ||
    typeof value.sequence !== 'number' ||
    !Number.isFinite(value.sequence) ||
    !isId(value.sessionId)
  ) {
    return null;
  }
  const btw = value.btw;
  if (
    !isRecord(btw) ||
    !hasExactKeys(btw, ['status', 'entries'], ['message']) ||
    !BTW_STATUSES.includes(btw.status as BtwStatus) ||
    !Array.isArray(btw.entries) ||
    btw.entries.length > MAX_BTW_ENTRIES
  ) {
    return null;
  }
  if (
    btw.message !== undefined &&
    btw.message !== null &&
    !isNonEmptyBoundedString(btw.message, MAX_BTW_MESSAGE_LENGTH)
  ) {
    return null;
  }
  const seenIds = new Set<string>();
  const entries: BtwEntry[] = [];
  for (const raw of btw.entries) {
    const entry = parseBtwEntry(raw, seenIds);
    if (entry === null) {
      return null;
    }
    entries.push(entry);
  }
  return {
    type: 'session.btw',
    sequence: value.sequence,
    sessionId: value.sessionId,
    btw: {
      status: btw.status as BtwStatus,
      entries,
      message: btw.message ?? null,
    },
  };
}
