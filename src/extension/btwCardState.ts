import {
  MAX_BTW_ANSWER_LENGTH,
  MAX_BTW_ENTRIES,
  type BtwStatus,
  type SessionBtwState,
} from '../shared/btwProtocol';

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
): SessionBtwState {
  return { ...state, pendingQuestion };
}

/** Appends one streaming question, evicting the oldest beyond cap. */
export function appendBtwQuestion(
  state: SessionBtwState,
  id: string,
  question: string,
): SessionBtwState {
  const entries = [
    ...state.entries,
    { id, question, answer: '', state: 'streaming' as const, message: null },
  ];
  return {
    ...state,
    entries:
      entries.length > MAX_BTW_ENTRIES
        ? entries.slice(entries.length - MAX_BTW_ENTRIES)
        : entries,
  };
}

/** Grows one entry's answer, truncating at the answer cap. */
export function appendBtwAnswerDelta(
  state: SessionBtwState,
  id: string,
  text: string,
): SessionBtwState {
  return {
    ...state,
    entries: state.entries.map((entry) => {
      if (entry.id !== id || entry.answer.length >= MAX_BTW_ANSWER_LENGTH) {
        return entry;
      }
      return {
        ...entry,
        answer: (entry.answer + text).slice(0, MAX_BTW_ANSWER_LENGTH),
      };
    }),
  };
}

export function completeBtwEntry(
  state: SessionBtwState,
  id: string,
): SessionBtwState {
  return {
    ...state,
    entries: state.entries.map((entry) =>
      entry.id === id ? { ...entry, state: 'done' as const } : entry,
    ),
  };
}

export function failBtwEntry(
  state: SessionBtwState,
  id: string,
  message: string,
): SessionBtwState {
  return {
    ...state,
    entries: state.entries.map((entry) =>
      entry.id === id
        ? { ...entry, state: 'error' as const, message }
        : entry,
    ),
  };
}
