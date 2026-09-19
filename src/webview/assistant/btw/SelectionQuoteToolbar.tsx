import { SelectionToolbarPrimitive, useAui, useAuiState } from '@assistant-ui/react';
import { useLayoutEffect, useState } from 'react';

import { MAX_TURN_TEXT_LENGTH } from '../../../shared/protocol/bounds';
import { fitSelectionQuote } from './selectionQuote';

function readSelection(): {
  readonly messageId: string;
  readonly text: string;
} | null {
  const selection = window.getSelection();
  const text = selection?.toString().trim() ?? '';
  const node = selection?.anchorNode;
  const element = node instanceof HTMLElement ? node : (node?.parentElement ?? null);
  const messageId = element
    ?.closest<HTMLElement>('[data-message-id]')
    ?.getAttribute('data-message-id');
  return text.length === 0 || !messageId ? null : { messageId, text };
}

export function SelectionQuoteToolbar({
  onBtwQuote,
}: {
  readonly onBtwQuote: (quote: string) => void;
}): React.JSX.Element {
  const aui = useAui();
  const draftLength = useAuiState((state) => state.composer.text.length);
  const [toolbarElement, setToolbarElement] = useState<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    if (toolbarElement === null) {
      return;
    }
    const reposition = (): void => {
      // The primitive supplies the initial fixed position. Reset the
      // transform before measuring so repeated viewport updates do not
      // accumulate the previous correction.
      toolbarElement.style.transform = 'translate(-50%, -100%)';
      const toolbarRect = toolbarElement.getBoundingClientRect();
      const viewport = document.querySelector<HTMLElement>('.dvx-thread-viewport');
      const viewportRect = viewport?.getBoundingClientRect() ?? {
        top: 0,
        bottom: window.innerHeight,
        left: 0,
        right: window.innerWidth,
      };
      const edgeGap = 8;
      const shiftX =
        toolbarRect.left < viewportRect.left + edgeGap
          ? viewportRect.left + edgeGap - toolbarRect.left
          : toolbarRect.right > viewportRect.right - edgeGap
            ? viewportRect.right - edgeGap - toolbarRect.right
            : 0;
      const shiftY =
        toolbarRect.top < viewportRect.top + edgeGap
          ? viewportRect.top + edgeGap - toolbarRect.top
          : toolbarRect.bottom > viewportRect.bottom - edgeGap
            ? viewportRect.bottom - edgeGap - toolbarRect.bottom
            : 0;
      toolbarElement.style.transform = `translate(-50%, -100%) translate(${shiftX}px, ${shiftY}px)`;
    };
    const frame = window.requestAnimationFrame(reposition);
    const handleResize = (): void => {
      window.requestAnimationFrame(reposition);
    };
    window.addEventListener('resize', handleResize);
    window.visualViewport?.addEventListener('resize', handleResize);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', handleResize);
      window.visualViewport?.removeEventListener('resize', handleResize);
    };
  }, [toolbarElement]);
  const focusComposer = (): void => {
    requestAnimationFrame(() => {
      document.querySelector<HTMLTextAreaElement>('.dvx-composer-input')?.focus();
    });
  };
  return (
    <SelectionToolbarPrimitive.Root
      ref={setToolbarElement}
      className="dvx-selection-toolbar"
    >
      <button
        type="button"
        className="dvx-selection-toolbar-action"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          const selection = readSelection();
          if (selection === null) {
            return;
          }
          const quote = fitSelectionQuote(
            selection.text,
            Math.max(0, MAX_TURN_TEXT_LENGTH - draftLength - 2),
          );
          if (quote.length === 0) {
            return;
          }
          aui.thread.composer().setQuote({
            messageId: selection.messageId,
            text: quote,
          });
          window.getSelection()?.removeAllRanges();
          focusComposer();
        }}
      >
        Add to Chat
      </button>
      <button
        type="button"
        className="dvx-selection-toolbar-action"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          const selection = readSelection();
          if (selection === null) {
            return;
          }
          onBtwQuote(selection.text);
          window.getSelection()?.removeAllRanges();
        }}
      >
        By the Way
      </button>
    </SelectionToolbarPrimitive.Root>
  );
}
