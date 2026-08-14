import { useEffect, useRef, useState } from 'react';

import type {
  QueuedMessageSummary,
  QueuePausedReason,
  SessionQueueState,
} from '../../shared/queueProtocol';
import { MAX_QUEUED_MESSAGES } from '../../shared/queueProtocol';
import './queuedMessages.css';

/**
 * Prompts queued behind the running turn, folded into a Cursor-style
 * bar above the Composer (queued-messages-design.md §4.7, redesigned
 * per user decision 2026-08-12 晚). Collapsed it is one quiet line —
 * "N Queued · ⏎ to Send" — that expands to a compact list where each
 * row offers edit / send-now / remove. Send-now safely stops a running
 * turn before the Host dispatches the chosen prompt. Editing hands the
 * prompt back to the Composer ("Edit Queued" mode); the row stays in
 * place with an "Editing" tag until the edit is sent or cancelled.
 *
 * It shares the warm layered card language (and the grid-rows
 * expand/collapse) with the task plan pin so the two stack above the
 * Composer as one family of conversation-state bars.
 */
export interface QueuedMessagesProps {
  readonly queue: SessionQueueState;
  /** Queue id currently loaded into the Composer, if any. */
  readonly editingId: string | null;
  readonly onEditBegin: (queueId: string) => void;
  readonly onPromote: (queueId: string) => void;
  readonly onRemove: (queueId: string) => void;
  readonly onResume: () => void;
  readonly onClear: () => void;
}

const PAUSED_COPY: Record<QueuePausedReason, string> = {
  stopped: 'paused after stop',
  'turn-failed': 'paused after a failed turn',
  'dispatch-blocked': 'sending is blocked right now',
};

const ATTACHMENT_MARKERS: Record<
  QueuedMessageSummary['attachments'][number]['kind'],
  string
> = {
  image: '[image]',
  pdf: '[pdf]',
  text: '[file]',
  editor: '[editor]',
  selection: '[selection]',
};

export function QueuedMessages({
  queue,
  editingId,
  onEditBegin,
  onPromote,
  onRemove,
  onResume,
  onClear,
}: QueuedMessagesProps): React.JSX.Element | null {
  const [expanded, setExpanded] = useState(false);
  const containerRef = useRef<HTMLElement | null>(null);

  // A fresh pause opens the bar once so the resume/clear actions are
  // in view; the user can still collapse it afterwards.
  const pausedRef = useRef<QueuePausedReason | null>(queue.paused);
  useEffect(() => {
    if (queue.paused !== null && pausedRef.current === null) {
      setExpanded(true);
    }
    pausedRef.current = queue.paused;
  }, [queue.paused]);

  // Same dismissal language as the task plan pin: outside pointer
  // press or Escape collapses the expanded bar.
  useEffect(() => {
    if (!expanded) {
      return undefined;
    }
    const onPointerDown = (event: PointerEvent): void => {
      const container = containerRef.current;
      if (
        container !== null &&
        event.target instanceof Node &&
        !container.contains(event.target)
      ) {
        setExpanded(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setExpanded(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [expanded]);

  if (queue.items.length === 0) {
    return null;
  }
  const count = queue.items.length;
  const full = count >= MAX_QUEUED_MESSAGES;
  const meta =
    queue.paused !== null
      ? PAUSED_COPY[queue.paused]
      : full
        ? 'queue full'
        : '⏎ to Send';
  const announcement = `${count} message${count === 1 ? '' : 's'} queued — ${meta}`;
  return (
    <section
      ref={containerRef}
      className="dvx-queue"
      aria-label="Queued messages"
    >
      <div aria-live="polite" className="dvx-visually-hidden">
        {announcement}
      </div>
      <button
        type="button"
        className="dvx-queue-toggle"
        aria-expanded={expanded}
        aria-label={`${count} queued message${count === 1 ? '' : 's'}, ${meta}`}
        onClick={() => setExpanded((value) => !value)}
      >
        <span className="dvx-queue-count">{count} Queued</span>
        <span
          className={`dvx-queue-meta${
            queue.paused !== null || full ? ' dvx-queue-meta-warn' : ''
          }`}
        >
          {meta}
        </span>
        <QueueChevron />
      </button>
      {/* Stays mounted so expand and collapse both animate through
          grid-rows; aria-hidden + tab isolation keep the closed list
          out of the accessibility tree. */}
      <div
        className="dvx-queue-body"
        data-open={expanded ? 'true' : 'false'}
        aria-hidden={!expanded}
      >
        <div className="dvx-queue-body-inner">
          <ul className="dvx-queue-list">
            {queue.items.map((item) => (
              <QueuedRow
                key={item.queueId}
                item={item}
                editing={editingId === item.queueId}
                tabbable={expanded}
                onEditBegin={() => onEditBegin(item.queueId)}
                onPromote={() => onPromote(item.queueId)}
                onRemove={() => onRemove(item.queueId)}
              />
            ))}
          </ul>
          {queue.paused !== null ? (
            <div className="dvx-queue-foot">
              <span className="dvx-queue-note">
                Automatic sending is paused
              </span>
              <button
                type="button"
                className="dvx-queue-action"
                tabIndex={expanded ? 0 : -1}
                onClick={onResume}
              >
                Send now
              </button>
              <button
                type="button"
                className="dvx-queue-action"
                tabIndex={expanded ? 0 : -1}
                onClick={onClear}
              >
                Clear
              </button>
            </div>
          ) : (
            <div className="dvx-queue-foot">
              <span className="dvx-queue-note">
                Sends after the current turn · text restores after
                reload
              </span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function QueuedRow({
  item,
  editing,
  tabbable,
  onEditBegin,
  onPromote,
  onRemove,
}: {
  readonly item: QueuedMessageSummary;
  readonly editing: boolean;
  readonly tabbable: boolean;
  readonly onEditBegin: () => void;
  readonly onPromote: () => void;
  readonly onRemove: () => void;
}): React.JSX.Element {
  const tabIndex = tabbable ? 0 : -1;
  return (
    <li
      className={`dvx-queue-row${editing ? ' dvx-queue-row-editing' : ''}`}
    >
      <span className="dvx-queue-row-text" title={item.text}>
        {item.attachments.map((attachment, index) => (
          <span
            key={`${attachment.name}-${index}`}
            className="dvx-queue-row-attachment"
            title={attachment.name}
          >
            {ATTACHMENT_MARKERS[attachment.kind]}
          </span>
        ))}
        {item.text}
      </span>
      {editing ? (
        <span className="dvx-queue-row-state">Editing</span>
      ) : (
        <span className="dvx-queue-row-actions">
          <button
            type="button"
            className="dvx-queue-row-action"
            aria-label="Edit queued message"
            title="Edit in the composer"
            tabIndex={tabIndex}
            onClick={onEditBegin}
          >
            <PencilIcon />
          </button>
          <button
            type="button"
            className="dvx-queue-row-action"
            aria-label="Send queued message now"
            title="Send this message now"
            tabIndex={tabIndex}
            onClick={onPromote}
          >
            <SendNowIcon />
          </button>
          <button
            type="button"
            className="dvx-queue-row-action dvx-queue-row-action-danger"
            aria-label="Remove queued message"
            title="Remove from the queue"
            tabIndex={tabIndex}
            onClick={onRemove}
          >
            <TrashIcon />
          </button>
        </span>
      )}
    </li>
  );
}

function QueueChevron(): React.JSX.Element {
  return (
    <svg
      className="dvx-queue-chevron"
      viewBox="0 0 14 14"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="m4.25 5.75 2.75 2.75 2.75-2.75"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PencilIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path
        d="M9.6 2.4a1.1 1.1 0 0 1 1.6 0l.4.4a1.1 1.1 0 0 1 0 1.6L5.4 10.6l-2.5.5.5-2.5L9.6 2.4Z"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SendNowIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path
        d="M7 11V3.4M3.6 6.6 7 3.2l3.4 3.4"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TrashIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path
        d="M2.8 4h8.4M5.6 4V2.9a.7.7 0 0 1 .7-.7h1.4a.7.7 0 0 1 .7.7V4m2.1 0-.5 6.5a1 1 0 0 1-1 .9H5a1 1 0 0 1-1-.9L3.5 4"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
