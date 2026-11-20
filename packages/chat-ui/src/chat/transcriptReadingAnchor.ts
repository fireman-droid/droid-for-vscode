/**
 * Track a character on the first visible line relative to its virtual row.
 * Row-relative coordinates leave movement of whole rows to the virtualizer and
 * history paging; only reflow inside this row is compensated here.
 */
export function createTranscriptReadingAnchor(viewport: HTMLElement) {
  let anchor: { row: HTMLElement; node: Text; offset: number; top: number } | null = null;
  const characterTop = (node: Text, offset: number) => {
    if (!node.isConnected || offset >= node.length) return undefined;
    const range = document.createRange();
    range.setStart(node, offset);
    range.setEnd(node, offset + 1);
    const rect = range.getBoundingClientRect();
    return rect.height > 0 ? rect.top : undefined;
  };
  const capture = () => {
    anchor = null;
    const bounds = viewport.getBoundingClientRect();
    if (bounds.width === 0 || bounds.height === 0) return;
    // The pinned question is an overlay, not part of the scrolling text.
    const readingTop = bounds.top + (parseFloat(viewport.style.getPropertyValue('--pinned-mask-stop')) || 0);
    for (const y of [8, 20, 36]) {
      for (const x of [0.25, 0.5, 0.75]) {
        const caret = document.caretRangeFromPoint?.(bounds.left + bounds.width * x, readingTop + y);
        if (!caret || !(caret.startContainer instanceof Text)) continue;
        const node = caret.startContainer;
        const row = node.parentElement?.closest<HTMLElement>('[data-markdown-row]');
        if (!row || !viewport.contains(row)) continue;
        const offset = Math.min(caret.startOffset, node.length - 1);
        if (offset < 0) continue;
        const top = characterTop(node, offset);
        if (top === undefined || top < readingTop - 40 || top > readingTop + 64) continue;
        anchor = { row, node, offset, top: top - row.getBoundingClientRect().top };
        return;
      }
    }
  };
  return {
    clear: () => { anchor = null; },
    capture,
    restore: (writeTop: (top: number) => void) => {
      if (anchor && viewport.contains(anchor.row) && anchor.row.contains(anchor.node)) {
        const top = characterTop(anchor.node, anchor.offset);
        if (top !== undefined) {
          const delta = top - anchor.row.getBoundingClientRect().top - anchor.top;
          if (Math.abs(delta) > 0.5) writeTop(viewport.scrollTop + delta);
        }
      }
      capture();
    },
  };
}
