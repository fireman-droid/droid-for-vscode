import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';

type Reveal = () => void;
type ObserveChunk = (element: HTMLElement, reveal: Reveal) => () => void;

/** One observer per diff; revealed chunks stay mounted so selection and wrapping remain native. */
export function useDeferredDiff(root: RefObject<HTMLElement | null>, enabled: boolean): ObserveChunk {
  const pending = useRef(new Map<HTMLElement, Reveal>());
  const observer = useRef<IntersectionObserver | null>(null);
  useEffect(() => {
    if (!enabled || !root.current || typeof IntersectionObserver === 'undefined') return;
    const chunks = pending.current;
    let scroller: HTMLElement | null = root.current;
    while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
    const current = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const element = entry.target as HTMLElement;
        chunks.get(element)?.();
        chunks.delete(element);
        current.unobserve(element);
      }
    }, { root: scroller, rootMargin: '600px 0px' });
    observer.current = current;
    for (const element of chunks.keys()) current.observe(element);
    return () => { current.disconnect(); observer.current = null; };
  }, [root, enabled]);
  return useCallback((element, reveal) => {
    if (typeof IntersectionObserver === 'undefined') { reveal(); return () => {}; }
    pending.current.set(element, reveal);
    observer.current?.observe(element);
    return () => { pending.current.delete(element); observer.current?.unobserve(element); };
  }, []);
}

export function DeferredDiffChunk({ count, defer, split, observe, children }: {
  count: number; defer: boolean; split: boolean; observe: ObserveChunk; children: () => ReactNode;
}) {
  const element = useRef<HTMLDivElement>(null);
  const [revealed, setRevealed] = useState(!defer);
  useEffect(() => {
    if (revealed || !defer || !element.current) return;
    return observe(element.current, () => setRevealed(true));
  }, [revealed, defer, observe]);
  const visible = revealed || !defer;
  // Once revealed, split rows keep native layout so resizing reflows all
  // wrapped lines. Unified rows have fixed line height and can skip painting
  // offscreen chunks without stale width-dependent height estimates.
  return <div ref={element} className="review-diff-chunk" style={visible
    ? split ? undefined : { contentVisibility: 'auto', containIntrinsicBlockSize: `auto calc(${count} * 1lh)` }
    : { height: `calc(${count} * 1lh)` }}>
    {visible ? children() : null}
  </div>;
}
