import { useLayoutEffect, type ClipboardEvent, type PointerEvent, type RefObject } from 'react';

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

  const onCopy = (event: ClipboardEvent<HTMLDivElement>) => {
    if (!rows) return;
    const diff = event.currentTarget;
    const selection = diff.ownerDocument.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount ||
      !diff.contains(selection.anchorNode) || !diff.contains(selection.focusNode)) return;
    const side = cellAt(diff, selection.anchorNode)?.dataset.side;
    if (side !== 'left' && side !== 'right') return;
    const range = selection.getRangeAt(0);
    let first: { row: number; offset: number } | undefined;
    let last: { row: number; offset: number } | undefined;
    for (const code of diff.querySelectorAll<HTMLElement>(`.review-diff-cell[data-side='${side}'] code`)) {
      const row = Number(code.closest<HTMLElement>('[data-diff-row]')!.dataset.diffRow);
      const line = rows[row]?.[side];
      if (!line || !range.intersectsNode(code)) continue;
      const selected = diff.ownerDocument.createRange();
      selected.selectNodeContents(code);
      if (range.compareBoundaryPoints(Range.START_TO_START, selected) > 0)
        selected.setStart(range.startContainer, range.startOffset);
      if (range.compareBoundaryPoints(Range.END_TO_END, selected) < 0)
        selected.setEnd(range.endContainer, range.endOffset);
      // A selection ending at the next line's start still includes the newline.
      if (selected.collapsed && !(first && code.contains(range.endContainer))) continue;
      const prefix = diff.ownerDocument.createRange();
      prefix.selectNodeContents(code);
      prefix.setEnd(selected.startContainer, selected.startOffset);
      const start = Math.min(prefix.toString().length, line.text.length);
      const end = Math.min(start + selected.toString().length, line.text.length);
      first ??= { row, offset: start };
      last = { row, offset: end };
    }
    if (!first || !last) return;
    // Read the selected side's source rows, including any deferred chunks between
    // the endpoints. Gutters, alignment placeholders and hunk labels are not code.
    const text: string[] = [];
    for (let index = first.row; index <= last.row; index++) {
      const line = rows[index]?.[side];
      if (line) text.push(line.text.slice(index === first.row ? first.offset : 0,
        index === last.row ? last.offset : undefined));
    }
    event.clipboardData.setData('text/plain', text.join('\n'));
    event.preventDefault();
  };

  return { onPointerDownCapture, onCopy };
}
