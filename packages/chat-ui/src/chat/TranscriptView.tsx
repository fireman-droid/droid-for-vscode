import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode, type Ref } from 'react';
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual';
import { ArrowDown } from 'lucide-react';
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
}
export interface TranscriptViewProps {
  readonly messages: readonly TranscriptMessage[];
  readonly conversationId: string | null;
  readonly sessionKey: string | null;
  readonly sendSignal: number;
  readonly renderMessage: (id: string, presentation: MessagePresentation) => ReactNode;
  readonly leadingContent?: ReactNode;
  readonly trailingContent?: ReactNode;
  readonly onQuote?: (text: string) => void;
  readonly onBtwQuote?: (text: string) => void;
  readonly reportLayout?: (detail: string) => void;
  readonly ref?: Ref<TranscriptHandle>;
}
const PINNED_QUESTION_GAP = 12;
const DEFAULT_MESSAGE_WINDOW = 60;
const MESSAGE_WINDOW_STEP = 120;
export function TranscriptView({ messages, conversationId, sessionKey, sendSignal, renderMessage, leadingContent, trailingContent, onQuote, onBtwQuote, reportLayout, ref }: TranscriptViewProps) {
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
  const scrolling = useTranscriptScroll(viewport, content, conversationId, sendSignal, reportLayout, clearBottomJump);
  const lastQuestionId = [...messages].reverse().find((message) => message.role === 'user')?.id;
  const previousQuestion = useRef(lastQuestionId);
  useLayoutEffect(() => {
    // Queueing/editing also changes sendSignal. Follow only when a new
    // question actually enters the transcript, not while the old turn stops.
    if (lastQuestionId !== undefined && previousQuestion.current !== lastQuestionId) scrolling.scrollToBottom();
    previousQuestion.current = lastQuestionId;
  }, [lastQuestionId, scrolling.scrollToBottom]);
  const allDescriptors = messages;
  const [windowState, setWindowState] = useState({ sessionId: sessionKey, count: DEFAULT_MESSAGE_WINDOW });
  const messageWindow = windowState.sessionId === sessionKey ? windowState.count : DEFAULT_MESSAGE_WINDOW;
  if (windowState.sessionId !== sessionKey) setWindowState({ sessionId: sessionKey, count: DEFAULT_MESSAGE_WINDOW });
  const hiddenMessageCount = Math.max(0, allDescriptors.length - messageWindow);
  const descriptors = useMemo(() => allDescriptors.slice(hiddenMessageCount), [allDescriptors, hiddenMessageCount]);
  const historyAnchor = useRef<{ height: number; top: number } | null>(null);
  const revealEarlier = () => {
    const element = viewport.current;
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
  virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item, _delta, instance) =>
    !scrolling.follow.current.following && scrolling.navigation.current === null &&
    instance.scrollDirection !== 'backward' && item.end <= (instance.scrollOffset ?? 0);
  const readBoundary = useCallback(() => {
    const element = viewport.current;
    const offset = (element?.scrollTop ?? 0) + PINNED_QUESTION_GAP;
    const row = virtualizer.getVirtualItemForOffset(questionEntryOffset(offset));
    return `${row?.index ?? -1}:${row !== undefined && hasQuestionEntered(row.start, offset)}:${
      isScrollableTranscript(element?.scrollHeight ?? 0, element?.clientHeight ?? 0)}`;
  }, [virtualizer]);
  // Pixel movement only moves the pinned overlay; render the transcript when
  // the question boundary or virtual range changes, not on every scroll event.
  useSyncExternalStore(subscribe, readBoundary, readBoundary);
  const top = viewport.current?.scrollTop ?? 0;
  const virtualItems = virtualizer.getVirtualItems();
  useLayoutEffect(() => {
    const anchor = historyAnchor.current, element = viewport.current;
    if (!anchor || !element) return;
    historyAnchor.current = null;
    scrolling.writeTop(anchor.top + element.scrollHeight - anchor.height);
  }, [hiddenMessageCount, scrolling.writeTop]);
  const questionTops = questions.map((question) => virtualizer.measurementsCache[question.turnIndex]?.start ?? Number.POSITIVE_INFINITY);
  const activeQuestion = findActiveQuestionIndex(questionTops, top + PINNED_QUESTION_GAP);
  const showNavigator = isScrollableTranscript(viewport.current?.scrollHeight ?? 0, viewport.current?.clientHeight ?? 0);
  const jumpTarget = jump?.conversationId === conversationId && jump.sendSignal === sendSignal
    ? questions.find((question) => question.key === jump.id) : undefined;
  const navigateQuestion = (id: string) => {
    const question = questions.find((item) => item.key === id);
    if (!question) return;
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
  }), [scrolling.stopFollowing, returnToBottom]);
  const liveCandidate = virtualizer.getVirtualItemForOffset(questionEntryOffset(top + PINNED_QUESTION_GAP));
  const heldCandidate = useRef<{ conversationId: string | null; candidate: typeof liveCandidate; entered: boolean }>({
    conversationId: conversationId, candidate: liveCandidate, entered: false,
  });
  if (!hasTranscriptSelection(selectionRoot.current) || heldCandidate.current.conversationId !== conversationId)
    heldCandidate.current = { conversationId: conversationId, candidate: liveCandidate, entered: liveCandidate !== undefined && hasQuestionEntered(liveCandidate.start, top + PINNED_QUESTION_GAP) };
  const candidate = heldCandidate.current.candidate;
  const lead = candidate === undefined || !heldCandidate.current.entered ? undefined : byId.get(turns[candidate.index]?.id);
  const pinned = lead?.role === 'user' ? lead : null;
  // Selection can retain a pinned owner after its original row re-enters view.
  // Retain the overlay node, but only hide the original while it is above the edge.
  const pinEntered = candidate !== undefined && hasQuestionEntered(
    virtualizer.measurementsCache[candidate.index]?.start ?? candidate.start, top + PINNED_QUESTION_GAP,
  );
  const pin = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ id: '', height: 0 });
  useLayoutEffect(() => {
    const element = pin.current;
    if (element === null || pinned === null) return;
    const measure = () => {
      const height = element.querySelector('[data-question-card]')?.getBoundingClientRect().height ?? 0;
      setSize((previous) => previous.id === pinned.id && Math.abs(previous.height - height) < 0.5 ? previous : { id: pinned.id, height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [pinned?.id, conversationId]);
  const pinnedHeight = size.id === pinned?.id ? size.height : 0;
  const nextQuestion = candidate === undefined ? undefined : questions.find((question) => question.turnIndex > candidate.index);
  const nextTop = nextQuestion === undefined ? undefined : virtualizer.measurementsCache[nextQuestion.turnIndex]?.start;
  const livePush = nextTop === undefined ? 0 : Math.min(0, nextTop - top - PINNED_QUESTION_GAP - pinnedHeight - 14);
  const lastPush = useRef({ conversationId: conversationId, questionId: pinned?.id, value: livePush });
  const push = selecting && lastPush.current.conversationId === conversationId && lastPush.current.questionId === pinned?.id
    ? lastPush.current.value : livePush;
  const pinnedOverlay = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = viewport.current, overlay = pinnedOverlay.current;
    if (!element || !overlay) return;
    let frame: number | null = null;
    const update = () => {
      frame = null;
      if (hasTranscriptSelection(selectionRoot.current)) return;
      const measuredNextTop = nextQuestion === undefined ? undefined : virtualizer.measurementsCache[nextQuestion.turnIndex]?.start;
      const value = measuredNextTop === undefined ? 0 : Math.min(0, measuredNextTop - element.scrollTop - PINNED_QUESTION_GAP - pinnedHeight - 14);
      overlay.style.transform = `translateY(${value}px)`;
      lastPush.current = { conversationId: conversationId, questionId: pinned?.id, value };
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
      <div ref={viewport} data-transcript-scrollbar="" className="h-full overflow-x-hidden overflow-y-auto [overflow-anchor:none] [scrollbar-width:none] [&::-webkit-scrollbar]:w-0" aria-label="Chat transcript">
        <div ref={content} className="v2-chat-rail min-h-full pb-3 pt-5">
          <div ref={leading} className="flow-root">
            {leadingContent}
            {hiddenMessageCount > 0 ? <Button variant="ghost" size="sm" className="mb-3 w-full text-xs text-muted-foreground" onClick={revealEarlier}>Show earlier messages ({hiddenMessageCount} hidden)</Button> : null}
          </div>
          <ProcessPresentationProvider key={conversationId} messageIds={ids} followingRef={scrolling.follow}>
          <div style={{ paddingTop: Math.max(0, (virtualItems[0]?.start ?? scrollMargin) - scrollMargin), paddingBottom: Math.max(0, virtualizer.getTotalSize() - ((virtualItems.at(-1)?.end ?? scrollMargin) - scrollMargin)) }}>
            {virtualItems.map((row, index) => (
              <div key={row.key} ref={virtualizer.measureElement} data-index={row.index} data-markdown-row="" className="flow-root"
                style={{ '--markdown-row-height': `${row.size}px`, marginTop: index === 0 ? 0 : Math.max(0, row.start - virtualItems[index - 1]!.end) } as CSSProperties}>
                {turns[row.index].messageIds.map((id) => {
                  const message = byId.get(id)!;
                  return <div key={id} className={message.replyEnd ? 'pb-6' : 'pb-2'}>
                    {renderMessage(id, { placeholder: pinned?.id === id && pinEntered, placeholderHeight: pinnedHeight })}
                  </div>;
                })}
              </div>
            ))}
          </div>
          </ProcessPresentationProvider>
          {trailingContent}
        </div>
      </div>
      {pinned === null ? null : <>
        <div ref={pinnedOverlay} className="v2-chat-rail pointer-events-none absolute inset-x-0 bottom-0 z-10" style={{ top: PINNED_QUESTION_GAP, transform: `translateY(${push}px)`, visibility: pinEntered ? 'visible' : 'hidden' }} inert={!pinEntered || undefined} aria-hidden={!pinEntered || undefined}>
          <div ref={pin} data-pinned-question={pinned.id} data-selection-turn={candidate?.index} className="pointer-events-auto max-h-full overflow-y-auto bg-background">
            {renderMessage(pinned.id, { placeholder: false, placeholderHeight: 0 })}
          </div>
        </div>
        <div data-pinned-top-mask="" aria-hidden="true" className="absolute inset-x-0 top-0 z-10 bg-background" style={{ height: PINNED_QUESTION_GAP, visibility: pinEntered ? 'visible' : 'hidden' }} />
      </>}
      {showNavigator ? <QuestionNavigator items={questions} activeIndex={activeQuestion} onNavigate={navigateQuestion} /> : null}
      {onQuote ? <SelectionToolbar viewport={viewport} selectionRoot={selectionRoot} onQuote={onQuote} onBtwQuote={onBtwQuote} /> : null}
      {scrolling.away ? (
        <Button variant="outline" size="icon-sm" aria-label="Scroll to bottom" className="absolute bottom-2 right-4 z-20 rounded-full" onClick={returnToBottom}><ArrowDown /></Button>
      ) : null}
    </div>
  );
}
