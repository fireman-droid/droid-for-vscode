// transcriptRows: moved verbatim from Thread.tsx (structure-only refactor).

import { useAuiState, useSmooth } from "@assistant-ui/react";
import {
  useContext,
  useDeferredValue,
  useEffect,
  useMemo,
  startTransition,
  useState,
  useSyncExternalStore,
} from "react";

import type { SessionHistoryStatus } from "../../../shared/bridgeMessages";
import { OpenPathContext } from "../MarkdownText";
import {
  FileDiffContext,
  PreviewContext,
  ReviewTurnContext,
  SelectSessionContext,
  ToolChangesContext,
} from "../Thread";
import { ActivityChevron } from "./icons";
import { formatThinkingLabel, readDiagnostic } from "./readers";

export const THINKING_WAITING_AFTER_MS = 10_000;
export const THINKING_RENDER_CHUNK_SIZE = 16_384;
const THINKING_RENDER_CHUNKS_PER_FRAME = 4;
export const LIVE_THINKING_SMOOTH_OPTIONS = {
  drainMs: 320,
  maxCharIntervalMs: 20,
  maxCharsPerFrame: 4_096,
  minCommitMs: 32,
} as const;
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const EMPTY_REASONING_PART = {
  type: "reasoning" as const,
  text: "",
  status: { type: "complete" as const },
};

export function ToolFilePath({
  path,
  turnId,
}: {
  readonly path: string;
  readonly turnId: string | null;
}): React.JSX.Element {
  const openPath = useContext(OpenPathContext);
  const toolChanges = useContext(ToolChangesContext);
  const changedFile =
    toolChanges.turnId === turnId
      ? toolChanges.filesByPath.get(path)
      : undefined;
  const additions = changedFile?.additions;
  const deletions = changedFile?.deletions;
  const hasAdditions = additions !== null && additions !== undefined;
  const hasDeletions = deletions !== null && deletions !== undefined;
  const fileName = path.split("/").at(-1) ?? path;
  return (
    <>
      <button
        type="button"
        className="dvx-tool-file"
        title={`Open ${path}`}
        onClick={(event) => {
          // Keep the surrounding <details> row from toggling.
          event.preventDefault();
          event.stopPropagation();
          openPath?.({ path });
        }}
      >
        {fileName}
      </button>
      {hasAdditions || hasDeletions ? (
        <span
          className="dvx-tool-file-stats"
          aria-label={[
            ...(hasAdditions ? [`${additions} lines added`] : []),
            ...(hasDeletions ? [`${deletions} lines removed`] : []),
          ].join(", ")}
        >
          {hasAdditions ? (
            <span className="dvx-changes-add">+{additions}</span>
          ) : null}
          {hasDeletions ? (
            <span className="dvx-changes-del">−{deletions}</span>
          ) : null}
        </span>
      ) : null}
    </>
  );
}

// Quiet sibling chip that opens the sandboxed Canvas panel. Only shown
// for self-contained .html/.htm prototypes, so the UI never offers a
// preview the host cannot render.
export function PreviewChip({ path }: { readonly path: string }): React.JSX.Element {
  const openPreview = useContext(PreviewContext);
  return (
    <button
      type="button"
      className="dvx-preview-chip"
      title={`Open ${path} in Canvas`}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        openPreview(path);
      }}
    >
      Canvas
    </button>
  );
}

export function ThinkingRow({
  statusType,
  durationMs,
  truncated,
}: {
  readonly statusType: string | undefined;
  readonly durationMs: number | null;
  readonly truncated: boolean;
}): React.JSX.Element {
  // Expansion is per row: a shared toggle used to open every Thinking
  // row in the session at once, which stalled long transcripts for
  // seconds on a single click.
  const [expanded, setExpanded] = useState(false);
  const textLength = useAuiState((state) =>
    state.part.type === "reasoning" ? state.part.text.length : 0,
  );
  const [waiting, setWaiting] = useState(false);
  useEffect(() => {
    if (statusType !== "running" || truncated) {
      setWaiting(false);
      return undefined;
    }
    setWaiting(false);
    const timer = setTimeout(
      () => setWaiting(true),
      THINKING_WAITING_AFTER_MS,
    );
    return () => clearTimeout(timer);
  }, [statusType, textLength, truncated]);
  const liveState = truncated
    ? "Safety limit reached"
    : waiting
      ? "Waiting for model"
      : "Receiving";
  return (
    <details
      className="dvx-activity-row dvx-thinking-row"
      open={expanded}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary>
        <span className="dvx-activity-indicator" />
        {statusType === "running" ? (
          <>
            <span className="dvx-shimmer-text">Thinking</span>
            <span className="dvx-thinking-live-state">· {liveState}</span>
          </>
        ) : (
          <>
            {formatThinkingLabel(statusType, durationMs)}
            {truncated ? (
              <span className="dvx-thinking-live-state">
                · Safety limit reached
              </span>
            ) : null}
          </>
        )}
        <ActivityChevron />
      </summary>
      {expanded ? (
        <ThinkingContent
          statusType={statusType}
          truncated={truncated}
        />
      ) : null}
    </details>
  );
}

function ThinkingContent({
  statusType,
  truncated,
}: {
  readonly statusType: string | undefined;
  readonly truncated: boolean;
}): React.JSX.Element {
  // Keep the renderer selected when this row opens. A live row stays
  // smooth through settlement; closing and reopening the completed
  // row selects the bounded progressive history renderer instead.
  const [openedLive] = useState(statusType === "running");
  return (
    <div className="dvx-thinking-body">
      {openedLive ? <LiveThinkingText /> : <ProgressiveThinkingText />}
      {truncated ? (
        <p className="dvx-thinking-limit-note" role="note">
          Thinking reached the local safety limit; later reasoning is not
          retained.
        </p>
      ) : null}
    </div>
  );
}

function LiveThinkingText(): React.JSX.Element {
  const reduceMotion = useReducedMotionPreference();
  return reduceMotion ? (
    <LiveThinkingRawText />
  ) : (
    <LiveThinkingSmoothedText />
  );
}

function LiveThinkingRawText(): React.JSX.Element {
  const text = useAuiState((state) =>
    state.part.type === "reasoning" ? state.part.text : "",
  );
  return (
    <pre className="dvx-thinking-content dvx-thinking-content-live">
      {text}
    </pre>
  );
}

function LiveThinkingSmoothedText(): React.JSX.Element {
  const reasoning = useAuiState((state) =>
    state.part.type === "reasoning"
      ? state.part
      : EMPTY_REASONING_PART,
  );
  const [initialSeed] = useState(() =>
    reasoning.text.slice(0, THINKING_RENDER_CHUNK_SIZE),
  );
  const [seeded, setSeeded] = useState(false);
  useEffect(() => setSeeded(true), []);
  const seededReasoning = seeded
    ? reasoning
    : {
        ...reasoning,
        text: initialSeed,
        status: { type: "complete" as const },
      };
  const smoothed = useSmooth(
    seededReasoning,
    LIVE_THINKING_SMOOTH_OPTIONS,
  );
  return (
    <pre className="dvx-thinking-content dvx-thinking-content-live">
      {smoothed.text}
    </pre>
  );
}

function useReducedMotionPreference(): boolean {
  return useSyncExternalStore(
    subscribeReducedMotion,
    readReducedMotion,
    () => false,
  );
}

function subscribeReducedMotion(onChange: () => void): () => void {
  if (typeof window === "undefined" || window.matchMedia === undefined) {
    return () => undefined;
  }
  const media = window.matchMedia(REDUCED_MOTION_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function readReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia !== undefined &&
    window.matchMedia(REDUCED_MOTION_QUERY).matches
  );
}

function ProgressiveThinkingText(): React.JSX.Element {
  const text = useAuiState((state) =>
    state.part.type === "reasoning" ? state.part.text : "",
  );
  const visibleText = useProgressiveThinkingText(text);
  const chunks = useMemo(
    () => splitThinkingText(visibleText),
    [visibleText],
  );
  return (
    <pre className="dvx-thinking-content">
      {chunks.map((chunk, index) => (
        <span className="dvx-thinking-chunk" key={index}>
          {chunk}
        </span>
      ))}
    </pre>
  );
}

function useProgressiveThinkingText(text: string): string {
  const deferredText = useDeferredValue(text);
  const targetLength = deferredText.length;
  const [visibleLength, setVisibleLength] = useState(() =>
    Math.min(targetLength, THINKING_RENDER_CHUNK_SIZE),
  );
  useEffect(() => {
    setVisibleLength((current) => Math.min(current, targetLength));
  }, [targetLength]);
  useEffect(() => {
    if (visibleLength >= targetLength) {
      return undefined;
    }
    const frame = requestAnimationFrame(() => {
      startTransition(() => {
        setVisibleLength((current) =>
          Math.min(
            targetLength,
            current +
              THINKING_RENDER_CHUNK_SIZE *
                THINKING_RENDER_CHUNKS_PER_FRAME,
          ),
        );
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [targetLength, visibleLength]);
  let safeLength = Math.min(visibleLength, targetLength);
  if (
    safeLength > 0 &&
    safeLength < targetLength &&
    isHighSurrogate(deferredText.charCodeAt(safeLength - 1))
  ) {
    safeLength -= 1;
  }
  return deferredText.slice(0, safeLength);
}

export function splitThinkingText(text: string): readonly string[] {
  if (text.length === 0) {
    return [""];
  }
  const chunks: string[] = [];
  for (let offset = 0; offset < text.length; ) {
    let end = Math.min(
      offset + THINKING_RENDER_CHUNK_SIZE,
      text.length,
    );
    if (end < text.length) {
      const newline = text.lastIndexOf("\n", end - 1);
      const space = text.lastIndexOf(" ", end - 1);
      const naturalBreak = Math.max(newline, space);
      if (naturalBreak > offset + THINKING_RENDER_CHUNK_SIZE / 2) {
        end = naturalBreak + 1;
      } else if (isHighSurrogate(text.charCodeAt(end - 1))) {
        end -= 1;
      }
    }
    chunks.push(text.slice(offset, end));
    offset = end;
  }
  return chunks;
}

function isHighSurrogate(value: number): boolean {
  return value >= 0xd800 && value <= 0xdbff;
}

export interface ChangedFileEntry {
  readonly path: string;
  readonly additions: number | null;
  readonly deletions: number | null;
}

export function readChangedFiles(data: unknown): readonly ChangedFileEntry[] {
  if (
    typeof data !== "object" ||
    data === null ||
    !Array.isArray((data as { files?: unknown }).files)
  ) {
    return [];
  }
  const files: ChangedFileEntry[] = [];
  for (const entry of (data as { files: unknown[] }).files) {
    if (
      typeof entry !== "object" ||
      entry === null ||
      typeof (entry as { path?: unknown }).path !== "string"
    ) {
      continue;
    }
    const { path, additions, deletions } = entry as {
      path: string;
      additions?: unknown;
      deletions?: unknown;
    };
    files.push({
      path,
      additions: typeof additions === "number" ? additions : null,
      deletions: typeof deletions === "number" ? deletions : null,
    });
  }
  return files;
}

export function readChangesTurnId(data: unknown): string | null {
  if (typeof data !== "object" || data === null) {
    return null;
  }
  const turnId = (data as { turnId?: unknown }).turnId;
  return typeof turnId === "string" && turnId !== "" ? turnId : null;
}

export function readChangesWriting(data: unknown): boolean {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { writing?: unknown }).writing === true
  );
}

/** Quiet historical marker; the latest full ledger lives in ReviewDock. */
export function ChangesSummary({
  data,
}: {
  readonly data: unknown;
}): React.JSX.Element | null {
  const openReviewTurn = useContext(ReviewTurnContext);
  const files = readChangedFiles(data);
  const turnId = readChangesTurnId(data);
  if (files.length === 0) {
    return null;
  }
  const count = `${files.length} ${files.length === 1 ? "file" : "files"}`;
  const additions = files.reduce(
    (total, file) => total + (file.additions ?? 0),
    0,
  );
  const deletions = files.reduce(
    (total, file) => total + (file.deletions ?? 0),
    0,
  );
  const hasAdditions = files.some((file) => file.additions !== null);
  const hasDeletions = files.some((file) => file.deletions !== null);
  return (
    <button
      type="button"
      className="dvx-changes-history"
      title={`Review changes from this turn (${count})`}
      onClick={() => {
        if (turnId !== null) {
          openReviewTurn(turnId);
        }
      }}
    >
      <span className="dvx-changes-history-label">
        <span className="dvx-changes-title">Changes</span>
        <span aria-hidden="true">·</span>
        <span>{count}</span>
        {hasAdditions || hasDeletions ? (
          <>
            <span aria-hidden="true">·</span>
            <span className="dvx-changes-history-stats">
              {hasAdditions ? (
                <span className="dvx-changes-add">+{additions}</span>
              ) : null}
              {hasAdditions && hasDeletions ? (
                <span aria-hidden="true">/</span>
              ) : null}
              {hasDeletions ? (
                <span className="dvx-changes-del">−{deletions}</span>
              ) : null}
            </span>
          </>
        ) : null}
      </span>
    </button>
  );
}

export function Diagnostic({ data }: { readonly data: unknown }): React.JSX.Element {
  const diagnostic = readDiagnostic(data);
  if (diagnostic.code === "session-compacted") {
    return (
      <CompactDivider
        message={diagnostic.message}
        previousSessionId={diagnostic.relatedSessionId}
      />
    );
  }
  return (
    <div
      className={`dvx-diagnostic dvx-diagnostic-${diagnostic.severity}`}
      data-diagnostic-code={diagnostic.code}
      role={diagnostic.severity === "error" ? "alert" : "status"}
      title={`${diagnostic.code}: ${diagnostic.message}`}
    >
      <code aria-hidden="true">{diagnostic.code}</code>
      <span>{diagnostic.message}</span>
    </div>
  );
}

/**
 * Short centered label for the compaction divider, derived from the
 * host's `session-compacted` diagnostic message ("Conversation
 * compacted: N earlier messages summarized.").
 */
export function formatCompactDividerLabel(message: string): string {
  const match = /(\d+) earlier message/.exec(message);
  if (match === null) {
    return "Conversation summarized";
  }
  const count = Number(match[1]);
  return `Summarized ${count} earlier ${count === 1 ? "message" : "messages"}`;
}

/**
 * Compaction record rendered as a quiet transcript divider (hairline
 * + centered label), Cursor-style, instead of a notice bar. Applies
 * to live compactions and reloaded history alike.
 */
export function CompactDivider({
  message,
  previousSessionId,
}: {
  readonly message: string;
  readonly previousSessionId: string | null;
}): React.JSX.Element {
  const selectSession = useContext(SelectSessionContext);
  return (
    <div className="dvx-compact-divider" role="status" title={message}>
      <span className="dvx-compact-divider-label">
        <svg
          className="dvx-compact-divider-icon"
          viewBox="0 0 12 12"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M3 1.5 6 4l3-2.5M3 10.5 6 8l3 2.5"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M2.2 6h7.6"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
          />
        </svg>
        {formatCompactDividerLabel(message)}
        {previousSessionId !== null && selectSession !== null ? (
          <>
            {" · "}
            <button
              type="button"
              className="dvx-compact-divider-link"
              onClick={() => selectSession(previousSessionId)}
            >
              View full history
            </button>
          </>
        ) : null}
      </span>
    </div>
  );
}

export function PendingResponse({
  activity,
  activityLive = false,
}: {
  readonly activity?: "working" | "responding";
  /**
   * True while some transcript activity row (running tool, streaming
   * thinking) is already shimmering; the pending row then renders
   * statically so each turn keeps a single live indicator.
   */
  readonly activityLive?: boolean;
}): React.JSX.Element {
  return (
    <div
      className={`dvx-message dvx-message-assistant dvx-pending${
        activityLive ? " dvx-pending-quiet" : ""
      }`}
      role="status"
      aria-live="polite"
    >
      <span className="dvx-runtime-pulse" aria-hidden="true" />
      <span className={activityLive ? "dvx-pending-label" : "dvx-shimmer-text"}>
        {activity === "working" ? "Droid is working" : "Droid is responding"}
      </span>
    </div>
  );
}

export function HistoryNotice({
  historyStatus,
  truncated,
}: {
  readonly historyStatus: SessionHistoryStatus | null;
  readonly truncated: boolean;
}): React.JSX.Element | null {
  if (historyStatus === "unavailable") {
    return (
      <aside className="dvx-history-notice" role="note">
        Earlier CLI messages are unavailable here. You can continue this
        session.
      </aside>
    );
  }
  if (historyStatus === "partial" || truncated) {
    return (
      <aside className="dvx-history-notice" role="note">
        {historyStatus === "partial" && truncated
          ? "Some earlier session content is unavailable, and older locally retained messages were trimmed."
          : historyStatus === "partial"
            ? "Some earlier session content is unavailable through the public Droid history."
            : "Older messages were trimmed from the local display."}
      </aside>
    );
  }
  return null;
}
