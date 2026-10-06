import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { flushSync } from 'react-dom';
import { registerDiffChanges } from './diffNavigation';

type SetVisibility = (visible: boolean) => void;
type ObserveChunk = (element: HTMLElement, setVisibility: SetVisibility) => () => void;

function hasSelectedText(element: HTMLElement): boolean {
  const selection = element.ownerDocument.getSelection();
  if (!selection || selection.isCollapsed) return false;
  for (let index = 0; index < selection.rangeCount; index++)
    if (selection.getRangeAt(index).intersectsNode(element)) return true;
  return false;
}

/** Fixed-height chunks retain their scroll positions while offscreen code is released. */
export function useDeferredDiff(root: RefObject<HTMLElement | null>, enabled: boolean): ObserveChunk {
  const pending = useRef(new Map<HTMLElement, SetVisibility>());
  const observer = useRef<IntersectionObserver | null>(null);
  const ordered = useRef<HTMLElement[] | null>(null);
  useLayoutEffect(() => {
    if (!enabled || !root.current || typeof IntersectionObserver === 'undefined') return;
    const chunks = pending.current;
    let scroller: HTMLElement | null = root.current;
    // A horizontal-only scrollport also computes overflow-y:auto. Using it as
    // the root would make every row in a full-height Review diff intersect.
    while (scroller && (!/(auto|scroll)/.test(getComputedStyle(scroller).overflowY) ||
      scroller.scrollHeight <= scroller.clientHeight)) scroller = scroller.parentElement;
    const viewport = () => scroller?.getBoundingClientRect() ?? { top: 0, bottom: window.innerHeight };
    const revealViewport = () => {
      const bounds = viewport();
      if (bounds.bottom <= bounds.top) return;
      // Only locate the visible chunks: reading every chunk on every scroll
      // would make scrolling cost grow with the length of the whole file.
      const elements = ordered.current ??= [...chunks.keys()].sort((left, right) =>
        left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
      let low = 0, high = elements.length;
      while (low < high) {
        const middle = (low + high) >>> 1;
        if (elements[middle]!.getBoundingClientRect().bottom <= bounds.top) low = middle + 1;
        else high = middle;
      }
      for (let index = low; index < elements.length; index++) {
        const element = elements[index]!;
        if (element.getBoundingClientRect().top >= bounds.bottom) break;
        if (!element.hasChildNodes()) chunks.get(element)?.(true);
      }
    };
    const current = new IntersectionObserver((entries) => {
      const bounds = viewport();
      flushSync(() => {
        for (const entry of entries) {
          const element = entry.target as HTMLElement;
          // A queued exit can be stale after a rapid reversal. Never remove
          // rows that have already re-entered the visible viewport.
          const rectangle = entry.isIntersecting ? null : element.getBoundingClientRect();
          chunks.get(element)?.(entry.isIntersecting || !!rectangle &&
            rectangle.bottom > bounds.top && rectangle.top < bounds.bottom);
        }
      });
    }, { root: scroller, rootMargin: '600px 0px' });
    observer.current = current;
    for (const element of chunks.keys()) current.observe(element);
    // IntersectionObserver preloads/recycles offscreen rows, but it can run
    // after paint. A thumb drag or large wheel step must fill its destination
    // during the scroll event, before the browser paints an empty chunk.
    const scrollTarget = scroller ?? window;
    const onScroll = () => flushSync(revealViewport);
    scrollTarget.addEventListener('scroll', onScroll, { passive: true });
    revealViewport();
    return () => {
      current.disconnect(); observer.current = null;
      scrollTarget.removeEventListener('scroll', onScroll);
    };
  }, [root, enabled]);
  return useCallback((element, setVisibility) => {
    if (typeof IntersectionObserver === 'undefined') { setVisibility(true); return () => {}; }
    pending.current.set(element, setVisibility);
    ordered.current = null;
    observer.current?.observe(element);
    return () => { pending.current.delete(element); ordered.current = null; observer.current?.unobserve(element); };
  }, []);
}

export function DeferredDiffChunk({ count, changes, defer, observe, children }: {
  count: number; changes: readonly number[]; defer: boolean; observe: ObserveChunk; children: () => ReactNode;
}) {
  const element = useRef<HTMLDivElement>(null);
  const [nearby, setNearby] = useState(!defer);
  const [selected, setSelected] = useState(false);
  useLayoutEffect(() => {
    if (element.current) return registerDiffChanges(element.current, changes, count);
  }, [changes, count]);
  useLayoutEffect(() => {
    if (!defer || !element.current) return;
    return observe(element.current, (visible) => {
      // Keep the DOM backing a native text selection until copying/selection
      // finishes, even when its first rows have scrolled out of view.
      if (!visible && element.current) setSelected(hasSelectedText(element.current));
      setNearby(visible);
    });
  }, [defer, observe]);
  useEffect(() => {
    if (!selected || !element.current) return;
    const document = element.current.ownerDocument;
    const release = () => {
      if (!element.current || !hasSelectedText(element.current)) setSelected(false);
    };
    document.addEventListener('selectionchange', release);
    return () => document.removeEventListener('selectionchange', release);
  }, [selected]);
  const visible = nearby || selected || !defer;
  return <div ref={element} data-diff-changes={changes.length ? '' : undefined} className="review-diff-chunk"
    style={{ height: `calc(${count} * var(--diff-line-height, 22px))` }}>
    {visible ? children() : null}
  </div>;
}
