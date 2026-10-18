import { useI18n } from '../i18n';
import { useEffect, useRef, type PointerEvent } from 'react';
import { Aperture, ArrowUp, Clock3, MessageSquare, Quote, X } from 'lucide-react';
import { AnswerStopButton } from './AnswerStopButton';
import type { SideChatProps } from './sideChat';
import { useUiEnvironment } from '../environment';
import { formatSelectionQuotes, parseSelectionQuotes } from './selectionQuote';
import { useSmoothFollowScroll } from '../navigation/useSmoothFollowScroll';
import { Button } from '../ui/button';
import { DroidActivity } from '../ui/droid-motion';
import type { InlineInputHandle } from '../ui/inline-input';
import { QuoteChips } from './QuoteChips';
import { SideReply } from './SideReply';
import { ReferencedText } from './CodeReferenceChips';
import { CodeReferenceInput } from './CodeReferenceInput';
import { useCodeReferenceDraft } from './useCodeReferenceDraft';

export function SideChatSheet({ state, draft, quote, quotes, notice, width, onDraftChange, onQuoteClear, onQuoteRemove, onWidthChange, onDismiss, onAsk, onStop, maxTextLength,
  attachments, composerActions, composerStatus, headerActions, hasAttachments = false, sendDisabled = false, onPaste, onDrop, onDragOver, renderImages }: SideChatProps) {
  const { t } = useI18n();
  const { assistantName } = useUiEnvironment();
  const panel = useRef<HTMLElement>(null);
  const input = useRef<InlineInputHandle>(null);
  const composer = useRef<HTMLDivElement>(null);
  const opener = useRef(document.activeElement);
  const resize = useRef<{ id: number; x: number; width: number } | null>(null);
  const activeEntry = state.entries.find((entry) => entry.state === 'streaming');
  const streaming = activeEntry !== undefined;
  const unavailable = state.status === 'unsupported' || state.status === 'error';
  const canAsk = !unavailable && state.pendingQuestion === null;
  const preparing = state.status === 'preparing';
  const composeHint = state.pendingQuestion !== null ? t('Continue drafting') : null;
  const quotedContext = quotes ?? (quote ? [quote] : []);
  const removeQuote = onQuoteRemove ?? (quotes === undefined ? onQuoteClear : undefined);
  const quotePrefix = formatSelectionQuotes(quotedContext, '');
  const maxLength = Math.max(0, maxTextLength - quotePrefix.length);
  const canSend = canAsk && !sendDisabled && (Boolean(draft.trim()) || hasAttachments) && draft.length <= maxLength;
  const showStop = streaming && (!canSend || state.stopping);
  const references = useCodeReferenceDraft(draft, onDraftChange, maxLength);
  const pendingQuote = state.pendingQuestion ? parseSelectionQuotes(state.pendingQuestion) : null;
  const pendingBody = pendingQuote?.body ?? state.pendingQuestion;
  const follow = useSmoothFollowScroll<HTMLDivElement>();
  useEffect(() => { follow.followNewest(); }, [follow.followNewest, state.entries, state.pendingQuestion]);
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
    if (!canAsk || sendDisabled || (!draft.trim() && !hasAttachments) || draft.length > maxLength) return;
    onAsk(formatSelectionQuotes(quotedContext, draft.trim()));
    follow.followNewest(true);
    input.current?.focus({ preventScroll: true });
  };
  return <aside ref={panel} aria-label={t("By the Way side chat")} data-webview-overlay=""
    className="v2-btw-panel v2-chat-surface"
    style={{ width: `min(${width}px,calc(100vw - 160px))` }}>
    <div role="separator" aria-label={t("Resize By the Way panel")} aria-orientation="vertical" aria-valuemin={220} aria-valuemax={520} aria-valuenow={width} tabIndex={0}
      className="v2-btw-resizer"
      onPointerDown={(event) => { resize.current = { id: event.pointerId, x: event.clientX, width: panel.current!.getBoundingClientRect().width }; event.currentTarget.setPointerCapture(event.pointerId); }}
      onPointerMove={(event) => { if (resize.current?.id === event.pointerId) onWidthChange(clampWidth(resize.current.width + resize.current.x - event.clientX)); }}
      onPointerUp={stopResize} onPointerCancel={stopResize} onKeyDown={(event) => {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); onWidthChange(clampWidth(width + (event.key === 'ArrowLeft' ? 16 : -16))); }
      }} />
    <header className="v2-btw-header">
      <div className="v2-btw-heading">
        <h2>BTW</h2>
      </div>
      {headerActions}
      <Button variant="ghost" size="icon-sm" aria-label={t("Close By the Way")} title={t("Close side conversation")} onClick={onDismiss}><X /></Button>
    </header>
    <div ref={follow.viewportRef} aria-label={t("Side conversation")} className="v2-btw-viewport">
      <div ref={follow.contentRef} className="v2-btw-transcript">
        {preparing && !state.entries.length ? <p role="status" className="v2-btw-progress"><DroidActivity phase="loading" />{t('Preparing')}</p> : null}
        {state.entries.length === 0 && !unavailable && !preparing ? <div className="v2-btw-empty">
          <MessageSquare className="v2-btw-empty-mark" aria-hidden="true" />
          <p>{t("A question on the side.")}</p>
          <span>{t("Explore a detail without interrupting your main conversation.")}</span>
          <div className="v2-btw-empty-tip"><Quote aria-hidden="true" />
            <span>{t("Select text in the main chat to use it here as context.")}</span>
          </div>
        </div> : null}
        {state.entries.map((entry) => {
          const parsed = parseSelectionQuotes(entry.question);
          return <article key={entry.id} className="v2-btw-turn">
            <div className="v2-btw-question">
                <div role="region" aria-label={t("Your question")} tabIndex={0} className="v2-btw-question-content">
                  {parsed ? <QuoteChips quotes={parsed.quotes} className="mb-2" /> : null}
                  {entry.images?.length ? renderImages?.(entry.images) : null}
                  <div className="select-text"><span className="v2-btw-speaker">{t('You')}</span><ReferencedText text={parsed?.body ?? entry.question} /></div>
                </div>
            </div>
            <div aria-label={t("{p0} answer", { p0: assistantName })} className="v2-btw-answer">
              <div className="v2-btw-author"><Aperture aria-hidden="true" />{assistantName}</div>
              <SideReply entry={entry} preparing={preparing} />
            </div>
            {entry.message ? <p role="alert" className="v2-btw-error">{entry.message}</p> : null}
          </article>;
        })}
      </div>
    </div>
    <footer className="v2-btw-footer">
      {state.pendingQuestion !== null ? <div className="v2-btw-queued" role="status">
        <Clock3 aria-hidden="true" /><div className="min-w-0 flex-1 space-y-1">
          <div><span>{t("Next question")}</span><p><ReferencedText text={pendingBody ?? ''} /></p></div>
          {pendingQuote ? <QuoteChips quotes={pendingQuote.quotes} /> : null}
        </div>
      </div> : null}
      {state.message ? <p role="alert" className="v2-btw-error">{state.message}</p> : null}
      {state.pendingImages?.length ? renderImages?.(state.pendingImages) : null}
      <div ref={composer} data-composer-surface="" data-has-status={Boolean(composerStatus) || undefined} className="v2-btw-composer" onDrop={onDrop} onDragOver={onDragOver}>
        {composerStatus ? <div className="v2-btw-composer-status">{composerStatus}</div> : null}
        <div className="v2-btw-compose-content">
        {attachments}
        <QuoteChips quotes={quotedContext} previewAnchor={composer} onRemove={removeQuote ? (index) => { removeQuote(index); input.current?.focus({ preventScroll: true }); } : undefined} className="mb-2" />
        <CodeReferenceInput ref={input} draft={references} className="dvx-btw-input v2-btw-input" disabled={unavailable}
          aria-label={t("By the Way question")} placeholder={state.entries.length ? t("Ask a follow-up…") : t("Ask a side question…")}
          onPaste={onPaste}
          onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); send(); } }} />
        </div>
        {notice ? <p role="status" className="mt-1 text-[11px] leading-4 text-muted-foreground">{notice}</p> : null}
        {composerActions && composeHint ? <div className="v2-btw-compose-hint">{composeHint}</div> : null}
        <div className="v2-btw-compose-actions">
          {composerActions}
          {!composerActions ?
          <span className="v2-btw-compose-hint">{maxLength - draft.length < 200 ? t("{p0} left", { p0: maxLength - draft.length })
            : composeHint}</span> : null}
          {showStop ? <AnswerStopButton className="v2-btw-send" stopping={state.stopping} onStop={onStop} />
            : <Button size="none" variant="plain" className="v2-btw-send" aria-label={t(streaming ? 'Queue follow-up' : 'Send side question')}
              title={t(streaming ? 'Send after the current answer · Enter' : 'Send · Enter')} disabled={!canSend} onClick={send}><ArrowUp /></Button>}
        </div>
      </div>
    </footer>
  </aside>;
}
