import { useEffect, useRef, useState } from 'react';

import type { SessionTranscriptItem } from '../../shared/bridgeMessages';
import { DroidMarkdownContent } from './MarkdownText';
import type { SubagentSheetState } from './subagentPanelFlow';

/** Matches the btw collapse duration (styles 21-btw.css). */
const LEAVE_MS = 200;

/**
 * Read-only transcript of one delegation, in the same full-height
 * split-pane column as the `/btw` sheet (subagent playback design
 * §6.1: no Composer, no writable entry points — read-only by
 * construction). Closes on ×, Escape, or session changes.
 */
export function SubagentTranscriptSheet({
  sheet,
  onDismiss,
}: {
  readonly sheet: SubagentSheetState;
  readonly onDismiss: () => void;
}): React.JSX.Element {
  const [leaving, setLeaving] = useState(false);
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    if (!leaving) {
      return undefined;
    }
    const timer = window.setTimeout(() => {
      dismissRef.current();
    }, LEAVE_MS);
    return () => window.clearTimeout(timer);
  }, [leaving]);

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

  return (
    <aside
      className={`dvx-btw-panel dvx-subsheet${
        leaving ? ' dvx-btw-leaving' : ''
      }`}
      aria-label="Subagent transcript"
    >
      <header className="dvx-btw-header">
        <h2 className="dvx-btw-title">{sheet.title}</h2>
        <button
          type="button"
          className="dvx-btw-close"
          aria-label="Close subagent transcript"
          onClick={() => setLeaving(true)}
        >
          ×
        </button>
      </header>
      <p className="dvx-btw-hint">
        Read-only transcript of this delegation.
      </p>
      <div className="dvx-btw-entries dvx-subsheet-body">
        {sheet.status === 'loading' ? (
          <p className="dvx-btw-status">Loading transcript…</p>
        ) : sheet.status === 'unavailable' ? (
          <p className="dvx-btw-status">Transcript unavailable.</p>
        ) : (
          <>
            {sheet.items.map((item) => (
              <SubagentTranscriptRow key={item.id} item={item} />
            ))}
            {sheet.truncated ? (
              <p className="dvx-btw-status">
                Earlier messages were truncated.
              </p>
            ) : null}
          </>
        )}
      </div>
    </aside>
  );
}

/**
 * One transcript item, rendered quiet and inert: user text as the
 * question label, assistant markdown through the shared renderer,
 * everything else as small single-line summaries.
 */
export function SubagentTranscriptRow({
  item,
}: {
  readonly item: SessionTranscriptItem;
}): React.JSX.Element | null {
  switch (item.kind) {
    case 'user':
      return <p className="dvx-btw-question">{item.text}</p>;
    case 'assistant':
      return (
        <div className="dvx-btw-answer">
          <DroidMarkdownContent text={item.text} />
        </div>
      );
    case 'thinking':
      return (
        <p className="dvx-subsheet-line">
          {item.durationMs !== undefined && item.durationMs !== null
            ? `Thought for ${formatSeconds(item.durationMs)}`
            : 'Thought'}
        </p>
      );
    case 'tool':
      return (
        <p
          className={`dvx-subsheet-line${
            item.status === 'failed' ? ' dvx-subsheet-line-failed' : ''
          }`}
        >
          {item.action}
          {item.filePath !== undefined ? ` · ${item.filePath}` : ''}
          {item.status === 'failed' ? ' · failed' : ''}
        </p>
      );
    case 'changes':
      return (
        <p className="dvx-subsheet-line">
          {`Changes · ${item.files.length} ${
            item.files.length === 1 ? 'file' : 'files'
          }`}
        </p>
      );
    case 'diagnostic':
      return <p className="dvx-subsheet-line">{item.message}</p>;
    case 'image':
      return <p className="dvx-subsheet-line">(image)</p>;
    default:
      return null;
  }
}

function formatSeconds(durationMs: number): string {
  const seconds = Math.max(1, Math.round(durationMs / 1_000));
  return `${seconds}s`;
}
