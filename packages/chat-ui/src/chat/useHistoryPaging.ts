import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import type { Virtualizer } from '@tanstack/react-virtual';
import { isNestedScrollTarget } from '../navigation/nestedScroll';

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
  readonly navigation: RefObject<(() => number | undefined) | null>;
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
  const { stopFollowing, writeTop, scrollToBottom, follow, navigation } = scrolling;
  const readAnchors = useCallback(() => {
    const element = viewport.current;
    if (!element) return [];
    const top = element.getBoundingClientRect().top;
    return Array.from(element.querySelectorAll<HTMLElement>('[data-history-id]'))
      .filter(node => node.getBoundingClientRect().bottom > top)
      .map(node => {
        const rect = node.getBoundingClientRect();
        return { id: node.dataset.historyId!, offset: rect.top - top,
          rowOffset: rect.top - (node.closest('[data-index]')?.getBoundingClientRect().top ?? rect.top) };
      });
  }, [viewport]);
  const pending = useRef<{ version: string; revision: number; direction: 'older' | 'newer' | 'latest';
    anchors: ReturnType<typeof readAnchors> } | null>(null);
  const retryDirection = useRef<'older' | 'newer' | 'latest'>('older');
  const request = useCallback((direction: 'older' | 'newer' | 'latest') => {
    const element = viewport.current;
    if (!paging || paging.loading || pending.current || !element) return;
    stopFollowing();
    pending.current = { version: paging.version, revision: paging.revision, direction, anchors: readAnchors() };
    retryDirection.current = direction;
    paging.onRequest(direction);
  }, [paging, viewport, stopFollowing, readAnchors]);

  useLayoutEffect(() => {
    const current = pending.current;
    if (!current || !paging || paging.loading) return;
    if (paging.error) { pending.current = null; return; }
    if (paging.version === current.version && paging.revision === current.revision) return;
    pending.current = null;
    if (current.direction === 'latest') { scrollToBottom('auto'); return; }
    const anchor = current.anchors.find(candidate => rows.some(row => row.messageIds.includes(candidate.id)));
    if (!anchor) return;
    const restore = () => {
      const element = viewport.current;
      const node = Array.from(element?.querySelectorAll<HTMLElement>('[data-history-id]') ?? [])
        .find(candidate => candidate.dataset.historyId === anchor.id);
      if (!node || !element) return false;
      const delta = node.getBoundingClientRect().top - element.getBoundingClientRect().top - anchor.offset;
      if (Math.abs(delta) > 0.5) writeTop(element.scrollTop + delta);
      return true;
    };
    // A mounted message is authoritative; do not jump to an estimate and back.
    if (restore()) return;
    const index = rows.findIndex(row => row.messageIds.includes(anchor.id));
    virtualizer.getTotalSize();
    const measurement = virtualizer.measurementsCache[index];
    if (measurement) writeTop(measurement.start + anchor.rowOffset - anchor.offset);
    const frame = requestAnimationFrame(restore);
    return () => cancelAnimationFrame(frame);
  }, [paging?.version, paging?.revision, paging?.loading, paging?.error, rows, virtualizer, viewport, writeTop, scrollToBottom]);

  useEffect(() => {
    const element = viewport.current;
    if (!element || !paging) return;
    let previous = element.scrollTop;
    const check = () => {
      const top = element.scrollTop;
      const upwards = top < previous;
      const downwards = top > previous;
      previous = top;
      const current = pending.current;
      if (current && current.direction !== 'latest' &&
        current.version === paging.version && current.revision === paging.revision) {
        // History can arrive after another wheel gesture. Keep the latest reading position.
        current.anchors = readAnchors();
      }
      if (element.clientHeight <= 0 || paging.loading || paging.error || current || navigation.current !== null) return;
      if (paging.hasOlder && top <= PRELOAD_DISTANCE &&
        (upwards || !follow.current.following || element.scrollHeight <= element.clientHeight)) request('older');
      else if (paging.hasNewer && downwards &&
        element.scrollHeight - top - element.clientHeight <= PRELOAD_DISTANCE) request('newer');
    };
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.shiftKey || event.deltaY >= 0 ||
        isNestedScrollTarget(element.parentElement ?? element, event.target, event.deltaY)) return;
      // At scrollTop=0 an upward gesture produces no scroll event.
      check();
    };
    const root = element.parentElement ?? element;
    element.addEventListener('scroll', check, { passive: true });
    root.addEventListener('wheel', onWheel, { passive: true });
    check();
    return () => { element.removeEventListener('scroll', check); root.removeEventListener('wheel', onWheel); };
  }, [paging, request, viewport, follow, navigation, readAnchors]);

  const toLatest = useCallback(() => {
    if (paging?.hasNewer || paging?.error) request('latest');
    else scrollToBottom();
  }, [paging, request, scrollToBottom]);
  return { toLatest, retry: () => request(retryDirection.current) };
}
