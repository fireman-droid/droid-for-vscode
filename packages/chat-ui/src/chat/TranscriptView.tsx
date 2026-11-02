import { useI18n } from '../i18n';
import { memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode, type Ref } from 'react';
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual';
import { ArrowDown, ChevronUp } from 'lucide-react';
import { Button } from '../ui/button';
import { buildTurns } from '../navigation/buildTurns';
import { useTranscriptScroll } from './useTranscriptScroll';
import { ProcessPresentationProvider } from './processPresentation';
import { findActiveQuestionIndex, isScrollableTranscript, questionPreview } from '../navigation/questionNavigation';
import { QuestionNavigator } from './QuestionNavigator';
import { SelectionToolbar } from './SelectionToolbar';
import { hasQuestionEntered, questionEntryOffset } from '../navigation/questionEntryBoundary';
import { hasTranscriptSelection, selectedTurnIndexes, useTranscriptSelection } from './transcriptSelection';

export interface TranscriptMessage {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  readonly text?: string;
  readonly replyEnd?: boolean;
}
export interface MessagePresentation {
  readonly placeholder: boolean;
  readonly placeholderHeight: number;
}
export interface TranscriptHandle {
  readonly stopFollowing: () => void;
  readonly scrollToBottom: () => void;
  readonly prepareForSend: () => void;
}
export interface TranscriptViewProps {
  readonly messages: readonly TranscriptMessage[];
  readonly conversationId: string | null;
  readonly sessionKey: string | null;
  readonly sendSignal: number;
  readonly renderMessage: (id: string, presentation: MessagePresentation) => ReactNode;
  readonly leadingContent?: ReactNode;
  readonly historyNotice?: ReactNode;
  readonly trailingContent?: ReactNode;
  readonly statusContent?: ReactNode;
  readonly onQuote?: (text: string) => void;
  readonly onBtwQuote?: (text: string) => void;
  readonly reportLayout?: (detail: string) => void;
  readonly pauseAutoFollow?: boolean;
  readonly ref?: Ref<TranscriptHandle>;
}
const PINNED_QUESTION_GAP = 12;
const DEFAULT_MESSAGE_WINDOW = 60;
const MESSAGE_WINDOW_STEP = 120;
// Resizing a virtual turn during disclosure motion must not call the business
// renderer again. New transcript data still arrives through renderMessage.
const TranscriptMessageContent = memo(function TranscriptMessageContent({ id, renderMessage, placeholder, placeholderHeight }: MessagePresentation & {
  readonly id: string; readonly renderMessage: TranscriptViewProps['renderMessage'];
}) {
  return renderMessage(id, { placeholder, placeholderHeight });
});
export function TranscriptView({ messages, conversationId, sessionKey, sendSignal, renderMessage, leadingContent, historyNotice, trailingContent, statusContent, onQuote, onBtwQuote, reportLayout, pauseAutoFollow = false, ref }: TranscriptViewProps) {
  const { t } = useI18n();
  const selectionRoot = useRef<HTMLDivElement>(null);
  const selecting = useTranscriptSelection(selectionRoot);
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const leading = useRef<HTMLDivElement>(null);
  const [jump, setJump] = useState<{ id: string; conversationId: string | null; sendSignal: number } | null>(null);
  const pendingJump = useRef(false);
  const clearBottomJump = useCallback(() => {
    if (!pendingJump.current) setJump(null);
  }, []);
  const [scrollMargin, setScrollMargin] = useState(20);
  useLayoutEffect(() => {
    const element = leading.current;
    if (!element) return;
    const measure = () => setScrollMargin(element.getBoundingClientRect().height + 20);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const runway = useRef<HTMLDivElement>(null);
  const runwayHeight = useRef(0);
  const pinnedAtTop = useRef(false);
  const lastPinTop = useRef(0);
  const syncRunwayRef = useRef<() => number>(() => 0);
  const syncRunway = useCallback(() => syncRunwayRef.current(), []);
  const scrolling = useTranscriptScroll(viewport, content, conversationId, sendSignal, reportLayout, clearBottomJump, pauseAutoFollow, syncRunway);
  const lastQuestionId = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index].role === 'user') return messages[index].id;
    }
    return undefined;
  }, [messages]);
  const allDescriptors = messages;
  const [windowState, setWindowState] = useState({ sessionId: sessionKey, count: DEFAULT_MESSAGE_WINDOW });
  const messageWindow = windowState.sessionId === sessionKey ? windowState.count : DEFAULT_MESSAGE_WINDOW;
  if (windowState.sessionId !== sessionKey) setWindowState({ sessionId: sessionKey, count: DEFAULT_MESSAGE_WINDOW });
  const hiddenMessageCount = Math.max(0, allDescriptors.length - messageWindow);
  const descriptors = useMemo(() => allDescriptors.slice(hiddenMessageCount), [allDescriptors, hiddenMessageCount]);
  const historyAnchor = useRef<{ height: number; top: number } | null>(null);
  const revealEarlier = () => {
    const element = viewport.current;
    pinnedAtTop.current = false;
    scrolling.stopFollowing();
    historyAnchor.current = element ? { height: element.scrollHeight, top: element.scrollTop } : null;
    setWindowState((current) => ({ ...current, count: current.count + MESSAGE_WINDOW_STEP }));
  };
  const byId = useMemo(() => new Map(descriptors.map((item) => [item.id, item])), [descriptors]);
  const ids = useMemo(() => [...byId.keys()], [byId]);
  const turns = useMemo(() => buildTurns(descriptors.map((item) => ({
    id: item.id, role: item.role,
  }))), [descriptors]);
  const questions = useMemo(() => turns.flatMap((turn, turnIndex) => {
    const descriptor = byId.get(turn.id)!;
    return descriptor.role === 'user' ? [{ key: turn.id, text: descriptor.text ?? '', turnIndex }] : [];
  }).map((item, index) => ({ ...item, preview: questionPreview(item.text, index) })), [turns, byId]);
  const questionState = useRef<{
    conversationId: string | null;
    questionId: string | undefined;
    sendSignal: number;
    pinnedId: string | null;
  }>({
    conversationId,
    questionId: lastQuestionId,
    sendSignal,
    pinnedId: null,
  });
  if (questionState.current.conversationId !== conversationId) {
    questionState.current = {
      conversationId,
      questionId: lastQuestionId,
      sendSignal,
      pinnedId: null,
    };
  } else if (lastQuestionId !== questionState.current.questionId) {
    const hadQuestion = questionState.current.questionId !== undefined;
    const sentFromEmpty =
      sendSignal !== questionState.current.sendSignal ||
      (questions.length === 1 && !messages.at(-1)?.replyEnd);
    if (lastQuestionId !== undefined && (hadQuestion || sentFromEmpty)) {
      questionState.current.pinnedId = lastQuestionId;
    } else if (lastQuestionId === undefined) {
      questionState.current.pinnedId = null;
    }
    questionState.current.questionId = lastQuestionId;
    questionState.current.sendSignal = sendSignal;
  }
  const pinnedTurnIndex = questionState.current.pinnedId === null
    ? -1
    : turns.findIndex((turn) => turn.id === questionState.current.pinnedId);
  const getScrollElement = useCallback(() => viewport.current, []);
  const subscribe = useCallback((notify: () => void) => {
    const element = viewport.current;
    element?.addEventListener('scroll', notify, { passive: true });
    return () => element?.removeEventListener('scroll', notify);
  }, []);
  const virtualizer = useVirtualizer({
    count: turns.length,
    getScrollElement,
    getItemKey: (index) => turns[index].id,
    estimateSize: (index) => 100 * turns[index].messageIds.length,
    overscan: 2,
    rangeExtractor: (range) => [...new Set([...defaultRangeExtractor(range), ...selectedTurnIndexes(selectionRoot.current)])].filter((index) => index < range.count).sort((a, b) => a - b),
    scrollMargin,
    scrollToFn: (offset, { adjustments, behavior }) => {
      if (scrolling.follow.current.following || scrolling.navigation.current !== null) return;
      scrolling.writeTop(offset + (adjustments ?? 0), behavior);
    },
  });
  // Rows above the reading position must retain their anchor in either scroll
  // direction, including when an estimated row receives its first measurement.
  virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item, _delta, instance) =>
    !scrolling.follow.current.following && scrolling.navigation.current === null &&
    (instance.itemSizeCache.has(item.key) ? item.end <= (instance.scrollOffset ?? 0) : item.start < (instance.scrollOffset ?? 0));
  syncRunwayRef.current = () => {
    const element = viewport.current, column = content.current, spacer = runway.current;
    virtualizer.getTotalSize();
    const cachedTurn = pinnedTurnIndex >= 0 ? virtualizer.measurementsCache[pinnedTurnIndex] : undefined;
    if (!element || !column || !spacer || pinnedTurnIndex < 0 || element.clientHeight <= 0 || cachedTurn === undefined) {
      runwayHeight.current = 0;
      pinnedAtTop.current = false;
      lastPinTop.current = 0;
      if (column && column.style.minHeight !== '') column.style.minHeight = '';
      if (spacer && spacer.style.height !== '0px') spacer.style.height = '0px';
      return 0;
    }
    const previousPinTop = lastPinTop.current;
    const columnRect = column.getBoundingClientRect();
    const rowEl = column.querySelector<HTMLElement>(`[data-index="${pinnedTurnIndex}"]`);
    const rowRect = rowEl?.getBoundingClientRect();
    const domTurnStart = columnRect.height > 0 && rowRect && rowRect.height > 0
      ? Math.round(rowRect.top - columnRect.top)
      : cachedTurn.start;
    const turnStart = Math.ceil(Math.max(cachedTurn.start, domTurnStart));
    const pinTop = Math.max(0, turnStart - PINNED_QUESTION_GAP);
    const paddingBottom = parseFloat(getComputedStyle(column).paddingBottom) || (statusContent ? 0 : 12);
    const naturalHeight = columnRect.height > 0
      ? spacer.getBoundingClientRect().top - columnRect.top + paddingBottom
      : scrollMargin + virtualizer.getTotalSize() + paddingBottom;
    const minColumnHeight = Math.ceil(pinTop + element.clientHeight);
    const nextHeight = Math.ceil(Math.max(0, minColumnHeight - naturalHeight));
    runwayHeight.current = nextHeight;
    lastPinTop.current = pinTop;
    const nextMinHeight = `${minColumnHeight}px`;
    if (column.style.minHeight !== nextMinHeight) column.style.minHeight = nextMinHeight;
    if (spacer.style.height !== '0px') spacer.style.height = '0px';
    if (pinnedAtTop.current) {
      // Runway height changes with every streamed line, so layout stability can
      // never decide whether the reader left the pin. Compare against the pin
      // the reader was attached to instead; releasing only stops future snaps
      // and never writes scrollTop, so it cannot pull the viewport back down.
      const pinReference = previousPinTop > 0 ? Math.min(previousPinTop, pinTop) : pinTop;
      if (!scrolling.follow.current.following && element.scrollTop < pinReference - 2) {
        pinnedAtTop.current = false;
      } else if (nextHeight > 0 && ((scrolling.follow.current.following && element.scrollTop < pinTop - 1) || (pinTop !== previousPinTop && Math.abs(element.scrollTop - previousPinTop) <= 2))) {
        element.scrollTop = pinTop;
        scrolling.follow.current.pendingProgrammaticTop = element.scrollTop;
      }
    } else if (element.scrollTop >= pinTop - 2) {
      pinnedAtTop.current = true;
      if (scrolling.follow.current.following && nextHeight > 0 && element.scrollTop < pinTop - 1) {
        element.scrollTop = pinTop;
        scrolling.follow.current.pendingProgrammaticTop = element.scrollTop;
      }
    }
    return nextHeight;
  };
  useLayoutEffect(() => { syncRunway(); });
  const previousPinned = useRef<string | null>(null);
  useLayoutEffect(() => {
    // Queueing/editing also changes sendSignal. Follow only when a new
    // question actually enters the transcript, not while the old turn stops.
    const currentPinned = questionState.current.pinnedId;
    if (currentPinned !== null && previousPinned.current !== currentPinned) {
      pinnedAtTop.current = true;
      syncRunway();
      scrolling.followNewQuestion();
    }
    previousPinned.current = currentPinned;
  }, [lastQuestionId, sendSignal, conversationId, syncRunway, scrolling.followNewQuestion]);
  const effectiveScrollHeight = useCallback(
    (element: HTMLDivElement | null) =>
      (element?.scrollHeight ?? 0) - (questions.length <= 1 ? runwayHeight.current : 0),
    [questions.length],
  );
  const resolvePinOffset = useCallback((scrollTop: number) => {
    const baseOffset = scrollTop + PINNED_QUESTION_GAP;
    if (pinnedTurnIndex >= 0) {
      const pinnedStart = virtualizer.measurementsCache[pinnedTurnIndex]?.start;
      if (pinnedStart !== undefined && baseOffset < pinnedStart) {
        if (runwayHeight.current > 0 && scrollTop >= lastPinTop.current - 2) return pinnedStart;
        const element = viewport.current;
        const rowEl = element?.querySelector<HTMLElement>(`[data-index="${pinnedTurnIndex}"]`);
        if (element && rowEl && rowEl.getBoundingClientRect().top - element.getBoundingClientRect().top <= PINNED_QUESTION_GAP + 2) {
          return pinnedStart;
        }
      }
    }
    return baseOffset;
  }, [pinnedTurnIndex, virtualizer]);
  const readBoundary = useCallback(() => {
    const element = viewport.current;
    const offset = resolvePinOffset(element?.scrollTop ?? 0);
    const row = virtualizer.getVirtualItemForOffset(questionEntryOffset(offset));
    return `${row?.index ?? -1}:${row !== undefined && hasQuestionEntered(row.start, offset)}:${
      isScrollableTranscript(effectiveScrollHeight(element), element?.clientHeight ?? 0)}`;
  }, [virtualizer, effectiveScrollHeight, resolvePinOffset]);
  // Pixel movement only moves the pinned overlay; render the transcript when
  // the question boundary or virtual range changes, not on every scroll event.
  useSyncExternalStore(subscribe, readBoundary, readBoundary);
  const top = viewport.current?.scrollTop ?? 0;
  const pinOffset = resolvePinOffset(top);
  const virtualItems = virtualizer.getVirtualItems();
  useLayoutEffect(() => {
    const anchor = historyAnchor.current, element = viewport.current;
    if (!anchor || !element) return;
    historyAnchor.current = null;
    scrolling.writeTop(anchor.top + element.scrollHeight - anchor.height);
  }, [hiddenMessageCount, scrolling.writeTop]);
  const questionTops = questions.map((question) => virtualizer.measurementsCache[question.turnIndex]?.start ?? Number.POSITIVE_INFINITY);
  const activeQuestion = findActiveQuestionIndex(questionTops, pinOffset);
  const showNavigator = isScrollableTranscript(effectiveScrollHeight(viewport.current), viewport.current?.clientHeight ?? 0);
  const jumpTarget = jump?.conversationId === conversationId && jump.sendSignal === sendSignal
    ? questions.find((question) => question.key === jump.id) : undefined;
  const navigateQuestion = (id: string) => {
    const question = questions.find((item) => item.key === id);
    if (!question) return;
    pinnedAtTop.current = false;
    scrolling.stopFollowing();
    pendingJump.current = true;
    setJump({ id, conversationId: conversationId, sendSignal });
  };
  useLayoutEffect(() => {
    if (!jumpTarget) {
      pendingJump.current = false;
      return;
    }
    if (virtualizer.measurementsCache[jumpTarget.turnIndex]?.start === undefined) return;
    if (pendingJump.current) {
      pendingJump.current = false;
      scrolling.scrollToTarget(() => {
        const measuredTop = virtualizer.measurementsCache[jumpTarget.turnIndex]?.start;
        return measuredTop === undefined ? undefined : Math.max(0, measuredTop - PINNED_QUESTION_GAP);
      });
    }
  });
  const returnToBottom = useCallback(() => {
    setJump(null);
    scrolling.scrollToBottom();
  }, [scrolling.scrollToBottom]);
  useImperativeHandle(ref, () => ({
    stopFollowing: scrolling.stopFollowing,
    scrollToBottom: returnToBottom,
    prepareForSend: scrolling.prepareForSend,
  }), [scrolling.stopFollowing, scrolling.prepareForSend, returnToBottom]);
  const pin = useRef<HTMLDivElement>(null);
  const liveCandidate = virtualizer.getVirtualItemForOffset(questionEntryOffset(pinOffset));
  const liveEntered = liveCandidate !== undefined && hasQuestionEntered(liveCandidate.start, pinOffset);
  const heldCandidate = useRef<{ conversationId: string | null; candidate: typeof liveCandidate; entered: boolean }>({
    conversationId: conversationId, candidate: liveCandidate, entered: false,
  });
  if (heldCandidate.current.conversationId !== conversationId || liveEntered || !hasTranscriptSelection(pin.current))
    heldCandidate.current = { conversationId: conversationId, candidate: liveCandidate, entered: liveEntered };
  const candidate = heldCandidate.current.candidate;
  const lead = candidate === undefined || !heldCandidate.current.entered ? undefined : byId.get(turns[candidate.index]?.id);
  const pinned = lead?.role === 'user' ? lead : null;
  // Selection can retain a pinned owner after its original row re-enters view.
  // Retain the overlay node, but only hide the original while it is above the edge.
  const pinEntered = candidate !== undefined && hasQuestionEntered(
    virtualizer.measurementsCache[candidate.index]?.start ?? candidate.start, pinOffset,
  );
  const [size, setSize] = useState({ id: '', height: 0 });
  const measurePinned = useCallback(() => {
    const element = pin.current;
    if (element === null || pinned === null) return;
    const height = element.querySelector('[data-question-card]')?.getBoundingClientRect().height ?? 0;
    setSize((previous) => previous.id === pinned.id && Math.abs(previous.height - height) < 0.5 ? previous : { id: pinned.id, height });
  }, [pinned?.id]);
  // An edit must resize the original placeholder before the next paint.
  useLayoutEffect(measurePinned);
  useLayoutEffect(() => {
    const element = pin.current;
    if (element === null || pinned === null) return;
    const observer = new ResizeObserver(measurePinned);
    observer.observe(element);
    return () => observer.disconnect();
  }, [measurePinned, conversationId]);
  const pinnedHeight = size.id === pinned?.id ? size.height : 0;
  const nextQuestion = candidate === undefined ? undefined : questions.find((question) => question.turnIndex > candidate.index);
  const nextTop = nextQuestion === undefined ? undefined : virtualizer.measurementsCache[nextQuestion.turnIndex]?.start;
  const pinnedOverlay = useRef<HTMLDivElement>(null);
  const setPinnedOverlay = useCallback((element: HTMLDivElement | null) => {
    pinnedOverlay.current = element;
    if (element === null) return;
    const releaseWheel = scrolling.wheelOverlayRef(element);
    return () => { releaseWheel?.(); pinnedOverlay.current = null; };
  }, [scrolling.wheelOverlayRef]);
  useLayoutEffect(() => {
    const element = viewport.current, overlay = pinnedOverlay.current;
    if (!element || !overlay) return;
    let frame: number | null = null;
    const update = () => {
      frame = null;
      if (hasTranscriptSelection(pin.current)) return;
      // Editing grows the pinned card and its placeholder in one commit. The
      // virtualizer can still hold the previous row height until ResizeObserver
      // runs, so read the rendered boundary from the same layout as the card.
      const nextRow = nextQuestion === undefined ? null : element.querySelector<HTMLElement>(`[data-index="${nextQuestion.turnIndex}"]`);
      const nextOffset = nextRow ? nextRow.getBoundingClientRect().top - element.getBoundingClientRect().top
        : nextTop === undefined ? undefined : nextTop - element.scrollTop;
      const value = nextOffset === undefined ? 0 : Math.min(0, nextOffset - PINNED_QUESTION_GAP - pinnedHeight - 14);
      overlay.style.transform = `translateY(${value}px)`;
    };
    const schedule = () => { frame ??= requestAnimationFrame(update); };
    update();
    element.addEventListener('scroll', schedule, { passive: true });
    return () => {
      element.removeEventListener('scroll', schedule);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [conversationId, pinned?.id, pinnedHeight, nextQuestion, nextTop, virtualizer, selecting]);
  return (
    <div ref={selectionRoot} className="relative min-h-0 select-text overflow-hidden" data-text-selecting={selecting || undefined}>
      <div ref={viewport} data-transcript-scrollbar="" className="h-full overflow-x-hidden overflow-y-auto overscroll-contain [overflow-anchor:none] [scrollbar-width:none] [&::-webkit-scrollbar]:w-0" aria-label={t("Chat transcript")}>
        <div ref={content} className={`v2-chat-rail min-h-full pt-5 ${statusContent ? 'pb-0' : 'pb-3'}`}>
          <div ref={leading} className="flow-root">
            {leadingContent}
            {(historyNotice || hiddenMessageCount > 0) ? <div role="note" data-ui-notice="" className="v2-history-divider select-none">
              <span className="inline-flex min-w-0 flex-wrap items-center justify-center gap-x-1.5 gap-y-0.5 text-center">
                {historyNotice ? <span>{historyNotice}</span> : null}
                {historyNotice && hiddenMessageCount > 0 ? <span aria-hidden="true">·</span> : null}
                {hiddenMessageCount > 0 ? <Button variant="plain" size="none" className="v2-history-trigger" onClick={revealEarlier}><ChevronUp aria-hidden="true" /><span>{t("Show earlier messages (")}{hiddenMessageCount} {t("hidden)")}</span></Button> : null}
              </span>
            </div> : null}
          </div>
          <ProcessPresentationProvider key={conversationId} messageIds={ids} followingRef={scrolling.follow} onPauseFollowing={scrolling.stopFollowing} reportLayout={reportLayout}>
          <div style={{ paddingTop: Math.max(0, (virtualItems[0]?.start ?? scrollMargin) - scrollMargin), paddingBottom: Math.max(0, virtualizer.getTotalSize() - ((virtualItems.at(-1)?.end ?? scrollMargin) - scrollMargin)) }}>
            {virtualItems.map((row, index) => (
              <div key={row.key} ref={virtualizer.measureElement} data-index={row.index} data-markdown-row="" className="flow-root"
                style={{ '--markdown-row-height': `${row.size}px`, marginTop: index === 0 ? 0 : Math.max(0, row.start - virtualItems[index - 1]!.end) } as CSSProperties}>
                {turns[row.index].messageIds.map((id) => {
                  const message = byId.get(id)!;
                  return <div key={id} className={message.replyEnd ? 'pb-5' : 'pb-2'}>
                    <TranscriptMessageContent id={id} renderMessage={renderMessage} placeholder={pinned?.id === id && pinEntered} placeholderHeight={pinnedHeight} />
                  </div>;
                })}
              </div>
            ))}
          </div>
          </ProcessPresentationProvider>
          {trailingContent}
          {statusContent ? <div className={`bg-background pb-1 pt-2 ${scrolling.followingBottom ? 'sticky bottom-0 z-[1]' : 'relative'}`}>
            {statusContent}
          </div> : null}
          <div ref={runway} data-pin-runway="" aria-hidden="true" />
        </div>
      </div>
      {pinned === null ? null : <>
        <div ref={setPinnedOverlay} className="v2-chat-rail pointer-events-none absolute inset-x-0 bottom-0 z-10" style={{ top: PINNED_QUESTION_GAP, visibility: pinEntered ? 'visible' : 'hidden' }} inert={!pinEntered || undefined} aria-hidden={!pinEntered || undefined}>
          <div ref={pin} data-pinned-question={pinned.id} data-selection-turn={candidate?.index} className="pointer-events-auto max-h-full overflow-y-auto bg-background">
            <TranscriptMessageContent id={pinned.id} renderMessage={renderMessage} placeholder={false} placeholderHeight={0} />
          </div>
        </div>
        <div data-pinned-top-mask="" aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 z-10 bg-background" style={{ height: PINNED_QUESTION_GAP, visibility: pinEntered ? 'visible' : 'hidden' }} />
      </>}
      {showNavigator ? <QuestionNavigator ref={scrolling.wheelOverlayRef} items={questions} activeIndex={activeQuestion} onNavigate={navigateQuestion} /> : null}
      {onQuote ? <SelectionToolbar viewport={viewport} selectionRoot={selectionRoot} onQuote={onQuote} onBtwQuote={onBtwQuote} /> : null}
      {scrolling.away ? (
        <Button ref={scrolling.wheelOverlayRef} variant="outline" size="icon-sm" aria-label={t("Scroll to bottom")} className="absolute bottom-2 right-4 z-20 rounded-full" onClick={returnToBottom}><ArrowDown /></Button>
      ) : null}
    </div>
  );
}
