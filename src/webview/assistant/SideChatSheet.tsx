import { useEffect, useRef, useState } from 'react';

import {
  MAX_BTW_TEXT_LENGTH,
  type SessionBtwState,
} from '../../shared/btwProtocol';
import { DroidMarkdownContent } from './MarkdownText';

/** Matches the slide-out duration in styles.css (dvx-btw-slide-out). */
const LEAVE_MS = 200;

/**
 * The `/btw` side question panel: a full-height sheet sliding in from
 * the webview's right edge over a scrim (side-question-design.md §4.2,
 * Claude Code form factor per user decision 2026-08-12). It closes on
 * the `×` button, the scrim, Escape, or session changes — closing
 * discards the hidden fork on the host side.
 */
export function SideChatSheet({
  btw,
  onAsk,
  onDismiss,
}: {
  readonly btw: SessionBtwState;
  readonly onAsk: (text: string) => void;
  readonly onDismiss: () => void;
}): React.JSX.Element {
  const [text, setText] = useState('');
  const [leaving, setLeaving] = useState(false);
  const entriesRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  const streaming =
    btw.status === 'forking' ||
    btw.entries.some((entry) => entry.state === 'streaming');
  const unavailable =
    btw.status === 'error' || btw.status === 'unsupported';
  const inputDisabled = streaming || unavailable;

  // Keep the newest answer text in view while it streams in.
  useEffect(() => {
    const element = entriesRef.current;
    if (element !== null) {
      element.scrollTop = element.scrollHeight;
    }
  }, [btw]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Play the slide-out before unmounting; the timeout doubles as the
  // reduced-motion path where the animation is disabled.
  useEffect(() => {
    if (!leaving) {
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
      inputDisabled
    ) {
      return;
    }
    onAsk(trimmed);
    setText('');
  };

  return (
    <div
      className={`dvx-btw-overlay${leaving ? ' dvx-btw-leaving' : ''}`}
      role="presentation"
    >
      <div
        className="dvx-btw-scrim"
        aria-hidden="true"
        onClick={close}
      />
      <aside
        className="dvx-btw-panel"
        role="dialog"
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
          {btw.entries.map((entry) => (
            <div className="dvx-btw-entry" key={entry.id}>
              <div className="dvx-btw-question">{entry.question}</div>
              {entry.answer.length > 0 ? (
                <DroidMarkdownContent
                  text={entry.answer}
                  className="dvx-markdown dvx-btw-answer"
                />
              ) : null}
              {entry.state === 'streaming' &&
              entry.answer.length === 0 ? (
                <div className="dvx-btw-status" role="status">
                  <span className="dvx-shimmer-text">Answering…</span>
                </div>
              ) : null}
              {entry.state === 'error' ? (
                <div className="dvx-btw-error" role="status">
                  {entry.message ??
                    'Droid could not answer this side question.'}
                </div>
              ) : null}
            </div>
          ))}
          {btw.status === 'forking' ? (
            <div className="dvx-btw-status" role="status">
              <span className="dvx-shimmer-text">
                Starting side chat…
              </span>
            </div>
          ) : null}
          {unavailable ? (
            <div className="dvx-btw-error" role="alert">
              {btw.message ?? 'Side chat is unavailable.'}
            </div>
          ) : null}
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
              streaming ? 'Answering…' : 'Ask a side question…'
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
          <button
            type="button"
            className="dvx-btw-send"
            aria-label="Send side question"
            disabled={inputDisabled || text.trim().length === 0}
            onClick={submit}
          >
            ↑
          </button>
        </div>
      </aside>
    </div>
  );
}
