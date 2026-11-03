import { useI18n } from '../i18n';
import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowDown } from 'lucide-react';
import { useHistoryPaging, type TranscriptPaging } from './useHistoryPaging';
import { ProcessPresentationProvider } from './processPresentation';
import { useTranscriptScroll } from './useTranscriptScroll';
import { Button } from '../ui/button';
import type { TranscriptMessage } from './TranscriptView';
// Keep the message subtree stable when only its virtual row size changes.
const ReadOnlyMessageContent = memo(function ReadOnlyMessageContent({ id, renderMessage, stopFollowing }: {
  readonly id: string; readonly stopFollowing: () => void;
  readonly renderMessage: (id: string, stopFollowing: () => void) => ReactNode;
}) {
  return renderMessage(id, stopFollowing);
});
export function ReadOnlyTranscriptView({ messages, truncated = false, renderMessage, paging }: {
  readonly paging?: TranscriptPaging;
  readonly messages: readonly TranscriptMessage[];
  readonly truncated?: boolean;
  readonly renderMessage: (id: string, stopFollowing: () => void) => ReactNode;
}) {
  const { t } = useI18n();
  const viewport = useRef<HTMLDivElement>(null), content = useRef<HTMLDivElement>(null);
  const scrolling = useTranscriptScroll(viewport, content, null, 0);
  const leading = useRef<HTMLDivElement>(null);
  const [scrollMargin, setScrollMargin] = useState(20);
  const descriptors = messages;
  useLayoutEffect(() => {
    const element = leading.current, scroller = viewport.current;
    if (!element || !scroller) return;
    const measure = () => setScrollMargin(element.getBoundingClientRect().bottom - scroller.getBoundingClientRect().top + scroller.scrollTop);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element); observer.observe(scroller);
    return () => observer.disconnect();
  }, [truncated]);
  const ids = useMemo(() => descriptors.map((message) => message.id), [descriptors]);
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
  const rows = useMemo(() => descriptors.map(item => ({ messageIds: [item.id] })), [descriptors]);
  const historyPaging = useHistoryPaging(paging, viewport, rows, virtualizer, scrolling);
  virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item, _delta, instance) =>
    !scrolling.follow.current.following && scrolling.navigation.current === null &&
    (instance.itemSizeCache.has(item.key) ? item.end <= (instance.scrollOffset ?? 0) : item.start < (instance.scrollOffset ?? 0));
  const visible = virtualizer.getVirtualItems();
  return <div className="relative flex min-h-0 flex-col overflow-hidden">
    <div ref={viewport} aria-label={t("Read-only session transcript")} className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain [overflow-anchor:none] [scrollbar-gutter:stable]">
      <div ref={content} className="v2-chat-rail min-h-full pb-3 pt-5">
        <div ref={leading} className="flow-root">
          {truncated ? <p role="note" data-ui-notice="" className="mb-4 border-b border-[var(--panel-edge)] pb-2 text-center text-[11px] text-muted-foreground select-none">{t("Older transcript items were omitted.")}</p> : null}
          {paging ? <div role="status" data-ui-notice="" className="v2-history-divider select-none">
            <span className="inline-flex min-w-0 flex-wrap items-center justify-center gap-x-1.5 gap-y-0.5 text-center">
              {paging.loading ? <span>{t("Loading history…")}</span> : null}
              {paging.error ? <><span>{t(paging.error)}</span><Button variant="plain" size="none" onClick={historyPaging.retry}>{t("Retry")}</Button></> : null}
              {!paging.hasOlder && !paging.loading && !paging.error ? <span>{t("Beginning of conversation")}</span> : null}
            </span>
          </div> : null}
        </div>
        <ProcessPresentationProvider messageIds={ids} followingRef={scrolling.follow}>
          <div style={{ paddingTop: Math.max(0, (visible[0]?.start ?? scrollMargin) - scrollMargin), paddingBottom: Math.max(0, virtualizer.getTotalSize() - ((visible.at(-1)?.end ?? scrollMargin) - scrollMargin)) }}>
            {visible.map((row) => {
              const descriptor = descriptors[row.index];
              return <div key={row.key} ref={virtualizer.measureElement} data-index={row.index} data-history-id={descriptor.id} data-markdown-row="" style={{ '--markdown-row-height': `${row.size}px` } as CSSProperties} className={`flow-root ${descriptor.replyEnd ? 'pb-6' : 'pb-2'}`}>
                <ReadOnlyMessageContent id={descriptor.id} renderMessage={renderMessage} stopFollowing={scrolling.stopFollowing} />
              </div>;
            })}
          </div>
        </ProcessPresentationProvider>
      </div>
    </div>
    {scrolling.away || paging?.hasNewer ? <Button ref={scrolling.wheelOverlayRef} variant="outline" size="icon-sm" aria-label={t("Scroll to bottom")}
      className="absolute bottom-3 right-4 rounded-full" onClick={historyPaging.toLatest}><ArrowDown /></Button> : null}
  </div>;
}
