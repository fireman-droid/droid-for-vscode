import { useEffect, useRef, useState } from 'react';

import { MAX_TURN_TEXT_LENGTH } from '../../shared/bridgeMessages';
import type {
  QueuedMessageSummary,
  QueuePausedReason,
  SessionQueueState,
} from '../../shared/queueProtocol';
import './queuedMessages.css';

/**
 * Queued prompts waiting behind the running turn, rendered at the
 * tail of the transcript above the Composer
 * (queued-messages-design.md §4.7). Cards are quiet echoes of the
 * user bubble; the host's `queue.state` echo corrects any optimistic
 * drift, so a card for an already-dispatched prompt simply vanishes.
 */
export interface QueuedMessagesProps {
  readonly queue: SessionQueueState;
  readonly onUpdate: (queueId: string, text: string) => void;
  readonly onRemove: (queueId: string) => void;
  readonly onResume: () => void;
  readonly onClear: () => void;
}

const PAUSED_COPY: Record<QueuePausedReason, string> = {
  stopped: 'paused after stop',
  'turn-failed': 'paused after a failed turn',
  'dispatch-blocked': 'sending is blocked right now',
};

const ATTACHMENT_KIND_LABELS: Record<
  QueuedMessageSummary['attachments'][number]['kind'],
  string
> = {
  image: 'Image',
  pdf: 'PDF',
  text: 'File',
  editor: 'Editor',
  selection: 'Selection',
};

export function QueuedMessages({
  queue,
  onUpdate,
  onRemove,
  onResume,
  onClear,
}: QueuedMessagesProps): React.JSX.Element | null {
  const [editingId, setEditingId] = useState<string | null>(null);
  // Close the editor when its prompt leaves the queue (dispatched,
  // removed elsewhere, or corrected by the authoritative echo).
  useEffect(() => {
    if (
      editingId !== null &&
      !queue.items.some((item) => item.queueId === editingId)
    ) {
      setEditingId(null);
    }
  }, [editingId, queue.items]);

  if (queue.items.length === 0) {
    return null;
  }
  const count = queue.items.length;
  const announcement =
    queue.paused === null
      ? `${count} message${count === 1 ? '' : 's'} queued`
      : `${count} queued — ${PAUSED_COPY[queue.paused]}`;
  return (
    <section className="dvx-queue" aria-label="Queued messages">
      <div aria-live="polite" className="dvx-visually-hidden">
        {announcement}
      </div>
      {queue.paused === null ? null : (
        <div className="dvx-queue-paused">
          <span className="dvx-queue-paused-text">
            {count} queued — {PAUSED_COPY[queue.paused]}
          </span>
          <button
            type="button"
            className="dvx-queue-action"
            onClick={onResume}
          >
            Send now
          </button>
          <button
            type="button"
            className="dvx-queue-action"
            onClick={onClear}
          >
            Clear
          </button>
        </div>
      )}
      <ul className="dvx-queue-list">
        {queue.items.map((item) => (
          <QueuedCard
            key={item.queueId}
            item={item}
            editing={editingId === item.queueId}
            onBeginEdit={() => setEditingId(item.queueId)}
            onCancelEdit={() => setEditingId(null)}
            onSaveEdit={(text) => {
              setEditingId(null);
              if (text !== item.text) {
                onUpdate(item.queueId, text);
              }
            }}
            onRemove={() => onRemove(item.queueId)}
          />
        ))}
      </ul>
      <p className="dvx-queue-note">
        Sends when the current turn finishes · kept in this window only
      </p>
    </section>
  );
}

function QueuedCard({
  item,
  editing,
  onBeginEdit,
  onCancelEdit,
  onSaveEdit,
  onRemove,
}: {
  readonly item: QueuedMessageSummary;
  readonly editing: boolean;
  readonly onBeginEdit: () => void;
  readonly onCancelEdit: () => void;
  readonly onSaveEdit: (text: string) => void;
  readonly onRemove: () => void;
}): React.JSX.Element {
  const [draft, setDraft] = useState(item.text);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  // Re-seed the draft each time the editor opens (or the queued text
  // is corrected underneath a closed editor).
  useEffect(() => {
    if (editing) {
      setDraft(item.text);
      inputRef.current?.focus();
    }
  }, [editing, item.text]);

  const saveDisabled =
    draft.trim().length === 0 || draft.length > MAX_TURN_TEXT_LENGTH;
  return (
    <li className="dvx-queue-item">
      <div className="dvx-queue-item-head">
        <span className="dvx-queue-badge">Queued</span>
        <button
          type="button"
          className="dvx-queue-remove"
          aria-label="Remove queued message"
          title="Remove queued message"
          onClick={onRemove}
        >
          ×
        </button>
      </div>
      {editing ? (
        <div className="dvx-queue-edit">
          <textarea
            ref={inputRef}
            className="dvx-queue-edit-input"
            aria-label="Edit queued message"
            rows={3}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                if (!saveDisabled) {
                  onSaveEdit(draft);
                }
              } else if (event.key === 'Escape') {
                event.preventDefault();
                onCancelEdit();
              }
            }}
          />
          <div className="dvx-queue-edit-actions">
            <button
              type="button"
              className="dvx-queue-action"
              onClick={onCancelEdit}
            >
              Cancel
            </button>
            <button
              type="button"
              className="dvx-queue-action dvx-queue-action-save"
              disabled={saveDisabled}
              onClick={() => onSaveEdit(draft)}
            >
              Save
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="dvx-queue-text"
          title="Edit queued message"
          onClick={onBeginEdit}
        >
          {item.text}
        </button>
      )}
      {item.attachments.length > 0 ? (
        <div
          className="dvx-queue-attachments"
          aria-label="Attachments queued with this message"
        >
          {item.attachments.map((attachment, index) => (
            <span
              key={`${attachment.name}-${index}`}
              className="dvx-attachment-chip dvx-attachment-sent"
            >
              <span className="dvx-attachment-kind">
                {ATTACHMENT_KIND_LABELS[attachment.kind]}
              </span>
              <span
                className="dvx-attachment-name"
                title={attachment.name}
              >
                {attachment.name}
              </span>
            </span>
          ))}
        </div>
      ) : null}
    </li>
  );
}
