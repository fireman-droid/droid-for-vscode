import { useI18n } from '../i18n';
import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowDown, ChevronUp } from 'lucide-react';
import { ProcessPresentationProvider } from './processPresentation';
import { useTranscriptScroll } from './useTranscriptScroll';
import { Button } from '../ui/button';
import type { TranscriptMessage } from './TranscriptView';
const DEFAULT_MESSAGE_WINDOW = 60;
const MESSAGE_WINDOW_STEP = 120;
// Keep the message subtree stable when only its virtual row size changes.
const ReadOnlyMessageContent = memo(function ReadOnlyMessageContent({ id, renderMessage, stopFollowing }: {
  readonly id: string; readonly stopFollowing: () => void;
  readonly renderMessage: (id: string, stopFollowing: () => void) => ReactNode;
}) {
  return renderMessage(id, stopFollowing);
});
export function ReadOnlyTranscriptView({ messages, truncated = false, renderMessage }: {
  readonly messages: readonly TranscriptMessage[];
  readonly truncated?: boolean;
  readonly renderMessage: (id: string, stopFollowing: () => void) => ReactNode;
}) {
  const { t } = useI18n();
  const viewport = useRef<HTMLDivElement>(null), content = useRef<HTMLDivElement>(null);
  const scrolling = useTranscriptScroll(viewport, content, null, 0);
  const leading = useRef<HTMLDivElement>(null);
  const [scrollMargin, setScrollMargin] = useState(20);
  const [windowCount, setWindowCount] = useState(DEFAULT_MESSAGE_WINDOW);
  const hiddenMessageCount = Math.max(0, messages.length - windowCount);
  const descriptors = useMemo(() => hiddenMessageCount > 0 ? messages.slice(hiddenMessageCount) : messages, [messages, hiddenMessageCount]);
  const historyAnchor = useRef<{ height: number; top: number } | null>(null);
  const revealEarlier = () => {
    const element = viewport.current;
    scrolling.stopFollowing();
    historyAnchor.current = element ? { height: element.scrollHeight, top: element.scrollTop } : null;
    setWindowCount((current) => current + MESSAGE_WINDOW_STEP);
  };
  useLayoutEffect(() => {
    const element = leading.current, scroller = viewport.current;
    if (!element || !scroller) return;
    const measure = () => setScrollMargin(element.getBoundingClientRect().bottom - scroller.getBoundingClientRect().top + scroller.scrollTop);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element); observer.observe(scroller);
    return () => observer.disconnect();
  }, [truncated, hiddenMessageCount]);
  useLayoutEffect(() => {
    const anchor = historyAnchor.current, element = viewport.current;
    if (!anchor || !element) return;
    historyAnchor.current = null;
    scrolling.writeTop(anchor.top + element.scrollHeight - anchor.height);
  }, [hiddenMessageCount, scrolling.writeTop]);
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
  virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item, _delta, instance) =>
    !scrolling.follow.current.following && scrolling.navigation.current === null &&
    (instance.itemSizeCache.has(item.key) ? item.end <= (instance.scrollOffset ?? 0) : item.start < (instance.scrollOffset ?? 0));
  const visible = virtualizer.getVirtualItems();
  return <div className="relative flex min-h-0 flex-col overflow-hidden">
    <div ref={viewport} aria-label={t("Read-only session transcript")} className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain [overflow-anchor:none] [scrollbar-gutter:stable]">
      <div ref={content} className="v2-chat-rail min-h-full pb-3 pt-5">
        <div ref={leading} className="flow-root">
          {truncated ? <p role="note" data-ui-notice="" className="mb-4 border-b border-[var(--panel-edge)] pb-2 text-center text-[11px] text-muted-foreground select-none">{t("Older transcript items were omitted.")}</p> : null}
          {hiddenMessageCount > 0 ? <div role="note" data-ui-notice="" className="v2-history-divider select-none">
            <span className="inline-flex min-w-0 flex-wrap items-center justify-center gap-x-1.5 gap-y-0.5 text-center">
              <Button variant="plain" size="none" className="v2-history-trigger" onClick={revealEarlier}><ChevronUp aria-hidden="true" /><span>{t("Show earlier messages (")}{hiddenMessageCount} {t("hidden)")}</span></Button>
            </span>
          </div> : null}
        </div>
        <ProcessPresentationProvider messageIds={ids} followingRef={scrolling.follow}>
          <div style={{ paddingTop: Math.max(0, (visible[0]?.start ?? scrollMargin) - scrollMargin), paddingBottom: Math.max(0, virtualizer.getTotalSize() - ((visible.at(-1)?.end ?? scrollMargin) - scrollMargin)) }}>
            {visible.map((row) => {
              const descriptor = descriptors[row.index];
              return <div key={row.key} ref={virtualizer.measureElement} data-index={row.index} data-markdown-row="" style={{ '--markdown-row-height': `${row.size}px` } as CSSProperties} className={`flow-root ${descriptor.replyEnd ? 'pb-6' : 'pb-2'}`}>
                <ReadOnlyMessageContent id={descriptor.id} renderMessage={renderMessage} stopFollowing={scrolling.stopFollowing} />
              </div>;
            })}
          </div>
        </ProcessPresentationProvider>
      </div>
    </div>
    {scrolling.away ? <Button ref={scrolling.wheelOverlayRef} variant="outline" size="icon-sm" aria-label={t("Scroll to bottom")}
      className="absolute bottom-3 right-4 rounded-full" onClick={() => scrolling.scrollToBottom()}><ArrowDown /></Button> : null}
  </div>;
}
