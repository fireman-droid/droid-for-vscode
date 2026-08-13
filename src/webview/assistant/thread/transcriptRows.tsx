// transcriptRows: moved verbatim from Thread.tsx (structure-only refactor).

import { MessagePartPrimitive } from "@assistant-ui/react";
import { useContext, useState } from "react";

import type { SessionHistoryStatus } from "../../../shared/bridgeMessages";
import { isPreviewableFilePath } from "../../../shared/validateMessage";
import { ChangesCommitEntry } from "../GitCommitPanel";
import {
  FileDiffContext,
  PreviewContext,
  SelectSessionContext,
} from "../Thread";
import { ActivityChevron } from "./icons";
import { formatThinkingLabel, readDiagnostic } from "./readers";

export const THINKING_SMOOTH_OPTIONS = {
  drainMs: 480,
  maxCharIntervalMs: 12,
  maxCharsPerFrame: 12,
  minCommitMs: 48,
} as const;

export function ToolFilePath({ path }: { readonly path: string }): React.JSX.Element {
  const openFileDiff = useContext(FileDiffContext);
  const fileName = path.split("/").at(-1) ?? path;
  return (
    <button
      type="button"
      className="dvx-tool-file"
      title={`Open changes for ${path}`}
      onClick={(event) => {
        // Keep the surrounding <details> row from toggling.
        event.preventDefault();
        event.stopPropagation();
        openFileDiff(path);
      }}
    >
      {fileName}
    </button>
  );
}

// Quiet sibling chip that opens the sandboxed preview panel. Only shown
// for self-contained .html/.htm prototypes, so the UI never offers a
// preview the host cannot render.
export function PreviewChip({ path }: { readonly path: string }): React.JSX.Element {
  const openPreview = useContext(PreviewContext);
  return (
    <button
      type="button"
      className="dvx-preview-chip"
      title={`Preview ${path} in a sandboxed panel`}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        openPreview(path);
      }}
    >
      Preview
    </button>
  );
}

export function ThinkingRow({
  statusType,
  durationMs,
}: {
  readonly statusType: string | undefined;
  readonly durationMs: number | null;
}): React.JSX.Element {
  // Expansion is per row: a shared toggle used to open every Thinking
  // row in the session at once, which stalled long transcripts for
  // seconds on a single click.
  const [expanded, setExpanded] = useState(false);
  return (
    <details
      className="dvx-activity-row dvx-thinking-row"
      open={expanded}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary>
        <span className="dvx-activity-indicator" />
        {statusType === "running" ? (
          <span className="dvx-shimmer-text">Thinking</span>
        ) : (
          formatThinkingLabel(statusType, durationMs)
        )}
        <ActivityChevron />
      </summary>
      <MessagePartPrimitive.Text
        className="dvx-thinking-content"
        component="pre"
        smooth={THINKING_SMOOTH_OPTIONS}
      />
    </details>
  );
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

/**
 * Trailing row action opening an .html/.htm prototype in the
 * sandboxed preview panel. Rests invisible; the row's hover or
 * focus-within fades it in (space is reserved, so nothing reflows).
 */
function ChangesPreviewAction({
  path,
}: {
  readonly path: string;
}): React.JSX.Element {
  const openPreview = useContext(PreviewContext);
  return (
    <button
      type="button"
      className="dvx-changes-action dvx-changes-row-action"
      title={`Preview ${path} in a sandboxed panel`}
      onClick={() => openPreview(path)}
    >
      Preview
    </button>
  );
}

/**
 * Live changes ledger (decard design §4 option A). The area appears
 * with the first written file and grows row by row; repeated writes
 * to one file refresh its counts in place (row keys are the file
 * paths, so React reuses the DOM node and never replays the entry
 * fade). While the host streams `writing` frames the header shows
 * an accent dot with a live count; the settled reconciliation (or a
 * terminal turn state) flips it in place without resizing the area.
 */
export function ChangesSummary({
  data,
}: {
  readonly data: unknown;
}): React.JSX.Element | null {
  const openFileDiff = useContext(FileDiffContext);
  const files = readChangedFiles(data);
  const turnId = readChangesTurnId(data);
  const writing = readChangesWriting(data);
  if (files.length === 0) {
    return null;
  }
  const count = `${files.length} ${files.length === 1 ? "file" : "files"}`;
  return (
    <section className="dvx-changes" role="group" aria-label="Changed files">
      <header className="dvx-changes-head">
        <span className="dvx-changes-title">Changes</span>
        <span className="dvx-changes-status" role="status">
          {writing ? (
            <>
              <span className="dvx-changes-dot" aria-hidden="true" />
              writing · {count}
            </>
          ) : (
            <>{count} · settled</>
          )}
        </span>
      </header>
      <ul className="dvx-changes-files">
        {files.map((file) => (
          <li key={file.path} className="dvx-changes-row">
            <button
              type="button"
              className="dvx-changes-file"
              title={`Open changes for ${file.path}`}
              onClick={() => openFileDiff(file.path)}
            >
              {file.path.split("/").at(-1) ?? file.path}
            </button>
            <span className="dvx-changes-stats">
              {file.additions !== null ? (
                <span className="dvx-changes-add">+{file.additions}</span>
              ) : null}
              {file.deletions !== null ? (
                <span className="dvx-changes-del">−{file.deletions}</span>
              ) : null}
            </span>
            {isPreviewableFilePath(file.path) ? (
              <ChangesPreviewAction path={file.path} />
            ) : null}
          </li>
        ))}
      </ul>
      <footer className="dvx-changes-foot">
        <button
          type="button"
          className="dvx-changes-action"
          title="Open the diff of every changed file"
          onClick={() => {
            for (const file of files) {
              openFileDiff(file.path);
            }
          }}
        >
          Review
        </button>
        <ChangesCommitEntry turnId={turnId} />
      </footer>
    </section>
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
