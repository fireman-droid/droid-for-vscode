import { useEffect, useLayoutEffect, useRef, type PointerEvent } from 'react';
import { ArrowUp, Clock3, MessageSquare, Quote, Square, X } from 'lucide-react';
import type { SideChatProps } from './sideChat';
import { useUiEnvironment } from '../environment';
import { formatSelectionQuotes, parseSelectionQuotes } from './selectionQuote';
import { useSmoothFollowScroll } from '../navigation/useSmoothFollowScroll';
import { Button } from '../ui/button';
import { DroidActivity } from '../ui/droid-motion';
import { Textarea } from '../ui/input';
import { Markdown } from '../content/Markdown';
import { QuoteChips } from './QuoteChips';
import { UserMessageBubble } from './UserMessageView';

const PROGRESS_LABELS = {
  waiting: 'Waiting for reply…', thinking: 'Thinking…', tool: 'Using tools…', answering: 'Receiving reply…',
};

export function SideChatSheet({ state, draft, quote, quotes, notice, width, onDraftChange, onQuoteClear, onQuoteRemove, onWidthChange, onDismiss, onAsk, onStop, maxTextLength }: SideChatProps) {
  const { assistantName } = useUiEnvironment();
  const panel = useRef<HTMLElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const opener = useRef(document.activeElement);
  const resize = useRef<{ id: number; x: number; width: number } | null>(null);
  const activeEntry = state.entries.find((entry) => entry.state === 'streaming');
  const streaming = activeEntry !== undefined;
  const activeProgress = activeEntry?.progress ?? (activeEntry?.answer ? 'answering' : 'waiting');
  const unavailable = state.status === 'unsupported' || state.status === 'error';
  const canAsk = !unavailable && state.pendingQuestion === null;
  const preparing = state.status === 'preparing';
  const quotedContext = quotes ?? (quote ? [quote] : []);
  const removeQuote = onQuoteRemove ?? (quotes === undefined ? onQuoteClear : undefined);
  const quotePrefix = formatSelectionQuotes(quotedContext, '');
  const maxLength = Math.max(0, maxTextLength - quotePrefix.length);
  const pendingQuote = state.pendingQuestion ? parseSelectionQuotes(state.pendingQuestion) : null;
  const pendingBody = pendingQuote?.body ?? state.pendingQuestion;
  const follow = useSmoothFollowScroll<HTMLDivElement>();
  useEffect(() => { follow.followNewest(); }, [follow.followNewest, state.entries, state.pendingQuestion]);
  useLayoutEffect(() => {
    const element = input.current;
    if (!element) return;
    const shadow = element.cloneNode(false) as HTMLTextAreaElement;
    shadow.removeAttribute('id');
    shadow.setAttribute('aria-hidden', 'true');
    shadow.inert = true;
    shadow.value = element.value;
    Object.assign(shadow.style, {
      position: 'fixed', top: '0', left: '0', width: `${element.getBoundingClientRect().width}px`,
      height: '0', minHeight: '0', visibility: 'hidden', overflow: 'hidden', pointerEvents: 'none',
    });
    element.parentElement!.appendChild(shadow);
    const height = Math.min(144, Math.max(44, shadow.scrollHeight));
    shadow.remove();
    if (element.style.height !== `${height}px`) element.style.height = `${height}px`;
  }, [draft, width]);
  useEffect(() => {
    input.current?.focus({ preventScroll: true });
    return () => { if (opener.current instanceof HTMLElement && opener.current.isConnected) opener.current.focus({ preventScroll: true }); };
  }, []);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.isComposing && !event.defaultPrevented &&
        event.target instanceof Node && panel.current?.contains(event.target)) {
        event.preventDefault();
        onDismiss();
      }
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [onDismiss]);
  const clampWidth = (next: number) => Math.min(520, Math.max(220, next), Math.max(220, window.innerWidth - 160));
  const stopResize = (event: PointerEvent<HTMLDivElement>) => {
    if (resize.current?.id !== event.pointerId) return;
    resize.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const send = () => {
    if (!canAsk || !draft.trim() || draft.length > maxLength) return;
    onAsk(formatSelectionQuotes(quotedContext, draft.trim()));
    onDraftChange('');
    onQuoteClear();
    follow.followNewest(true);
    input.current?.focus({ preventScroll: true });
  };
  return <aside ref={panel} aria-label="By the Way side chat" data-webview-overlay=""
    className="v2-btw-panel v2-chat-surface"
    style={{ width: `min(${width}px,calc(100vw - 160px))` }}>
    <div role="separator" aria-label="Resize By the Way panel" aria-orientation="vertical" aria-valuemin={220} aria-valuemax={520} aria-valuenow={width} tabIndex={0}
      className="v2-btw-resizer"
      onPointerDown={(event) => { resize.current = { id: event.pointerId, x: event.clientX, width: panel.current!.getBoundingClientRect().width }; event.currentTarget.setPointerCapture(event.pointerId); }}
      onPointerMove={(event) => { if (resize.current?.id === event.pointerId) onWidthChange(clampWidth(resize.current.width + resize.current.x - event.clientX)); }}
      onPointerUp={stopResize} onPointerCancel={stopResize} onKeyDown={(event) => {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); onWidthChange(clampWidth(width + (event.key === 'ArrowLeft' ? 16 : -16))); }
      }} />
    <header className="v2-btw-header">
      <div className="v2-btw-heading">
        <h2 title="By the way">By the way</h2>
        <p>Side conversation</p>
      </div>
      <span role="status" className="v2-btw-status" data-unavailable={unavailable || undefined}>
        {streaming || preparing ? <DroidActivity phase={preparing || activeProgress === 'waiting' ? 'loading' : activeProgress === 'thinking' ? 'thinking' : 'working'} /> : null}
        {unavailable ? 'Unavailable' : preparing ? 'Preparing' : streaming
          ? activeProgress === 'waiting' ? 'Waiting' : activeProgress === 'thinking' ? 'Thinking' : activeProgress === 'tool' ? 'Using tools' : 'Answering' : null}
      </span>
      <Button variant="ghost" size="icon-sm" aria-label="Close By the Way" title="Close side conversation" onClick={onDismiss}><X /></Button>
    </header>
    <div ref={follow.viewportRef} aria-label="Side conversation" className="v2-btw-viewport">
      <div ref={follow.contentRef} className="v2-btw-transcript">
        {state.entries.length === 0 && !unavailable && !preparing ? <div className="v2-btw-empty">
          <MessageSquare className="v2-btw-empty-mark" aria-hidden="true" />
          <p>A question on the side.</p>
          <span>Explore a detail without interrupting your main conversation.</span>
          <div className="v2-btw-empty-tip"><Quote aria-hidden="true" />
            <span>Select text in the main chat to use it here as context.</span>
          </div>
        </div> : null}
        {state.entries.length === 0 && preparing ? <p role="status" className="v2-btw-progress"><DroidActivity phase="loading" />Preparing side conversation…</p> : null}
        {state.entries.map((entry) => {
          const parsed = parseSelectionQuotes(entry.question);
          const progress = entry.progress ?? (entry.answer ? 'answering' : 'waiting');
          return <article key={entry.id} className="v2-btw-turn">
            <div className="v2-btw-question">
              <UserMessageBubble>
                <div role="region" aria-label="Your question" tabIndex={0} className="v2-btw-question-content">
                  {parsed ? <QuoteChips quotes={parsed.quotes} className="mb-2" /> : null}
                  <p>{parsed?.body ?? entry.question}</p>
                </div>
              </UserMessageBubble>
            </div>
            <div aria-label={`${assistantName} answer`} className="v2-btw-answer">
              {entry.answer.length > 0 ? <Markdown text={entry.answer} streaming={entry.state === 'streaming'} /> : null}
              {entry.state === 'streaming' ? <p role="status" aria-live="polite" className="v2-btw-progress">
                <DroidActivity phase={preparing || progress === 'waiting' ? 'loading' : progress === 'thinking' ? 'thinking' : 'working'} />
                {preparing ? 'Preparing side conversation…' : PROGRESS_LABELS[progress]}
              </p> : null}
            </div>
            {entry.message ? <p role="alert" className="v2-btw-error">{entry.message}</p> : null}
          </article>;
        })}
      </div>
    </div>
    <footer className="v2-btw-footer">
      {state.pendingQuestion ? <div className="v2-btw-queued" role="status">
        <Clock3 aria-hidden="true" /><div className="min-w-0 flex-1 space-y-1">
          <p title={pendingBody ?? undefined}><span>Queued</span>{pendingBody}</p>
          {pendingQuote ? <QuoteChips quotes={pendingQuote.quotes} /> : null}
        </div>
      </div> : null}
      {state.message ? <p role="alert" className="v2-btw-error">{state.message}</p> : null}
      <div data-composer-surface="" className="v2-btw-composer">
        <QuoteChips quotes={quotedContext} onRemove={removeQuote ? (index) => { removeQuote(index); input.current?.focus({ preventScroll: true }); } : undefined} className="mb-2" />
        <Textarea variant="plain" ref={input} className="dvx-btw-input v2-btw-input" rows={2} value={draft} maxLength={maxLength} disabled={unavailable}
          aria-label="By the Way question" placeholder={state.entries.length ? 'Ask a follow-up…' : 'Ask a side question…'} onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); send(); } }} />
        {notice ? <p role="status" className="mt-1 text-[11px] leading-4 text-muted-foreground">{notice}</p> : null}
        <div className="v2-btw-compose-actions">
          <span className="v2-btw-compose-hint">{maxLength - draft.length < 200 ? `${maxLength - draft.length} left`
            : state.pendingQuestion ? 'Continue drafting' : streaming ? 'Enter to queue follow-up' : 'Shift + Enter for a new line'}</span>
          {streaming ? <Button size="none" variant="plain" className="v2-btw-send" aria-label="Stop side answer" title="Stop side answer" onClick={onStop}><Square className="fill-current" /></Button>
            : <Button size="none" variant="plain" className="v2-btw-send" aria-label="Send side question"
              title="Send · Enter" disabled={!canAsk || !draft.trim() || draft.length > maxLength} onClick={send}><ArrowUp /></Button>}
        </div>
      </div>
    </footer>
  </aside>;
}
