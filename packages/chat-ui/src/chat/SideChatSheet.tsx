import { useEffect, useLayoutEffect, useRef, type PointerEvent } from 'react';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '../ui/collapsible';
import { ArrowUp, ChevronRight, Clock3, MessageSquare, Quote, Square, X } from 'lucide-react';
import type { SideChatProps } from './sideChat';
import { useUiEnvironment } from '../environment';
import { formatSelectionQuote, parseSelectionQuote } from './selectionQuote';
import { useSmoothFollowScroll } from '../navigation/useSmoothFollowScroll';
import { Button } from '../ui/button';
import { DroidActivity } from '../ui/droid-motion';
import { Textarea } from '../ui/input';
import { Markdown } from '../content/Markdown';

export function SideChatSheet({ state, draft, quote, width, onDraftChange, onQuoteClear, onWidthChange, onDismiss, onAsk, onStop, maxTextLength }: SideChatProps) {
  const { assistantName } = useUiEnvironment();
  const panel = useRef<HTMLElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const opener = useRef(document.activeElement);
  const resize = useRef<{ id: number; x: number; width: number } | null>(null);
  const streaming = state.entries.some((entry) => entry.state === 'streaming');
  const unavailable = state.status === 'unsupported' || state.status === 'error';
  const canAsk = !unavailable && state.pendingQuestion === null;
  const preparing = state.status === 'preparing';
  const maxLength = Math.max(0, maxTextLength - (quote ? formatSelectionQuote(quote, '').length + 2 : 0));
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
    onAsk(formatSelectionQuote(quote ?? '', draft.trim()));
    onDraftChange('');
    onQuoteClear();
    follow.followNewest(true);
    input.current?.focus({ preventScroll: true });
  };
  return <aside ref={panel} aria-label="By the Way side chat" data-webview-overlay=""
    className="v2-btw-panel"
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
        {streaming || preparing ? <DroidActivity phase={preparing ? 'loading' : 'thinking'} /> : null}
        {unavailable ? 'Unavailable' : preparing ? 'Preparing' : streaming ? 'Answering' : null}
      </span>
      <Button variant="ghost" size="icon-sm" aria-label="Close By the Way" title="Close side conversation" onClick={onDismiss}><X /></Button>
    </header>
    <div ref={follow.viewportRef} aria-label="Side conversation" className="v2-btw-viewport">
      <div ref={follow.contentRef} className="v2-btw-transcript">
        {state.entries.length === 0 && !unavailable ? <div className="v2-btw-empty">
          <MessageSquare className="v2-btw-empty-mark" aria-hidden="true" />
          <p>A question on the side.</p>
          <span>Explore a detail without interrupting your main conversation.</span>
          <div className="v2-btw-empty-tip"><Quote aria-hidden="true" />
            <span>Select text in the main chat to use it here as context.</span>
          </div>
        </div> : null}
        {state.entries.map((entry) => {
          const parsed = parseSelectionQuote(entry.question);
          return <article key={entry.id} className="v2-btw-turn">
            <div aria-label="Your question" className="v2-btw-question">
              <div className="v2-btw-speaker">You</div>
              {parsed ? <BtwQuote text={parsed.quote} /> : null}
              <p>{parsed?.body ?? entry.question}</p>
            </div>
            <div aria-label={`${assistantName} answer`} className="v2-btw-answer">
              <div className="v2-btw-speaker">{assistantName}</div>
              {entry.answer.length === 0 && entry.state === 'streaming' ? <p className="v2-btw-thinking">Thinking…</p>
                : <Markdown text={entry.answer} streaming={entry.state === 'streaming'} />}
            </div>
            {entry.message ? <p role="alert" className="v2-btw-error">{entry.message}</p> : null}
          </article>;
        })}
      </div>
    </div>
    <footer className="v2-btw-footer">
      {state.pendingQuestion ? <div className="v2-btw-queued" role="status">
        <Clock3 aria-hidden="true" /><p title={parseSelectionQuote(state.pendingQuestion)?.body ?? state.pendingQuestion}>
          <span>Queued</span>{parseSelectionQuote(state.pendingQuestion)?.body ?? state.pendingQuestion}
        </p>
      </div> : null}
      {state.message ? <p role="alert" className="v2-btw-error">{state.message}</p> : null}
      <div className="v2-btw-composer">
        {quote ? <BtwQuote key={quote} text={quote} onClear={onQuoteClear} /> : null}
        <Textarea variant="plain" ref={input} className="dvx-btw-input v2-btw-input" rows={2} value={draft} maxLength={maxLength} disabled={unavailable}
          aria-label="By the Way question" placeholder={state.entries.length ? 'Ask a follow-up…' : 'Ask a side question…'} onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); send(); } }} />
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

function BtwQuote({ text, onClear }: { readonly text: string; readonly onClear?: () => void }) {
  return <Collapsible className="v2-btw-quote">
    <div className="v2-btw-quote-head">
      <CollapsibleTrigger asChild><Button variant="plain" size="none" className="v2-btw-quote-toggle" aria-label="Quoted context">
        <Quote aria-hidden="true" />
        <span className="v2-btw-quote-label">Quote</span>
        <span className="v2-btw-quote-preview">{text}</span>
        <ChevronRight className="v2-btw-quote-chevron" aria-hidden="true" />
      </Button></CollapsibleTrigger>
      {onClear ? <Button variant="ghost" size="icon-sm" aria-label="Remove quoted context" onClick={onClear}><X /></Button> : null}
    </div>
    <CollapsibleContent><blockquote className="v2-btw-quote-body">{text}</blockquote></CollapsibleContent>
  </Collapsible>;
}
