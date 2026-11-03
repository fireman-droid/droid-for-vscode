import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import type { Virtualizer } from '@tanstack/react-virtual';

export interface TranscriptPaging {
  readonly version: string;
  readonly revision: number;
  readonly hasOlder: boolean;
  readonly hasNewer: boolean;
  readonly loading: 'older' | 'newer' | 'latest' | null;
  readonly error: string | null;
  readonly onRequest: (direction: 'older' | 'newer' | 'latest') => void;
}

interface Scrolling {
  readonly stopFollowing: () => void;
  readonly writeTop: (top: number) => void;
  readonly scrollToBottom: (behavior?: ScrollBehavior) => void;
  readonly follow: RefObject<{ following: boolean }>;
}
const PRELOAD_DISTANCE = 600;

/** Keep the same visible message and pixel offset when either page edge moves. */
export function useHistoryPaging(
  paging: TranscriptPaging | undefined,
  viewport: RefObject<HTMLDivElement | null>,
  rows: readonly { readonly messageIds: readonly string[] }[],
  virtualizer: Virtualizer<HTMLDivElement, Element>,
  scrolling: Scrolling,
) {
  const pending = useRef<{ version: string; revision: number; direction: 'older' | 'newer' | 'latest';
    anchors: readonly { id: string; offset: number }[] } | null>(null);
  const retryDirection = useRef<'older' | 'newer' | 'latest'>('older');
  const request = useCallback((direction: 'older' | 'newer' | 'latest') => {
    const element = viewport.current;
    if (!paging || paging.loading || pending.current || !element) return;
    scrolling.stopFollowing();
    const top = element.getBoundingClientRect().top;
    const anchors = Array.from(element.querySelectorAll<HTMLElement>('[data-history-id]'))
      .filter(node => node.getBoundingClientRect().bottom >= top)
      .map(node => ({ id: node.dataset.historyId!, offset: node.getBoundingClientRect().top - top }));
    pending.current = { version: paging.version, revision: paging.revision, direction, anchors };
    retryDirection.current = direction;
    paging.onRequest(direction);
  }, [paging, viewport, scrolling.stopFollowing]);

  useLayoutEffect(() => {
    const current = pending.current;
    if (!current || !paging || paging.loading) return;
    if (paging.error) { pending.current = null; return; }
    if (paging.version === current.version && paging.revision === current.revision) return;
    pending.current = null;
    if (current.direction === 'latest') { scrolling.scrollToBottom('auto'); return; }
    const anchor = current.anchors.find(candidate => rows.some(row => row.messageIds.includes(candidate.id)));
    if (!anchor) return;
    const index = rows.findIndex(row => row.messageIds.includes(anchor.id));
    virtualizer.getTotalSize();
    const measurement = virtualizer.measurementsCache[index];
    if (measurement) scrolling.writeTop(measurement.start - anchor.offset);
    let frame: number | undefined;
    const restore = () => {
      const element = viewport.current;
      const node = Array.from(element?.querySelectorAll<HTMLElement>('[data-history-id]') ?? [])
        .find(candidate => candidate.dataset.historyId === anchor.id);
      if (node && element) scrolling.writeTop(element.scrollTop +
        node.getBoundingClientRect().top - element.getBoundingClientRect().top - anchor.offset);
    };
    restore();
    frame = requestAnimationFrame(restore);
    return () => { if (frame !== undefined) cancelAnimationFrame(frame); };
  }, [paging?.version, paging?.revision, paging?.loading, paging?.error, rows, virtualizer, viewport, scrolling]);

  useEffect(() => {
    const element = viewport.current;
    if (!element || !paging) return;
    let previous = element.scrollTop;
    const check = () => {
      const top = element.scrollTop;
      const upwards = top < previous;
      const downwards = top > previous;
      previous = top;
      if (element.clientHeight <= 0 || paging.loading || paging.error || pending.current) return;
      if (paging.hasOlder && top <= PRELOAD_DISTANCE &&
        (upwards || !scrolling.follow.current.following || element.scrollHeight <= element.clientHeight)) request('older');
      else if (paging.hasNewer && downwards &&
        element.scrollHeight - top - element.clientHeight <= PRELOAD_DISTANCE) request('newer');
    };
    element.addEventListener('scroll', check, { passive: true });
    check();
    return () => element.removeEventListener('scroll', check);
  }, [paging, request, viewport, scrolling.follow]);

  const toLatest = useCallback(() => {
    if (paging?.hasNewer || paging?.error) request('latest');
    else scrolling.scrollToBottom();
  }, [paging, request, scrolling.scrollToBottom]);
  return { toLatest, retry: () => request(retryDirection.current) };
}
