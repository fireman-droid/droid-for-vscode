import {
  MAX_BTW_ANSWER_LENGTH,
  MAX_BTW_ENTRIES,
  type BtwEntryProgress,
  type BtwStatus,
  type SessionBtwState,
  type BtwAskOptions,
} from '../../shared/protocol/btwProtocol';
import { btwImageSummaries } from '../../shared/protocol/btwAttachments';

/**
 * Pure bounded projection of the `/btw` side-chat card the host
 * mirrors to the webview (side-question-design.md §5.3). The card is
 * ephemeral — never part of recovery snapshots — so these helpers
 * only guard the wire bounds: the entry cap drops the oldest Q&A
 * pairs and answers stop growing at the answer cap.
 */

export function setBtwStatus(
  state: SessionBtwState,
  status: BtwStatus,
  message: string | null = null,
): SessionBtwState {
  return { ...state, status, message };
}

/** Replaces or clears the card's single pending follow-up. */
export function setBtwPendingQuestion(
  state: SessionBtwState,
  pendingQuestion: string | null,
  options: BtwAskOptions = {},
): SessionBtwState {
  const { pendingImages: _images, pendingModelId: _model, ...rest } = state;
  return { ...rest, pendingQuestion, ...(options.images?.length ? { pendingImages: btwImageSummaries(options.images) } : {}),
    ...(options.modelId === undefined ? {} : { pendingModelId: options.modelId }) };
}

/** Appends one streaming question, evicting the oldest beyond cap. */
export function appendBtwQuestion(
  state: SessionBtwState,
  id: string,
  question: string,
  options: BtwAskOptions = {},
): SessionBtwState {
  const entries = [
    ...state.entries,
    {
      id,
      question,
      ...(options.images?.length ? { images: btwImageSummaries(options.images) } : {}),
      ...(options.modelId === undefined ? {} : { modelId: options.modelId }),
      answer: '',
      state: 'streaming' as const,
      progress: 'waiting' as const,
      message: null,
    },
  ];
  return {
    ...state,
    entries:
      entries.length > MAX_BTW_ENTRIES
        ? entries.slice(entries.length - MAX_BTW_ENTRIES)
        : entries,
  };
}

export function setBtwEntryProgress(
  state: SessionBtwState,
  id: string,
  progress: BtwEntryProgress,
): SessionBtwState {
  let changed = false;
  const entries = state.entries.map((entry) => {
    if (entry.id !== id || entry.state !== 'streaming' || entry.progress === progress) {
      return entry;
    }
    changed = true;
    return { ...entry, progress };
  });
  return changed ? { ...state, entries } : state;
}

/** Grows one entry's answer, truncating at the answer cap. */
export function appendBtwAnswerDelta(
  state: SessionBtwState,
  id: string,
  text: string,
): SessionBtwState {
  let changed = false;
  const entries = state.entries.map((entry) => {
    if (entry.id !== id || entry.answer.length >= MAX_BTW_ANSWER_LENGTH) {
      return entry;
    }
    changed = true;
    return {
      ...entry,
      answer: (entry.answer + text).slice(0, MAX_BTW_ANSWER_LENGTH),
      progress: 'answering' as const,
    };
  });
  return changed ? { ...state, entries } : state;
}

export function completeBtwEntry(state: SessionBtwState, id: string): SessionBtwState {
  return {
    ...state,
    entries: state.entries.map((entry) => {
      if (entry.id !== id) {
        return entry;
      }
      const { progress: _progress, ...settled } = entry;
      return { ...settled, state: 'done' as const };
    }),
  };
}

export function failBtwEntry(
  state: SessionBtwState,
  id: string,
  message: string,
): SessionBtwState {
  return {
    ...state,
    entries: state.entries.map((entry) => {
      if (entry.id !== id) {
        return entry;
      }
      const { progress: _progress, ...settled } = entry;
      return { ...settled, state: 'error' as const, message };
    }),
  };
}
