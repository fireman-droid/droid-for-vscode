import { useSyncExternalStore, type RefObject } from 'react';

function subscribe(listener: () => void) {
  document.addEventListener('selectionchange', listener);
  return () => document.removeEventListener('selectionchange', listener);
}

const EDITABLE_SELECTION = '[data-composer-surface],textarea,input,select,[contenteditable]:not([contenteditable="false"])';
const EXCLUDED_SELECTION = `${EDITABLE_SELECTION},[data-transcript-selection-exclude],[data-webview-overlay]`;
const SELECTION_CONTROL = 'button,[data-slot="button"],label,[role="button"],[role="combobox"],[role="option"],[role="tab"],[role="menuitem"],[role="checkbox"],[role="radio"],[role="switch"]';

/** One boundary for the quote toolbar, sticky ownership and scroll protection. */
export function readTranscriptSelection(root: HTMLElement | null): Selection | null {
  const selection = window.getSelection();
  if (!root || !selection || selection.isCollapsed || selection.rangeCount !== 1) return null;
  for (const node of [selection.anchorNode, selection.focusNode]) {
    if (!node || !root.contains(node)) return null;
    const element = node instanceof Element ? node : node.parentElement;
    if (!element || element.closest(EXCLUDED_SELECTION) || getComputedStyle(element).userSelect === 'none') return null;
    const control = element.closest(SELECTION_CONTROL);
    if (control && control.getAttribute('data-text-selectable') !== 'true') return null;
  }
  const range = selection.getRangeAt(0);
  const ancestor = range.commonAncestorContainer;
  if (ancestor instanceof Element && Array.from(ancestor.querySelectorAll(EDITABLE_SELECTION))
    .some((element) => range.intersectsNode(element))) return null;
  return selection;
}

export function hasTranscriptSelection(root: HTMLElement | null): boolean {
  return readTranscriptSelection(root) !== null;
}

export function useTranscriptSelection(root: RefObject<HTMLElement | null>): boolean {
  return useSyncExternalStore(subscribe, () => hasTranscriptSelection(root.current), () => false);
}

/** Retain selected rows when the reader scrolls them outside the virtual window. */
export function selectedTurnIndexes(root: HTMLElement | null): number[] {
  if (!hasTranscriptSelection(root)) return [];
  const selection = window.getSelection()!;
  const index = (node: Node | null) => {
    const element = node instanceof Element ? node : node?.parentElement;
    const row = element?.closest<HTMLElement>('[data-index],[data-selection-turn]');
    return row ? Number(row.dataset.index ?? row.dataset.selectionTurn) : undefined;
  };
  const start = index(selection.anchorNode), end = index(selection.focusNode);
  if (start === undefined || end === undefined) return [];
  return Array.from({ length: Math.abs(end - start) + 1 }, (_, offset) => Math.min(start, end) + offset);
}
