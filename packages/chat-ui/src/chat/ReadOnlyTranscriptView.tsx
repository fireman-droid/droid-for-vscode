import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowDown } from 'lucide-react';
import { ProcessPresentationProvider } from './processPresentation';
import { useTranscriptScroll } from './useTranscriptScroll';
import { Button } from '../ui/button';
import type { TranscriptMessage } from './TranscriptView';
export function ReadOnlyTranscriptView({ messages, truncated = false, renderMessage }: {
  readonly messages: readonly TranscriptMessage[];
  readonly truncated?: boolean;
  readonly renderMessage: (id: string, stopFollowing: () => void) => ReactNode;
}) {
  const viewport = useRef<HTMLDivElement>(null), content = useRef<HTMLDivElement>(null);
  const scrolling = useTranscriptScroll(viewport, content, null, 0);
  const leading = useRef<HTMLDivElement>(null);
  const [scrollMargin, setScrollMargin] = useState(24);
  useLayoutEffect(() => {
    const element = leading.current, scroller = viewport.current;
    if (!element || !scroller) return;
    const measure = () => setScrollMargin(element.getBoundingClientRect().bottom - scroller.getBoundingClientRect().top + scroller.scrollTop);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element); observer.observe(scroller);
    return () => observer.disconnect();
  }, [truncated]);
  const descriptors = messages;
  const ids = messages.map((message) => message.id);
  const getScroller = useCallback(() => viewport.current, []);
  const virtualizer = useVirtualizer({
    count: descriptors.length, getScrollElement: getScroller, getItemKey: (index) => ids[index],
    estimateSize: (index) => descriptors[index].role === 'user' ? 100 : 300,
    overscan: 2, scrollMargin,
    scrollToFn: (offset, { adjustments, behavior }) => {
      if (scrolling.follow.current.following || scrolling.navigation.current !== null) return;
      scrolling.writeTop(offset + (adjustments ?? 0), behavior);
    },
  });
  virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item, _delta, instance) =>
    !scrolling.follow.current.following && scrolling.navigation.current === null &&
    instance.scrollDirection !== 'backward' && item.end <= (instance.scrollOffset ?? 0);
  const visible = virtualizer.getVirtualItems();
  return <div className="relative flex min-h-0 flex-col overflow-hidden">
    <div ref={viewport} aria-label="Read-only session transcript" className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain [overflow-anchor:none] [scrollbar-gutter:stable]">
      <div ref={content} className="mx-auto min-h-full max-w-[784px] px-3 pt-6 pb-16 max-[520px]:pt-[18px] max-[520px]:pb-11">
        <div ref={leading} className="flow-root">
          {truncated ? <p role="note" className="mb-4 border-b border-[var(--panel-edge)] pb-2 text-center text-[11px] text-muted-foreground">Older transcript items were omitted.</p> : null}
        </div>
        <ProcessPresentationProvider messageIds={ids} followingRef={scrolling.follow}>
          <div style={{ paddingTop: Math.max(0, (visible[0]?.start ?? scrollMargin) - scrollMargin), paddingBottom: Math.max(0, virtualizer.getTotalSize() - ((visible.at(-1)?.end ?? scrollMargin) - scrollMargin)) }}>
            {visible.map((row) => {
              const descriptor = descriptors[row.index];
              return <div key={row.key} ref={virtualizer.measureElement} data-index={row.index} className="flow-root pb-3">{renderMessage(descriptor.id, scrolling.stopFollowing)}</div>;
            })}
          </div>
        </ProcessPresentationProvider>
      </div>
    </div>
    {scrolling.away ? <Button variant="outline" size="icon-sm" aria-label="Scroll to bottom"
      className="absolute bottom-3 right-4 rounded-full" onClick={() => scrolling.scrollToBottom()}><ArrowDown /></Button> : null}
  </div>;
}
