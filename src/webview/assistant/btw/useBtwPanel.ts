import { useCallback, useEffect, useState } from 'react';

import {
  MAX_BTW_TEXT_LENGTH,
  type BtwAskMessage,
  type BtwPrepareMessage,
  type BtwStopMessage,
  type BtwAskOptions,
} from '../../../shared/protocol/btwProtocol';
import { formatSelectionQuotes } from './selectionQuote';

interface MessagePort {
  postMessage(message: BtwPrepareMessage | BtwAskMessage | BtwStopMessage): void;
}

export function useBtwPanel(vscode: MessagePort, sessionId: string | null) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [selection, setSelection] = useState<{ quotes: readonly string[]; notice: string | null }>({ quotes: [], notice: null });
  const [width, setWidth] = useState(320);

  useEffect(() => {
    setOpen(false);
    setDraft('');
    setSelection({ quotes: [], notice: null });
  }, [sessionId]);

  const openPanel = useCallback(() => {
    if (sessionId === null) {
      return;
    }
    setOpen(true);
    vscode.postMessage({ type: 'btw.prepare', sessionId });
  }, [sessionId, vscode]);

  const openWithQuote = useCallback(
    (text: string) => {
      setSelection((current) => {
        const quotes = text.trim() ? [...current.quotes, text] : current.quotes;
        const next = formatSelectionQuotes(quotes, draft);
        return next.length > MAX_BTW_TEXT_LENGTH - Math.max(0, 512 - draft.length)
          ? { ...current, notice: 'This selection is too long to add in full. Select less text or remove another quote.' }
          : { quotes, notice: null };
      });
      openPanel();
      requestAnimationFrame(() => {
        document.querySelector<HTMLTextAreaElement>('.dvx-btw-input')?.focus();
      });
    },
    [openPanel, draft],
  );

  const ask = useCallback(
    (text: string, options?: BtwAskOptions) => {
      if (sessionId !== null) {
        vscode.postMessage({ type: 'btw.ask', sessionId, text, ...options });
      }
    },
    [sessionId, vscode],
  );

  const stop = useCallback(() => {
    if (sessionId !== null) {
      vscode.postMessage({ type: 'btw.stop', sessionId });
    }
  }, [sessionId, vscode]);
  const clearQuote = useCallback(() => setSelection({ quotes: [], notice: null }), []);
  const removeQuote = useCallback((index: number) => setSelection((current) => ({
    quotes: current.quotes.filter((_, position) => position !== index), notice: null,
  })), []);
  const dismiss = useCallback(() => setOpen(false), []);

  return {
    open,
    draft,
    quote: selection.quotes.length ? selection.quotes.join('\n\n') : null,
    quotes: selection.quotes,
    notice: selection.notice,
    width,
    setDraft,
    setWidth,
    clearQuote,
    removeQuote,
    openPanel,
    openWithQuote,
    dismiss,
    ask,
    stop,
  };
}
