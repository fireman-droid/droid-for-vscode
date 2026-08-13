import { useEffect, useRef, useState } from 'react';

import type { SessionTranscriptItem } from '../../shared/bridgeMessages';
import { DroidMarkdownContent } from './MarkdownText';
import type { SubagentSheetState } from './subagentPanelFlow';
import { formatDuration, formatToolLifecycle } from './thread/readers';

/** Matches the btw collapse duration (styles 21-btw.css). */
const LEAVE_MS = 200;

/**
 * Live re-request cadence while the sheet's delegation row still
 * runs. The host single-flights transcript loads per row, so a tick
 * landing while one is in flight is simply dropped there.
 */
export const SUBAGENT_SHEET_REFRESH_MS = 3_000;

/**
 * Read-only transcript of one delegation, in the same full-height
 * split-pane column as the `/btw` sheet (subagent playback design
 * §6.1: no Composer, no writable entry points — read-only by
 * construction). Closes on ×, Escape, or session changes. While the
 * delegation still runs, the sheet re-requests the transcript on an
 * interval — a live view, not just post-run playback.
 */
export function SubagentTranscriptSheet({
  sheet,
  running,
  onRefresh,
  onDismiss,
}: {
  readonly sheet: SubagentSheetState;
  /** The delegation row behind this sheet is still working. */
  readonly running: boolean;
  /** Re-requests the transcript (posts `subagent.openTranscript`). */
  readonly onRefresh: (toolUseId: string) => void;
  readonly onDismiss: () => void;
}): React.JSX.Element {
  const [leaving, setLeaving] = useState(false);
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  const refreshRef = useRef(onRefresh);
  refreshRef.current = onRefresh;
  const toolUseId = sheet.toolUseId;

  useEffect(() => {
    if (!running) {
      return undefined;
    }
    const timer = window.setInterval(() => {
      refreshRef.current(toolUseId);
    }, SUBAGENT_SHEET_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [running, toolUseId]);

  // When the row settles, one final refresh picks up the transcript
  // tail written between the last tick and the settle.
  const wasRunningRef = useRef(running);
  const lastRowRef = useRef(toolUseId);
  useEffect(() => {
    const rowChanged = lastRowRef.current !== toolUseId;
    lastRowRef.current = toolUseId;
    if (!rowChanged && wasRunningRef.current && !running) {
      refreshRef.current(toolUseId);
    }
    wasRunningRef.current = running;
  }, [running, toolUseId]);

  // Follow the tail like a terminal: stick to the bottom only while
  // the reader is already there; scrolling up unpins until they
  // return (same pattern as ToolOutputPreview).
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const pinnedRef = useRef(true);
  useEffect(() => {
    const body = bodyRef.current;
    if (running && pinnedRef.current && body !== null) {
      body.scrollTop = body.scrollHeight;
    }
  }, [sheet.items, running]);

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
        {running ? (
          <span className="dvx-subsheet-live" role="status">
            <span className="dvx-shimmer-text">Running…</span>
          </span>
        ) : null}
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
      <div
        className="dvx-btw-entries dvx-subsheet-body"
        ref={bodyRef}
        onScroll={(event) => {
          const body = event.currentTarget;
          pinnedRef.current =
            body.scrollHeight - body.scrollTop - body.clientHeight < 8;
        }}
      >
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
 * One transcript item, rendered read-only in the main chat's visual
 * language: the task prompt in the user bubble through the shared
 * markdown renderer, assistant text as transcript markdown, thinking
 * as the quiet grey line, and tool use as the ruled marker-dot
 * ledger — visual parity with the live rows, none of their actions.
 */
export function SubagentTranscriptRow({
  item,
}: {
  readonly item: SessionTranscriptItem;
}): React.JSX.Element | null {
  switch (item.kind) {
    case 'user':
      return (
        <div className="dvx-user-block dvx-subsheet-user">
          <DroidMarkdownContent
            text={item.text}
            className="dvx-markdown dvx-subsheet-user-md"
          />
        </div>
      );
    case 'assistant':
      return (
        <DroidMarkdownContent
          text={item.text}
          className="dvx-markdown dvx-btw-answer dvx-subsheet-answer"
        />
      );
    case 'thinking':
      return (
        <p className="dvx-subsheet-thought">
          {item.durationMs !== undefined && item.durationMs !== null
            ? `Thought for ${formatSeconds(item.durationMs)}`
            : 'Thought'}
        </p>
      );
    case 'tool': {
      const failed = item.status === 'failed';
      return (
        <div
          className={`dvx-subsheet-tool${
            failed ? ' dvx-subsheet-tool-failed' : ''
          }`}
        >
          <span className="dvx-subsheet-tool-action">{item.action}</span>
          {item.filePath !== undefined ? (
            <code className="dvx-subsheet-tool-file" title={item.filePath}>
              {item.filePath}
            </code>
          ) : null}
          <span
            className={`dvx-subsheet-tool-state${
              failed ? ' dvx-subsheet-tool-state-failed' : ''
            }`}
          >
            {formatToolLifecycle(item.status)}
            {item.durationMs !== undefined
              ? ` · ${formatDuration(item.durationMs)}`
              : ''}
          </span>
        </div>
      );
    }
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
