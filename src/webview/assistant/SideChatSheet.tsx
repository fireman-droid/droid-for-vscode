import { useEffect, useRef, useState } from 'react';

import {
  MAX_BTW_TEXT_LENGTH,
  type SessionBtwState,
} from '../../shared/btwProtocol';
import { DroidMarkdownContent } from './MarkdownText';
import { useSmoothFollowScroll } from './useSmoothFollowScroll';

/** Matches the collapse duration in styles.css (dvx-btw-collapse). */
const LEAVE_MS = 200;

/**
 * The `/btw` side question pane: a full-height split-pane column
 * living beside the main conversation (side-question-design.md §4.2,
 * Claude Code form factor per user decision 2026-08-12 — "它是共生
 * 的", not a drawer). Both panes stay interactive at once; there is
 * no scrim and no outside-press close. It closes on the `×` button,
 * Escape, or session changes — closing discards the hidden fork on
 * the host side.
 */
export function SideChatSheet({
  btw,
  onPrepare,
  onAsk,
  onStop,
  onDismiss,
}: {
  readonly btw: SessionBtwState;
  readonly onPrepare?: () => void;
  readonly onAsk: (text: string) => void;
  /** Stops the streaming answer, keeping its partial text. */
  readonly onStop?: () => void;
  readonly onDismiss: () => void;
}): React.JSX.Element {
  const [text, setText] = useState('');
  const [leaving, setLeaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dismissRef = useRef(onDismiss);
  const prepareRef = useRef(onPrepare);
  const {
    viewportRef: entriesRef,
    contentRef: entriesContentRef,
    followNewest,
  } = useSmoothFollowScroll<HTMLDivElement>();
  const previousEntryCountRef = useRef(btw.entries.length);
  dismissRef.current = onDismiss;
  prepareRef.current = onPrepare;

  const answerStreaming = btw.entries.some(
    (entry) => entry.state === 'streaming',
  );
  const streaming = btw.status === 'forking' || answerStreaming;
  const unavailable =
    btw.status === 'error' || btw.status === 'unsupported';
  // Typing stays available while an answer streams (user report
  // 2026-08-13); Enter now fills the Host-owned one-item pending slot.
  const inputDisabled = unavailable;
  const sendDisabled = unavailable;

  useEffect(() => {
    const entryCount = btw.entries.length;
    const newQuestion = entryCount > previousEntryCountRef.current;
    previousEntryCountRef.current = entryCount;
    followNewest(newQuestion);
  }, [btw, followNewest]);

  useEffect(() => {
    prepareRef.current?.();
    inputRef.current?.focus();
  }, []);

  // Play the width collapse before unmounting; the timeout doubles as
  // the reduced-motion path where the animation is disabled.
  useEffect(() => {
    if (!leaving) {
      return undefined;
    }
    if (
      window.matchMedia?.('(prefers-reduced-motion: reduce)')
        .matches === true
    ) {
      dismissRef.current();
      return undefined;
    }
    const timer = window.setTimeout(() => {
      dismissRef.current();
    }, LEAVE_MS);
    return () => window.clearTimeout(timer);
  }, [leaving]);

  const close = (): void => {
    setLeaving(true);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setLeaving(true);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const submit = (): void => {
    const trimmed = text.trim();
    if (
      trimmed.length === 0 ||
      trimmed.length > MAX_BTW_TEXT_LENGTH ||
      sendDisabled
    ) {
      return;
    }
    onAsk(trimmed);
    setText('');
  };

  return (
    <aside
      className={`dvx-btw-panel${leaving ? ' dvx-btw-leaving' : ''}`}
      role="complementary"
      aria-label="Side question"
    >
      <header className="dvx-btw-header">
        <span className="dvx-btw-title">Side question</span>
        <button
          type="button"
          className="dvx-btw-close"
          aria-label="Close side chat"
          onClick={close}
        >
          ×
        </button>
      </header>
      <p className="dvx-btw-hint">
        Ask a quick side question below without interrupting the
        conversation.
      </p>
      <div className="dvx-btw-entries" ref={entriesRef}>
        <div className="dvx-btw-entries-content" ref={entriesContentRef}>
          {btw.entries.map((entry) => (
            <div className="dvx-btw-entry" key={entry.id}>
              <button
                type="button"
                className="dvx-btw-question dvx-user-block"
                title="Jump to the start of this side question"
                onClick={(event) =>
                  event.currentTarget
                    .closest('.dvx-btw-entry')
                    ?.scrollIntoView({
                      behavior: window.matchMedia?.(
                        '(prefers-reduced-motion: reduce)',
                      ).matches
                        ? 'auto'
                        : 'smooth',
                      block: 'start',
                    })
                }
              >
                <span className="dvx-user-text">{entry.question}</span>
              </button>
              {entry.answer.length > 0 ? (
                <DroidMarkdownContent
                  text={entry.answer}
                  className="dvx-markdown dvx-btw-answer"
                />
              ) : null}
              {entry.state === 'streaming' &&
              entry.answer.length === 0 ? (
                <div className="dvx-btw-status" role="status">
                  Answering…
                </div>
              ) : null}
              {entry.state === 'error' ? (
                <div className="dvx-btw-status" role="status">
                  {entry.message ?? 'Side question failed.'}
                </div>
              ) : null}
            </div>
          ))}
          {btw.status === 'forking' ? (
            <div className="dvx-btw-status" role="status">
              Preparing side chat…
            </div>
          ) : null}
          {btw.pendingQuestion === null ? null : (
            <div className="dvx-btw-pending" role="status">
              <span>Next</span>
              <span>{btw.pendingQuestion}</span>
            </div>
          )}
          {unavailable ? (
            <div className="dvx-btw-error" role="alert">
              {btw.message ?? 'Side chat is unavailable.'}
            </div>
          ) : null}
        </div>
      </div>
      <div className="dvx-btw-input-row">
        <label className="dvx-visually-hidden" htmlFor="dvx-btw-input">
          Ask a side question
        </label>
        <input
          id="dvx-btw-input"
          ref={inputRef}
          className="dvx-btw-input"
          type="text"
          value={text}
          placeholder={
            btw.pendingQuestion !== null
              ? 'Replace queued question…'
              : streaming
                ? 'Queue next question…'
                : 'Ask a side question…'
          }
          autoComplete="off"
          maxLength={MAX_BTW_TEXT_LENGTH}
          disabled={inputDisabled}
          onChange={(event) => setText(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              submit();
            }
          }}
        />
        {answerStreaming && onStop !== undefined ? (
          <button
            type="button"
            className="dvx-btw-send dvx-btw-stop"
            aria-label="Stop answering"
            onClick={onStop}
          >
            ■
          </button>
        ) : (
          <button
            type="button"
            className="dvx-btw-send"
            aria-label="Send side question"
            disabled={sendDisabled || text.trim().length === 0}
            onClick={submit}
          >
            ↑
          </button>
        )}
      </div>
    </aside>
  );
}
