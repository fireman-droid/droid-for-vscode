import { useEffect, useRef, useState } from 'react';

import {
  MAX_BTW_TEXT_LENGTH,
  type SessionBtwState,
} from '../../shared/btwProtocol';
import {
  applyFollowScroll,
  applyFollowWheelIntent,
  createFollowState,
} from './followScroll';
import { DroidMarkdownContent } from './MarkdownText';

/** Matches the collapse duration in styles.css (dvx-btw-collapse). */
const LEAVE_MS = 200;
const FOLLOW_EASE = 0.24;
const FOLLOW_SETTLED_PX = 0.5;

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
  const entriesRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dismissRef = useRef(onDismiss);
  const prepareRef = useRef(onPrepare);
  const followNewestRef = useRef<(force?: boolean) => void>(
    () => undefined,
  );
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

  // Move with the growing answer instead of jumping once per 50ms
  // Host projection. An upward user gesture detaches follow; reaching
  // the bottom or asking a new question rejoins it.
  useEffect(() => {
    const element = entriesRef.current;
    if (element === null) {
      return undefined;
    }
    const follow = createFollowState({
      scrollTop: element.scrollTop,
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
    });
    const reducedMotion = window.matchMedia?.(
      '(prefers-reduced-motion: reduce)',
    );
    let frame = 0;
    const cancelFrame = (): void => {
      if (frame !== 0) {
        window.cancelAnimationFrame(frame);
        frame = 0;
      }
    };
    const step = (): void => {
      frame = 0;
      if (!follow.following) {
        return;
      }
      const target = Math.max(
        0,
        element.scrollHeight - element.clientHeight,
      );
      const distance = target - element.scrollTop;
      if (distance <= FOLLOW_SETTLED_PX) {
        return;
      }
      const next = reducedMotion?.matches === true
        ? target
        : Math.min(
            target,
            element.scrollTop +
              Math.max(1, distance * FOLLOW_EASE),
          );
      follow.pendingProgrammaticTop = next;
      element.scrollTop = next;
      if (next < target - FOLLOW_SETTLED_PX) {
        frame = window.requestAnimationFrame(step);
      }
    };
    const schedule = (): void => {
      if (follow.following && frame === 0) {
        frame = window.requestAnimationFrame(step);
      }
    };
    followNewestRef.current = (force = false) => {
      if (force) {
        follow.following = true;
      }
      schedule();
    };
    const onScroll = (): void => {
      const wasFollowing = follow.following;
      applyFollowScroll(follow, {
        scrollTop: element.scrollTop,
        scrollHeight: element.scrollHeight,
        clientHeight: element.clientHeight,
      });
      if (!wasFollowing && follow.following) {
        schedule();
      }
    };
    const onWheel = (event: WheelEvent): void => {
      const released = applyFollowWheelIntent(follow, event.deltaY, {
        scrollTop: element.scrollTop,
        scrollHeight: element.scrollHeight,
        clientHeight: element.clientHeight,
      });
      if (released) {
        cancelFrame();
      }
    };
    element.addEventListener('scroll', onScroll, { passive: true });
    element.addEventListener('wheel', onWheel, { passive: true });
    schedule();
    return () => {
      followNewestRef.current = () => undefined;
      element.removeEventListener('scroll', onScroll);
      element.removeEventListener('wheel', onWheel);
      cancelFrame();
    };
  }, []);

  useEffect(() => {
    const entryCount = btw.entries.length;
    const newQuestion = entryCount > previousEntryCountRef.current;
    previousEntryCountRef.current = entryCount;
    followNewestRef.current(newQuestion);
  }, [btw]);

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
        {btw.pendingQuestion !== null ? (
          <div className="dvx-btw-pending" role="status">
            <span className="dvx-btw-pending-label">Next</span>
            <span>{btw.pendingQuestion}</span>
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
