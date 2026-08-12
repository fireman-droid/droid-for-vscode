import { useEffect, useRef, useState } from 'react';

import {
  MAX_BTW_TEXT_LENGTH,
  type SessionBtwState,
} from '../../shared/btwProtocol';
import { ComposerPopup } from './ComposerPopup';
import { DroidMarkdownContent } from './MarkdownText';

/**
 * The `/btw` Side Chat card anchored above the composer
 * (side-question-design.md §4.2). Reuses the `@`/`/` popup shell and
 * geometry but stays open across outside presses — it closes on the
 * `×` button, Escape, or session changes (discard-on-close: the
 * hidden fork is torn down by the host).
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
  // The popup root is the scroll container (its sticky header and
  // input row stay pinned), matching ComposerPopup's wheel-containment
  // assumption.
  const popupRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const streaming =
    btw.status === 'forking' ||
    btw.entries.some((entry) => entry.state === 'streaming');
  const unavailable =
    btw.status === 'error' || btw.status === 'unsupported';
  const inputDisabled = streaming || unavailable;

  // Keep the newest answer text in view while it streams in.
  useEffect(() => {
    const element = popupRef.current;
    if (element !== null) {
      element.scrollTop = element.scrollHeight;
    }
  }, [btw]);

  useEffect(() => {
    inputRef.current?.focus();
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
    <ComposerPopup
      className="dvx-mention-popup dvx-btw-popup"
      label="Side chat"
      role="dialog"
      dismissOnOutsidePress={false}
      onDismiss={onDismiss}
      popupRef={popupRef}
    >
      <div className="dvx-btw-header">
        <span className="dvx-btw-title">Side chat</span>
        <button
          type="button"
          className="dvx-btw-close"
          aria-label="Close side chat"
          onClick={onDismiss}
        >
          ×
        </button>
      </div>
      <div className="dvx-btw-entries">
        {btw.entries.length === 0 && !unavailable ? (
          <div className="dvx-btw-hint">
            Ask a quick side question without interrupting the main
            conversation.
          </div>
        ) : null}
        {btw.entries.map((entry) => (
          <div className="dvx-btw-entry" key={entry.id}>
            <div className="dvx-btw-question">{entry.question}</div>
            {entry.answer.length > 0 ? (
              <DroidMarkdownContent
                text={entry.answer}
                className="dvx-markdown dvx-btw-answer"
              />
            ) : null}
            {entry.state === 'streaming' && entry.answer.length === 0 ? (
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
            <span className="dvx-shimmer-text">Starting side chat…</span>
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
          placeholder={streaming ? 'Answering…' : 'Ask a side question…'}
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
      </div>
    </ComposerPopup>
  );
}
