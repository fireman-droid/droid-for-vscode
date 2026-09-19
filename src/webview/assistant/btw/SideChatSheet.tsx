import {
  useEffect,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';

import {
  MAX_BTW_TEXT_LENGTH,
  type SessionBtwState,
} from '../../../shared/protocol/btwProtocol';
import { DroidMarkdownContent } from '../markdown/MarkdownText';
import { formatSelectionQuote, parseSelectionQuote } from './selectionQuote';
import { SendIcon } from '../thread/icons';
import { useSmoothFollowScroll } from '../thread/navigation/useSmoothFollowScroll';

const MIN_PANEL_WIDTH = 220;
const MAX_PANEL_WIDTH = 520;
const MIN_MAIN_WIDTH = 160;

function clampPanelWidth(width: number): number {
  return Math.min(
    Math.max(MIN_PANEL_WIDTH, width),
    MAX_PANEL_WIDTH,
    Math.max(MIN_PANEL_WIDTH, window.innerWidth - MIN_MAIN_WIDTH),
  );
}

function QuietQuote({
  text,
  onDismiss,
}: {
  readonly text: string;
  readonly onDismiss?: () => void;
}): React.JSX.Element {
  return (
    <div className="dvx-quiet-quote">
      <span>{text}</span>
      {onDismiss === undefined ? null : (
        <button type="button" aria-label="Remove quoted context" onClick={onDismiss}>
          ×
        </button>
      )}
    </div>
  );
}

function SideQuestion({ text }: { readonly text: string }): React.JSX.Element {
  const parsed = parseSelectionQuote(text);
  return (
    <div className="dvx-btw-question">
      {parsed === null ? null : <QuietQuote text={parsed.quote} />}
      <div className="dvx-btw-question-text">{parsed?.body ?? text}</div>
    </div>
  );
}

export function SideChatSheet({
  state,
  draft,
  quote,
  width,
  onDraftChange,
  onQuoteClear,
  onWidthChange,
  onDismiss,
  onAsk,
  onStop,
}: {
  readonly state: SessionBtwState;
  readonly draft: string;
  readonly quote: string | null;
  readonly width: number;
  readonly onDraftChange: (draft: string) => void;
  readonly onQuoteClear: () => void;
  readonly onWidthChange: (width: number) => void;
  readonly onDismiss: () => void;
  readonly onAsk: (text: string) => void;
  readonly onStop: () => void;
}): React.JSX.Element {
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const resizeRef = useRef<{
    readonly pointerId: number;
    readonly startX: number;
    readonly startWidth: number;
  } | null>(null);
  const streaming = state.entries.some((entry) => entry.state === 'streaming');
  const canAsk =
    state.status !== 'unsupported' &&
    state.status !== 'error' &&
    state.pendingQuestion === null;
  const quotePrefix =
    quote === null ? '' : formatSelectionQuote(quote, '').concat('\n\n');
  const maxDraftLength = Math.max(0, MAX_BTW_TEXT_LENGTH - quotePrefix.length);
  const {
    viewportRef: entriesRef,
    contentRef: entriesContentRef,
    followNewest,
  } = useSmoothFollowScroll<HTMLDivElement>();

  useEffect(() => {
    followNewest();
  }, [followNewest, state.entries, state.pendingQuestion]);

  useLayoutEffect(() => {
    const input = inputRef.current;
    if (input === null) {
      return;
    }
    input.style.height = '0';
    input.style.height = `${Math.min(input.scrollHeight, 96)}px`;
  }, [draft]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onDismiss();
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [onDismiss]);

  const submit = (): void => {
    const body = draft.trim();
    if (!canAsk || body.length === 0) {
      return;
    }
    onAsk(formatSelectionQuote(quote ?? '', body));
    onDraftChange('');
    onQuoteClear();
  };
  const handleResizeMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const resize = resizeRef.current;
    if (resize === null || resize.pointerId !== event.pointerId) {
      return;
    }
    onWidthChange(clampPanelWidth(resize.startWidth + resize.startX - event.clientX));
  };
  const stopResize = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (resizeRef.current?.pointerId === event.pointerId) {
      resizeRef.current = null;
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <aside
      className="dvx-btw-panel"
      aria-label="By the Way side chat"
      style={{ '--dvx-btw-width': `${width}px` } as CSSProperties}
    >
      <div
        className="dvx-btw-resizer"
        role="separator"
        aria-label="Resize By the Way panel"
        aria-orientation="vertical"
        tabIndex={0}
        onPointerDown={(event) => {
          resizeRef.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startWidth: width,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={handleResizeMove}
        onPointerUp={stopResize}
        onPointerCancel={stopResize}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
            return;
          }
          event.preventDefault();
          onWidthChange(clampPanelWidth(width + (event.key === 'ArrowLeft' ? 16 : -16)));
        }}
      />
      <header className="dvx-btw-header">
        <div>
          <h2 className="dvx-btw-title">BTW</h2>
          <p className="dvx-btw-subtitle">
            Side chat · doesn’t change the main conversation
          </p>
        </div>
        <button
          type="button"
          className="dvx-btw-close"
          onClick={onDismiss}
          aria-label="Close By the Way"
        >
          ×
        </button>
      </header>
      <div ref={entriesRef} className="dvx-btw-entries">
        <div ref={entriesContentRef} className="dvx-btw-entries-content">
          {state.entries.length === 0 && state.status === 'forking' ? (
            <p className="dvx-btw-status">Preparing…</p>
          ) : null}
          {state.entries.length === 0 && state.status === 'ready' ? (
            <p className="dvx-btw-empty">
              Ask a quick question without interrupting your main chat.
            </p>
          ) : null}
          {state.entries.map((entry) => (
            <article key={entry.id} className="dvx-btw-entry">
              <div className="dvx-btw-message dvx-btw-message-user">
                <span className="dvx-btw-role">You</span>
                <SideQuestion text={entry.question} />
              </div>
              <div className="dvx-btw-message dvx-btw-message-droid">
                <span className="dvx-btw-role">Droid</span>
                <div className="dvx-btw-answer">
                  {entry.answer.length === 0 && entry.state === 'streaming' ? (
                    <span className="dvx-btw-status">Thinking…</span>
                  ) : (
                    <DroidMarkdownContent text={entry.answer} />
                  )}
                </div>
              </div>
              {entry.message === null ? null : (
                <p className="dvx-btw-error">{entry.message}</p>
              )}
            </article>
          ))}
        </div>
      </div>
      <div className="dvx-btw-composer">
        {state.pendingQuestion === null ? null : (
          <div className="dvx-btw-pending">
            <span className="dvx-btw-pending-label">Queued</span>
            <span>
              {parseSelectionQuote(state.pendingQuestion)?.body ?? state.pendingQuestion}
            </span>
          </div>
        )}
        {state.message === null ? null : <p className="dvx-btw-error">{state.message}</p>}
        {quote === null ? null : <QuietQuote text={quote} onDismiss={onQuoteClear} />}
        <div className="dvx-btw-input-row">
          <textarea
            ref={inputRef}
            className="dvx-btw-input"
            value={draft}
            rows={1}
            maxLength={maxDraftLength}
            disabled={!canAsk}
            placeholder="Ask a side question…"
            aria-label="By the Way question"
            onChange={(event) => onDraftChange(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key === 'Enter' &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                submit();
              }
            }}
          />
        </div>
        <div className="dvx-btw-input-actions">
          <span className="dvx-btw-input-hint">
            Enter to send · Shift+Enter for a new line
          </span>
          {streaming ? (
            <button
              type="button"
              className="dvx-btw-send dvx-btw-stop"
              onClick={onStop}
              aria-label="Stop side answer"
            >
              Stop
            </button>
          ) : (
            <button
              type="button"
              className="dvx-btw-send"
              onClick={submit}
              disabled={!canAsk || draft.trim().length === 0}
              aria-label="Send side question"
            >
              <SendIcon />
              <span>Send</span>
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}
