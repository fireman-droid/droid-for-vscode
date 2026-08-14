import {
  AssistantRuntimeProvider,
  ThreadPrimitive,
  useExternalStoreRuntime,
  type ExternalStoreAdapter,
} from '@assistant-ui/react';
import { useEffect, useMemo, useRef, useState } from 'react';

import type { SessionTranscriptItem } from '../../shared/bridgeMessages';
import {
  convertSafeRuntimeMessage,
  mapTranscriptToRuntimeMessages,
  type CompletionClock,
  type RuntimeMessageCache,
  type SafeRuntimeMessage,
} from './runtimeAdapter';
import {
  SubagentActionsContext,
  type SubagentSheetState,
} from './subagentPanelFlow';
import {
  SelectSessionContext,
  TerminalMirrorContext,
} from './Thread';
import { ReadOnlyAssistantMessage } from './thread/AssistantMessage';
import { ReadOnlyUserMessage } from './thread/UserMessage';
import { useSmoothFollowScroll } from './useSmoothFollowScroll';

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
  const panelRef = useRef<HTMLElement>(null);
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  const refreshRef = useRef(onRefresh);
  refreshRef.current = onRefresh;
  const toolUseId = sheet.toolUseId;
  const {
    viewportRef: bodyRef,
    contentRef,
    followNewest,
  } = useSmoothFollowScroll<HTMLDivElement>();

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

  // Poll swaps in a complete transcript snapshot. Schedule the shared
  // smooth follower after each swap; a deliberate reading gesture keeps
  // the latch released. Navigating to another delegation starts at its tail.
  const previousToolUseIdRef = useRef(toolUseId);
  useEffect(() => {
    const rowChanged = previousToolUseIdRef.current !== toolUseId;
    previousToolUseIdRef.current = toolUseId;
    followNewest(rowChanged);
  }, [followNewest, running, sheet.items, toolUseId]);

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
    const beginDismiss = (): void => {
      setLeaving(true);
    };
    const onPointerDown = (event: PointerEvent): void => {
      if (
        event.target instanceof Element &&
        event.target.closest('.dvx-image-lightbox') !== null
      ) {
        return;
      }
      if (
        event.target instanceof Node &&
        panelRef.current?.contains(event.target) !== true
      ) {
        beginDismiss();
      }
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        beginDismiss();
      }
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  return (
    <aside
      ref={panelRef}
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
      >
        <div className="dvx-subsheet-content" ref={contentRef}>
          {sheet.status === 'loading' ? (
            <p className="dvx-btw-status">Loading transcript…</p>
          ) : sheet.status === 'unavailable' ? (
            <p className="dvx-btw-status">Transcript unavailable.</p>
          ) : (
            <ReadOnlySubagentTranscript items={sheet.items} />
          )}
          {sheet.status === 'available' && sheet.truncated ? (
            <p className="dvx-btw-status">
              Earlier messages were truncated.
            </p>
          ) : null}
        </div>
      </div>
    </aside>
  );
}

function ReadOnlySubagentTranscript({
  items,
}: {
  readonly items: readonly SessionTranscriptItem[];
}): React.JSX.Element {
  const messageCacheRef = useRef<RuntimeMessageCache>(new Map());
  const completionClockRef = useRef<CompletionClock>(new Map());
  const messages = useMemo(
    () =>
      mapTranscriptToRuntimeMessages(
        items,
        null,
        messageCacheRef.current,
        completionClockRef.current,
      ),
    [items],
  );
  const adapter = useMemo<ExternalStoreAdapter<SafeRuntimeMessage>>(
    () => ({
      messages,
      isRunning: false,
      isSendDisabled: true,
      convertMessage: convertSafeRuntimeMessage,
      onNew: async () => undefined,
    }),
    [messages],
  );
  const runtime = useExternalStoreRuntime(adapter);
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <TerminalMirrorContext.Provider value={null}>
        <SelectSessionContext.Provider value={null}>
          <SubagentActionsContext.Provider value={null}>
            <div className="dvx-subsheet-thread">
              <ThreadPrimitive.Messages>
                {({ message }) =>
                  message.role === 'user' ? (
                    <ReadOnlyUserMessage />
                  ) : (
                    <ReadOnlyAssistantMessage />
                  )
                }
              </ThreadPrimitive.Messages>
            </div>
          </SubagentActionsContext.Provider>
        </SelectSessionContext.Provider>
      </TerminalMirrorContext.Provider>
    </AssistantRuntimeProvider>
  );
}
