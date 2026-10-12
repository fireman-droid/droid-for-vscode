import { useEffect, type RefObject } from 'react';

type Side = 'left' | 'right';
interface Drag {
  id: number; side: Side; x: number; y: number; startX: number; startY: number; moved: boolean;
}

function cellAt(diff: HTMLElement, node: Node | null): HTMLElement | null {
  const element = node instanceof Element ? node : node?.parentElement;
  const cell = element?.closest<HTMLElement>('.review-diff-cell');
  return cell && diff.contains(cell) ? cell : null;
}

/** The code is translated, so native text selection cannot scroll the detached scrollbar. */
export function useSplitDiffDragScroll(root: RefObject<HTMLDivElement | null>, scrollbars: RefObject<Array<HTMLDivElement | null>>) {
  useEffect(() => {
    const diff = root.current;
    const document = diff?.ownerDocument;
    const view = document?.defaultView;
    if (!diff || !document || !view) return;
    let drag: Drag | null = null;
    let frame = 0;
    let previousTime = 0;
    const stop = () => {
      drag = null;
      view.cancelAnimationFrame(frame);
      frame = 0;
      previousTime = 0;
    };
    const tick = (time: number) => {
      frame = 0;
      const elapsed = previousTime ? Math.min(32, time - previousTime) : 16;
      previousTime = 0;
      if (!drag?.moved) return;
      const selection = document.getSelection();
      if (!selection?.anchorNode || cellAt(diff, selection.anchorNode)?.dataset.side !== drag.side) return;
      const scrollbar = scrollbars.current[drag.side === 'left' ? 0 : 1];
      if (!scrollbar) return;
      const bounds = scrollbar.getBoundingClientRect();
      const left = Math.max(0, bounds.left);
      const right = Math.min(view.innerWidth, bounds.right);
      const edge = Math.min(24, (right - left) / 2);
      if (edge <= 0) return;
      const velocity = drag.x < left + edge ? -Math.min(1, (left + edge - drag.x) / edge)
        : drag.x > right - edge ? Math.min(1, (drag.x - right + edge) / edge) : 0;
      if (!velocity) return;
      const previous = scrollbar.scrollLeft;
      scrollbar.scrollLeft += velocity * elapsed * 0.8;
      const side = drag.side === 'left' ? 'before' : 'after';
      // Apply the offset before hit-testing the newly revealed text. Waiting for
      // the scroll event would extend the selection using the previous frame.
      diff.style.setProperty(`--diff-${side}-scroll`, `${-scrollbar.scrollLeft}px`);
      const caret = document.caretPositionFromPoint(Math.max(left + 1, Math.min(right - 1, drag.x)), drag.y);
      if (caret && cellAt(diff, caret.offsetNode)?.dataset.side === drag.side) {
        const element = caret.offsetNode instanceof Element ? caret.offsetNode : caret.offsetNode.parentElement;
        if (element?.closest('code')) selection.extend(caret.offsetNode, caret.offset);
      }
      if (scrollbar.scrollLeft !== previous) {
        previousTime = time;
        frame = view.requestAnimationFrame(tick);
      }
    };
    const start = (event: PointerEvent) => {
      if (event.button !== 0 || !event.isPrimary || event.pointerType === 'touch') return;
      stop();
      const target = event.target instanceof Element ? event.target : null;
      if (!target?.closest('.review-diff-code')) return;
      const selection = document.getSelection();
      const cell = event.shiftKey && selection && !selection.isCollapsed
        ? cellAt(diff, selection.anchorNode) : cellAt(diff, target);
      const side = cell?.dataset.side;
      if (side !== 'left' && side !== 'right') return;
      drag = { id: event.pointerId, side, x: event.clientX, y: event.clientY,
        startX: event.clientX, startY: event.clientY, moved: false };
    };
    const move = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.id) return;
      if (!(event.buttons & 1)) { stop(); return; }
      drag.x = event.clientX;
      drag.y = event.clientY;
      drag.moved ||= Math.hypot(drag.x - drag.startX, drag.y - drag.startY) >= 3;
      if (drag.moved && !frame) frame = view.requestAnimationFrame(tick);
    };
    const finish = (event: PointerEvent) => { if (event.pointerId === drag?.id) stop(); };
    const hidden = () => { if (document.hidden) stop(); };
    diff.addEventListener('pointerdown', start);
    diff.addEventListener('dragstart', stop);
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', finish);
    document.addEventListener('pointercancel', finish);
    document.addEventListener('visibilitychange', hidden);
    view.addEventListener('blur', stop);
    return () => {
      stop();
      diff.removeEventListener('pointerdown', start);
      diff.removeEventListener('dragstart', stop);
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', finish);
      document.removeEventListener('pointercancel', finish);
      document.removeEventListener('visibilitychange', hidden);
      view.removeEventListener('blur', stop);
    };
  }, [root, scrollbars]);
}
