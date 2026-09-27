import { useCallback, useEffect, useRef, useState } from 'react';
import { formatSelectionQuotes } from '@droidvisx/chat-ui/chat/selectionQuote';
import {
  MAX_BTW_TEXT_LENGTH, EMPTY_SESSION_BTW_STATE,
  type BtwAskMessage, type BtwPrepareMessage, type BtwStopMessage,
  type BtwAskOptions, type SessionBtwState,
} from '../../../shared/protocol/btwProtocol';
import { useBtwImages } from '../useBtwImages';

interface MessagePort {
  postMessage(message: BtwPrepareMessage | BtwAskMessage | BtwStopMessage): void | Promise<void>;
}
interface PendingDraft {
  readonly text: string;
  readonly draft: string;
  readonly quotes: readonly string[];
  readonly options: BtwAskOptions;
  readonly entryIds: ReadonlySet<string>;
}
const ACCEPTANCE_TIMEOUT_MS = 5_000;
const UNCONFIRMED_NOTICE = 'The side question has not been confirmed. Your draft is kept; check the conversation before trying again.';
const emptyDraft = (sessionId: string | null) => ({
  sessionId, open: false, draft: '', quotes: [] as readonly string[],
  notice: null as string | null, chosenModel: null as string | null,
  pending: null as PendingDraft | null,
});

/** The bound session owns all unsent BTW input; hiding its view does not dispose it. */
export function useBtwPanel(vscode: MessagePort, sessionId: string | null, {
  state = EMPTY_SESSION_BTW_STATE, defaultModelId, available = true,
}: { readonly state?: SessionBtwState; readonly defaultModelId?: string; readonly available?: boolean } = {}) {
  const [local, setLocal] = useState(() => emptyDraft(sessionId));
  const [width, setWidth] = useState(320);
  if (local.sessionId !== sessionId) setLocal(emptyDraft(sessionId));
  const unavailable = !available || state.status === 'error' || state.status === 'unsupported';
  const images = useBtwImages(sessionId, unavailable);
  const selectedModel = local.chosenModel ?? defaultModelId;
  const pendingRef = useRef<PendingDraft | null>(null);
  pendingRef.current = local.sessionId === sessionId ? local.pending : null;

  const update = useCallback((change: (current: typeof local) => typeof local) => {
    setLocal((current) => current.sessionId === sessionId ? change(current) : current);
  }, [sessionId]);
  const setDraft = useCallback((draft: string) => update((current) => ({ ...current, draft })), [update]);
  const setChosenModel = useCallback((chosenModel: string) => update((current) => ({ ...current, chosenModel })), [update]);
  const clearQuote = useCallback(() => update((current) => ({ ...current, quotes: [], notice: null })), [update]);
  const removeQuote = useCallback((index: number) => update((current) => ({
    ...current, quotes: current.quotes.filter((_, position) => position !== index), notice: null,
  })), [update]);
  const dismiss = useCallback(() => update((current) => ({ ...current, open: false })), [update]);

  const openPanel = useCallback(() => {
    if (sessionId === null || !available) return;
    update((current) => ({ ...current, open: true }));
    void vscode.postMessage({ type: 'btw.prepare', sessionId });
  }, [sessionId, available, update, vscode]);

  const openWithQuote = useCallback((text: string) => {
    if (sessionId === null || !available) return;
    update((current) => {
      const quotes = text.trim() ? [...current.quotes, text] : current.quotes;
      return formatSelectionQuotes(quotes, current.draft).length > MAX_BTW_TEXT_LENGTH - Math.max(0, 512 - current.draft.length)
        ? { ...current, notice: 'This selection is too long to add in full. Select less text or remove another quote.' }
        : { ...current, quotes, notice: null };
    });
    openPanel();
    requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('.dvx-btw-input')?.focus());
  }, [sessionId, available, openPanel, update]);

  // /btw from the main composer sends its own text and never consumes the side draft.
  const ask = useCallback((text: string, options?: BtwAskOptions) => {
    if (sessionId !== null) void vscode.postMessage({ type: 'btw.ask', sessionId, text, ...options });
  }, [sessionId, vscode]);
  const stop = useCallback(() => {
    if (sessionId !== null) void vscode.postMessage({ type: 'btw.stop', sessionId });
  }, [sessionId, vscode]);

  const sendDraft = useCallback((text: string) => {
    if (sessionId === null || unavailable || images.isReading() || pendingRef.current !== null ||
      state.pendingQuestion !== null || (!text.trim() && !images.images.length) || text.length > MAX_BTW_TEXT_LENGTH) return;
    const options: BtwAskOptions = {
      ...(selectedModel === undefined ? {} : { modelId: selectedModel }),
      ...(images.images.length ? { images: images.images } : {}),
    };
    const pending: PendingDraft = { text, draft: local.draft, quotes: local.quotes, options,
      entryIds: new Set(state.entries.map((entry) => entry.id)) };
    pendingRef.current = pending;
    update((current) => ({ ...current, pending, notice: null }));
    const failed = () => {
      if (pendingRef.current === pending) pendingRef.current = null;
      update((current) => current.pending === pending ? {
        ...current, pending: null, notice: 'The side question could not be sent. Your draft is kept; try again.',
      } : current);
    };
    try {
      const delivery = vscode.postMessage({ type: 'btw.ask', sessionId, text, ...options });
      if (delivery) void delivery.catch(failed);
    } catch {
      failed();
    }
  }, [sessionId, unavailable, images, state, selectedModel, local.draft, local.quotes, update, vscode]);

  useEffect(() => {
    const pending = local.pending;
    if (pending === null || local.sessionId !== sessionId) return;
    const timeout = setTimeout(() => {
      if (pendingRef.current === pending) pendingRef.current = null;
      update((current) => current.pending === pending ? {
        ...current, pending: null, notice: UNCONFIRMED_NOTICE,
      } : current);
    }, ACCEPTANCE_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, [local.pending, local.sessionId, sessionId, update]);

  useEffect(() => {
    const pending = local.pending;
    if (pending === null || local.sessionId !== sessionId) return;
    const matches = (question: string | null, modelId: string | undefined, attached: readonly { id: string }[] | undefined) =>
      question === pending.text && modelId === pending.options.modelId &&
      (attached ?? []).map((image) => image.id).join('\0') === (pending.options.images ?? []).map((image) => image.id).join('\0');
    const entry = state.entries.find((item) => !pending.entryIds.has(item.id) && matches(item.question, item.modelId, item.images));
    const accepted = entry !== undefined && entry.state !== 'error' ||
      matches(state.pendingQuestion, state.pendingModelId, state.pendingImages);
    if (!accepted && !unavailable && entry?.state !== 'error') return;
    if (pendingRef.current === pending) pendingRef.current = null;
    if (accepted) images.sent((pending.options.images ?? []).map((image) => image.id));
    update((current) => current.pending !== pending ? current : {
      ...current, pending: null,
      draft: accepted && current.draft === pending.draft ? '' : current.draft,
      quotes: accepted && current.quotes === pending.quotes ? [] : current.quotes,
      notice: accepted ? null : UNCONFIRMED_NOTICE,
    });
  }, [local.pending, local.sessionId, sessionId, state, unavailable, images, update]);

  return {
    open: local.open, draft: local.draft, quote: local.quotes.length ? local.quotes.join('\n\n') : null,
    quotes: local.quotes, notice: local.pending ? 'Sending side question…' : local.notice,
    width, setDraft, setWidth, clearQuote, removeQuote, openPanel, openWithQuote, dismiss, ask, stop,
    selectedModel, setChosenModel, images, sendDraft, sending: local.pending !== null,
  };
}
