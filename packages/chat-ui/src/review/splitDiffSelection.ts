import { useLayoutEffect, type PointerEvent, type RefObject } from 'react';

type Side = 'left' | 'right';
type SelectionRow = Readonly<Record<Side, { readonly text: string } | null>>;

function cellAt(root: HTMLElement, node: Node | null): HTMLElement | null {
  const element = node instanceof Element ? node : node?.parentElement;
  const cell = element?.closest<HTMLElement>('.review-diff-cell');
  return cell && root.contains(cell) ? cell : null;
}

/** Row-aligned DOM interleaves before/after text. Keep native selection on its starting side. */
export function useSplitDiffSelection(root: RefObject<HTMLDivElement | null>, rows: readonly SelectionRow[] | null, path: string) {
  const enabled = rows !== null;
  useLayoutEffect(() => {
    const diff = root.current;
    if (!diff || !enabled) return;
    const document = diff.ownerDocument;
    const update = () => {
      const selection = document.getSelection();
      const cell = cellAt(diff, selection?.anchorNode ?? null);
      if (cell) diff.dataset.selectionSide = cell.dataset.side;
      else if (!selection?.anchorNode || !diff.contains(selection.anchorNode)) delete diff.dataset.selectionSide;
    };
    update();
    document.addEventListener('selectionchange', update);
    return () => {
      document.removeEventListener('selectionchange', update);
      delete diff.dataset.selectionSide;
    };
  }, [root, enabled, path]);

  const onPointerDownCapture = (event: PointerEvent<HTMLDivElement>) => {
    if (!enabled || event.button !== 0) return;
    const diff = event.currentTarget;
    const selection = diff.ownerDocument.getSelection();
    // Shift-click extends the existing side; a fresh drag can immediately switch sides.
    const cell = event.shiftKey && selection && !selection.isCollapsed
      ? cellAt(diff, selection.anchorNode) : cellAt(diff, event.target as Node);
    if (cell) diff.dataset.selectionSide = cell.dataset.side;
    else delete diff.dataset.selectionSide;
  };

  return { onPointerDownCapture };
}
