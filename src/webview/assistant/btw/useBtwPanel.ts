import { useCallback, useEffect, useState } from 'react';

import {
  MAX_BTW_TEXT_LENGTH,
  type BtwAskMessage,
  type BtwPrepareMessage,
  type BtwStopMessage,
} from '../../../shared/protocol/btwProtocol';
import { fitSelectionQuote } from './selectionQuote';

interface MessagePort {
  postMessage(message: BtwPrepareMessage | BtwAskMessage | BtwStopMessage): void;
}

export function useBtwPanel(vscode: MessagePort, sessionId: string | null) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [quote, setQuote] = useState<string | null>(null);
  const [width, setWidth] = useState(320);

  useEffect(() => {
    setOpen(false);
    setDraft('');
    setQuote(null);
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
      setQuote(fitSelectionQuote(text, MAX_BTW_TEXT_LENGTH - 512 - 2));
      openPanel();
      requestAnimationFrame(() => {
        document.querySelector<HTMLTextAreaElement>('.dvx-btw-input')?.focus();
      });
    },
    [openPanel],
  );

  const ask = useCallback(
    (text: string) => {
      if (sessionId !== null) {
        vscode.postMessage({ type: 'btw.ask', sessionId, text });
      }
    },
    [sessionId, vscode],
  );

  const stop = useCallback(() => {
    if (sessionId !== null) {
      vscode.postMessage({ type: 'btw.stop', sessionId });
    }
  }, [sessionId, vscode]);
  const clearQuote = useCallback(() => setQuote(null), []);
  const dismiss = useCallback(() => setOpen(false), []);

  return {
    open,
    draft,
    quote,
    width,
    setDraft,
    setWidth,
    clearQuote,
    openPanel,
    openWithQuote,
    dismiss,
    ask,
    stop,
  };
}
