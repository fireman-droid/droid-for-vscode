import { MAX_BRIDGE_ID_LENGTH } from './interactionProtocol';
import { hasExactKeys } from '../validation/strictValidation';
import { isSafeModelId } from '../validation/guards';
import { isBtwImages, isBtwImageSummaries, type BtwImage, type BtwImageSummary } from './btwAttachments';

export interface BtwAskOptions {
  readonly images?: readonly BtwImage[];
  readonly modelId?: string;
}

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
/** Bounded SDK-provided thinking text, independent of the answer budget. */
export const MAX_BTW_THINKING_LENGTH = 32_000;
/** Longest status message shown on the card (error/unsupported). */
export const MAX_BTW_MESSAGE_LENGTH = 512;

export const BTW_STATUSES = ['idle', 'forking', 'ready', 'error', 'unsupported'] as const;
export type BtwStatus = (typeof BTW_STATUSES)[number];

export const BTW_ENTRY_STATES = ['streaming', 'done', 'error'] as const;
export type BtwEntryState = (typeof BTW_ENTRY_STATES)[number];

export const BTW_ENTRY_PROGRESS = ['waiting', 'thinking', 'tool', 'answering'] as const;
export type BtwEntryProgress = (typeof BTW_ENTRY_PROGRESS)[number];

/** One question/answer pair on the side-chat card. */
export interface BtwEntry {
  readonly id: string;
  readonly question: string;
  readonly images?: readonly BtwImageSummary[];
  readonly modelId?: string;
  /** Accumulated answer text, bounded to MAX_BTW_ANSWER_LENGTH. */
  readonly answer: string;
  readonly thinking?: string;
  readonly thinkingTruncated?: boolean;
  readonly state: BtwEntryState;
  /** Current activity, separate from retained thinking and answer text. */
  readonly progress?: BtwEntryProgress;
  /** Quiet error copy for `state: 'error'` (e.g. permission guidance). */
  readonly message: string | null;
}

/** Whole-card state snapshot projected by the host. */
export interface SessionBtwState {
  readonly status: BtwStatus;
  readonly entries: readonly BtwEntry[];
  readonly message: string | null;
  /** At most one follow-up waiting for the streaming answer to settle. */
  readonly pendingQuestion: string | null;
  readonly pendingImages?: readonly BtwImageSummary[];
  readonly pendingModelId?: string;
}

/** Webview → Host: prepare the hidden fork when the pane opens. */
export interface BtwPrepareMessage {
  readonly type: 'btw.prepare';
  readonly sessionId: string;
}

/** Webview → Host: ask one side question (prepares as a fallback). */
export interface BtwAskMessage extends BtwAskOptions {
  readonly type: 'btw.ask';
  readonly sessionId: string;
  readonly text: string;
}

/** Webview → Host: explicitly discard the fork; hiding the panel does not send this. */
export interface BtwDismissMessage {
  readonly type: 'btw.dismiss';
  readonly sessionId: string;
}

/** Webview → Host: stop the streaming side answer (keeps the fork). */
export interface BtwStopMessage {
  readonly type: 'btw.stop';
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
  pendingQuestion: null,
};

function isId(value: unknown): value is string {
  return (
    typeof value === 'string' && value.length > 0 && value.length <= MAX_BRIDGE_ID_LENGTH
  );
}

function isBoundedString(value: unknown, maximumLength: number): value is string {
  return typeof value === 'string' && value.length <= maximumLength;
}

function isNonEmptyBoundedString(value: unknown, maximumLength: number): value is string {
  return isBoundedString(value, maximumLength) && value.length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function parseBtwAskMessage(value: unknown): BtwAskMessage | null {
  if (
    !isRecord(value) ||
    value.type !== 'btw.ask' ||
    !hasExactKeys(value, ['type', 'sessionId', 'text'], ['images', 'modelId']) ||
    !isId(value.sessionId) ||
    !isBoundedString(value.text, MAX_BTW_TEXT_LENGTH) ||
    (value.images !== undefined && !isBtwImages(value.images)) ||
    (value.modelId !== undefined && !isSafeModelId(value.modelId)) ||
    (!value.text.trim() && !(Array.isArray(value.images) && value.images.length))
  ) {
    return null;
  }
  return {
    type: 'btw.ask',
    sessionId: value.sessionId,
    text: value.text,
    ...(value.images === undefined ? {} : { images: value.images as readonly BtwImage[] }),
    ...(value.modelId === undefined ? {} : { modelId: value.modelId as string }),
  };
}

export function parseBtwPrepareMessage(value: unknown): BtwPrepareMessage | null {
  if (
    !isRecord(value) ||
    value.type !== 'btw.prepare' ||
    !hasExactKeys(value, ['type', 'sessionId']) ||
    !isId(value.sessionId)
  ) {
    return null;
  }
  return { type: 'btw.prepare', sessionId: value.sessionId };
}

export function parseBtwDismissMessage(value: unknown): BtwDismissMessage | null {
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

export function parseBtwStopMessage(value: unknown): BtwStopMessage | null {
  if (
    !isRecord(value) ||
    value.type !== 'btw.stop' ||
    !hasExactKeys(value, ['type', 'sessionId']) ||
    !isId(value.sessionId)
  ) {
    return null;
  }
  return { type: 'btw.stop', sessionId: value.sessionId };
}

function parseBtwEntry(value: unknown, seenIds: Set<string>): BtwEntry | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['id', 'question', 'answer', 'state'], ['message', 'progress', 'images', 'modelId', 'thinking', 'thinkingTruncated']) ||
    !isId(value.id) ||
    seenIds.has(value.id) ||
    !isBoundedString(value.question, MAX_BTW_TEXT_LENGTH) ||
    (value.images !== undefined && !isBtwImageSummaries(value.images)) ||
    (value.modelId !== undefined && !isSafeModelId(value.modelId)) ||
    (!value.question.length && !(Array.isArray(value.images) && value.images.length)) ||
    !isBoundedString(value.answer, MAX_BTW_ANSWER_LENGTH) ||
    (value.thinking !== undefined && !isBoundedString(value.thinking, MAX_BTW_THINKING_LENGTH)) ||
    (value.thinkingTruncated !== undefined && typeof value.thinkingTruncated !== 'boolean') ||
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
  if (
    value.progress !== undefined &&
    !BTW_ENTRY_PROGRESS.includes(value.progress as BtwEntryProgress)
  ) {
    return null;
  }
  seenIds.add(value.id);
  return {
    id: value.id,
    question: value.question,
    ...(value.images === undefined ? {} : { images: value.images as readonly BtwImageSummary[] }),
    ...(value.modelId === undefined ? {} : { modelId: value.modelId as string }),
    answer: value.answer,
    ...(value.thinking === undefined ? {} : { thinking: value.thinking as string }),
    ...(value.thinkingTruncated === undefined ? {} : { thinkingTruncated: value.thinkingTruncated as boolean }),
    state: value.state as BtwEntryState,
    ...(value.progress === undefined ? {} : { progress: value.progress as BtwEntryProgress }),
    message: value.message ?? null,
  };
}

export function parseSessionBtwMessage(value: unknown): SessionBtwMessage | null {
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
    !hasExactKeys(btw, ['status', 'entries'], ['message', 'pendingQuestion', 'pendingImages', 'pendingModelId']) ||
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
  if (
    btw.pendingQuestion !== undefined &&
    btw.pendingQuestion !== null &&
    !isBoundedString(btw.pendingQuestion, MAX_BTW_TEXT_LENGTH)
  ) {
    return null;
  }
  if ((btw.pendingImages !== undefined && !isBtwImageSummaries(btw.pendingImages)) ||
    (btw.pendingModelId !== undefined && !isSafeModelId(btw.pendingModelId)) ||
    (btw.pendingQuestion === '' && !(Array.isArray(btw.pendingImages) && btw.pendingImages.length))) return null;
  return {
    type: 'session.btw',
    sequence: value.sequence,
    sessionId: value.sessionId,
    btw: {
      status: btw.status as BtwStatus,
      entries,
      message: btw.message ?? null,
      pendingQuestion: btw.pendingQuestion ?? null,
      ...(btw.pendingImages === undefined ? {} : { pendingImages: btw.pendingImages as readonly BtwImageSummary[] }),
      ...(btw.pendingModelId === undefined ? {} : { pendingModelId: btw.pendingModelId as string }),
    },
  };
}
