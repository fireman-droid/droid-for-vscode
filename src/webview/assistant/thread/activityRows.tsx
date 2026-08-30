// activityRows: moved verbatim from Thread.tsx (structure-only refactor).

import { useAuiState } from "@assistant-ui/react";
import {
  memo,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { isPreviewableFilePath } from "../../../shared/validateMessage";
import {
  activeActivityIndex,
  summarizeActivityGroup,
  type GroupCandidatePart,
} from "../activityGrouping";
import { commandCardTitle, commandChips } from "../commandCard";
import { parsePlanSteps } from "../planAnchor";
import {
  useSubagentActivity,
  useOpenSubagent,
} from "../subagentPanelFlow";
import { formatElapsed } from "../subagentWorking";
import { PreviewChip, ToolFilePath } from "./transcriptRows";
import {
  CommandCardLeading,
  CommandCardMenu,
  CommandTerminalContent,
  ExecuteMirrorEntry,
} from "./commandCard";
import { ActivityChevron } from "./icons";
import {
  firstLine,
  formatDuration,
  formatToolLifecycle,
  formatToolProgress,
  readToolActivity,
  type ToolActivityPresentation,
} from "./readers";

/**
 * Terminal-style tail of a running execute command (tier1 §1). Pinned
 * to the bottom like a terminal; scrolling up unpins until the reader
 * returns to the bottom. Completion freezes the final tail in place.
 */
export function ToolOutputPreview({
  text,
  running,
  open,
}: {
  readonly text: string;
  readonly running: boolean;
  readonly open: boolean;
}): React.JSX.Element {
  const preRef = useRef<HTMLPreElement | null>(null);
  const pinnedRef = useRef(true);
  // `open` re-pins after a closed row (zero scrollHeight) reopens.
  useEffect(() => {
    const pre = preRef.current;
    if (running && open && pinnedRef.current && pre !== null) {
      pre.scrollTop = pre.scrollHeight;
    }
  }, [text, running, open]);
  // The frame carries the finished surface (border, warm background)
  // while the inner pre scrolls under a top fade mask, so the tail
  // truncation dissolves instead of hard-cutting at the frame edge.
  return (
    <div className="dvx-tool-output-frame">
      <pre
        ref={preRef}
        className="dvx-tool-output"
        onScroll={(event) => {
          const pre = event.currentTarget;
          pinnedRef.current =
            pre.scrollHeight - pre.scrollTop - pre.clientHeight < 8;
        }}
      >
        {text}
      </pre>
    </div>
  );
}

export function ToolActivityRow({
  activity,
  toolName,
  toolUseId,
}: {
  readonly activity: ToolActivityPresentation;
  readonly toolName: string;
  /** Opaque row handle for subagent actions (never a session id). */
  readonly toolUseId?: string;
}): React.JSX.Element {
  // Plan rows open by default only when they appear inside a live
  // turn, so the checklist is visible while Droid works but recovered
  // histories mount collapsed and stay cheap to lay out.
  const messageRunning = useAuiState(
    (s) => s.message.status?.type === "running",
  );
  const planDefaultRef = useRef(
    activity.detailKind === "plan" && messageRunning,
  );
  // An explicit reader toggle always wins over the automatic policy;
  // history and replay rows are never "running", so they mount closed.
  const [openOverride, setOpenOverride] = useState<boolean | null>(null);
  const running = activity.status === "running";
  // Running execute rows show their live output tail without a click
  // and settle back closed on completion (user report batch 2 §2).
  const autoOpen =
    activity.detailKind === "plan"
      ? planDefaultRef.current
      : activity.detailKind === "command" && running;
  const open = openOverride ?? autoOpen;
  // Collapsed plans keep their position visible: "3/7 · current item"
  // replaces scanning a full checklist (streaming design item E).
  const planSummary =
    !open && activity.detailKind === "plan" && activity.detail !== null
      ? formatPlanSummary(activity.detail)
      : null;
  // Command rows render as a command card (terminal-card redesign):
  // rule-derived title + command-name chips in the header, the raw
  // command in a $-prefixed syntax-tinted well when expanded.
  const isCommand =
    activity.detailKind === "command" && activity.detail !== null;
  const chips = isCommand ? commandChips(activity.detail ?? "") : [];
  // A failed command reads like a real terminal: its error lands
  // inside the output well (user report #29) instead of a loose
  // paragraph under the card. With a live tail already showing the
  // output, only the error's summary line is appended to it.
  const commandError =
    isCommand && activity.status === "failed"
      ? activity.errorMessage
      : null;
  const outputText =
    commandError === null
      ? activity.outputTail
      : activity.outputTail === null
        ? commandError
        : `${activity.outputTail}\n${firstLine(commandError)}`;
  const showActivityState =
    !isCommand || activity.status !== "completed";
  const row = (
    <details
      className={`dvx-activity-row${running ? " dvx-activity-running" : ""}${
        activity.subagent !== null ? " dvx-activity-row-delegating" : ""
      }${activity.background ? " dvx-activity-row-background" : ""}${
        isCommand ? " dvx-command-card" : ""
      }`}
      open={open}
      onToggle={(event) => {
        // Prop-driven toggles arrive already matching the rendered
        // state; only a native user toggle diverges from it, and only
        // that records an override.
        if (event.currentTarget.open !== open) {
          setOpenOverride(event.currentTarget.open);
        }
      }}
    >
      <summary>
        {isCommand ? (
          <CommandCardLeading />
        ) : (
          <span className="dvx-activity-indicator" />
        )}
        <span className="dvx-tool-action">
          {isCommand
            ? commandCardTitle(activity.action, toolName, activity.detail)
            : activity.action}
        </span>
        {activity.target === null ? null : (
          <span className="dvx-tool-target" title={activity.target}>
            {activity.target}
          </span>
        )}
        {planSummary === null ? null : (
          <span className="dvx-plan-summary">{planSummary}</span>
        )}
        {chips.length === 0 ? null : (
          <span className="dvx-command-chips">{chips.join(", ")}</span>
        )}
        {activity.filePath === null ? null : (
          <ToolFilePath
            path={activity.filePath}
            turnId={activity.turnId}
            interactive={false}
          />
        )}
        {showActivityState ? (
          <span
            className={`dvx-activity-state${
              activity.status === "failed"
                ? " dvx-activity-state-failed"
                : ""
            }`}
          >
            {formatToolLifecycle(activity.status)}
            {activity.durationMs === null
              ? ""
              : ` · ${formatDuration(activity.durationMs)}`}
          </span>
        ) : null}
        {isCommand ? null : <ActivityChevron />}
      </summary>
      {activity.filePath !== null || isCommand ? (
        <div className="dvx-tool-row-actions">
          {activity.filePath === null ? null : (
            <ToolFilePath
              path={activity.filePath}
              turnId={activity.turnId}
              showStats={false}
            />
          )}
          {activity.filePath !== null &&
          activity.status === "completed" &&
          isPreviewableFilePath(activity.filePath) ? (
            <PreviewChip path={activity.filePath} />
          ) : null}
          {isCommand ? (
            <CommandCardMenu command={activity.detail ?? ""} />
          ) : null}
        </div>
      ) : null}
      {activity.detailKind === "plan" && activity.detail !== null ? (
        <TaskPlan detail={activity.detail} />
      ) : isCommand ? (
        <CommandTerminalContent
          command={activity.detail ?? ""}
          outputText={outputText}
          running={running}
          open={open}
        />
      ) : (
        <div className="dvx-tool-summary">
          <code>{toolName}</code>
          <span>{formatToolProgress(activity)}</span>
        </div>
      )}
      {outputText === null || isCommand ? null : (
        <ToolOutputPreview
          text={outputText}
          running={running}
          open={open}
        />
      )}
      <ExecuteMirrorEntry
        status={activity.status}
        detailKind={activity.detailKind}
      />
      {activity.status === "failed" &&
      activity.errorMessage !== null &&
      commandError === null ? (
        <p className="dvx-tool-error">{activity.errorMessage}</p>
      ) : null}
    </details>
  );
  if (activity.subagent === null && !activity.background) {
    return row;
  }
  // The delegated subagent hangs one level under its Task row. One
  // level only: child sessions never stream their internals into the
  // parent transcript, so no deeper hierarchy is fabricated. A
  // running sub-row carries its own quiet spinner (decision change
  // 2026-08-12: delegations can outlive their turn, so the shimmer
  // alone left live work invisible). A backgrounded execute row gets
  // one quiet informational line, since the GUI cannot stop the
  // process.
  return (
    <>
      {row}
      {activity.background ? <BackgroundProcessHint /> : null}
      {activity.subagent === null ? null : (
        <SubagentSummaryRow
          type={activity.subagent.type}
          description={activity.subagent.description}
          status={activity.subagent.status}
          toolUseCount={activity.subagent.toolUseCount}
          durationMs={activity.subagent.durationMs}
          toolUseId={toolUseId}
          turnId={activity.turnId}
          // Parent Task row settled while the delegation still runs:
          // the honest label is "running in background" (the ledger
          // has no push channel; the post-turn reconcile polls it).
          parentSettled={
            activity.status === "completed" ||
            activity.status === "failed"
          }
          parentRunning={running}
        />
      )}
    </>
  );
}

/**
 * One quiet line under an execute row the CLI detached
 * (fireAndForget). Plain subtle text, no icon, no color chrome
 * (background-process design §3.2); stopping the process is the
 * user's manual action because the GUI holds no handle.
 */
export function BackgroundProcessHint(): React.JSX.Element {
  return (
    <p className="dvx-tool-background-hint">
      Background process · Keeps running until you stop it manually
    </p>
  );
}

/**
 * One quiet indented summary row for a delegated subagent. Props are
 * primitives so the memo holds even though the parent rebuilds its
 * presentation object every render: with a window full of settled
 * delegations, re-rendering each sub-row on message append measurably
 * lengthened the append task (120-turn stress).
 */
export const SubagentSummaryRow = memo(function SubagentSummaryRow({
  type,
  description,
  status,
  toolUseCount,
  durationMs,
  toolUseId,
  turnId,
  parentSettled = false,
  parentRunning = false,
}: NonNullable<ToolActivityPresentation["subagent"]> & {
  /** Opaque row handle for the read-only transcript entry point. */
  readonly toolUseId?: string;
  readonly turnId: string | null;
  /** The parent Task row reached a terminal state. */
  readonly parentSettled?: boolean;
  /** The parent Task row is still streaming. */
  readonly parentRunning?: boolean;
}): React.JSX.Element {
  const activity = useSubagentActivity(toolUseId);
  const openSubagent = useOpenSubagent();
  // The delegation identity arrives with the Task input long before
  // the SDK reports a lifecycle status (probed 2026-08-13: the
  // child_session_available notification only surfaces with the
  // Task's own tool_result). A statusless row under a running Task
  // is live work by construction, so it spins and says so instead of
  // sitting inert for the whole visible run.
  const effectiveStatus =
    status ?? (parentRunning ? "running" : null);
  const label =
    parentSettled && effectiveStatus === "running"
      ? "running in background"
      : effectiveStatus;
  const running = effectiveStatus === "running";
  const startedAtRef = useRef(Date.now());
  const [, setElapsedTick] = useState(0);
  useEffect(() => {
    if (!running || durationMs !== null) {
      return undefined;
    }
    const timer = window.setInterval(
      () => setElapsedTick((tick) => tick + 1),
      1_000,
    );
    return () => window.clearInterval(timer);
  }, [durationMs, running]);
  const elapsed =
    durationMs !== null
      ? formatDuration(durationMs)
      : running
        ? formatElapsed(Date.now() - startedAtRef.current)
        : "—";
  const activities = activity?.activities ?? [];
  const latestActivity = activities[0] ?? null;
  return (
    <button
      type="button"
      className={`dvx-subagent-row${running ? " dvx-subagent-live" : ""}`}
      disabled={toolUseId === undefined || turnId === null}
      onClick={() => {
        if (toolUseId !== undefined && turnId !== null) {
          openSubagent(turnId, toolUseId);
        }
      }}
    >
      <div className="dvx-subagent-head">
        {running ? (
          <span className="dvx-subagent-spinner" aria-hidden="true" />
        ) : null}
        <span className="dvx-subagent-label">
          {`${type} subagent`}
        </span>
        <span className="dvx-subagent-status">
          {formatSubagentStatus(label)}
        </span>
        <span className="dvx-subagent-open-arrow" aria-hidden="true">
          ›
        </span>
      </div>
      {description.length > 0 ? (
        <span className="dvx-subagent-description">{description}</span>
      ) : null}
      <div className="dvx-subagent-activity">
        <span
          className="dvx-subagent-activity-dot"
          aria-hidden="true"
        />
        {latestActivity === null ? (
          <span className="dvx-subagent-activity-empty">
            {running ? "Waiting for activity…" : "No activity recorded"}
          </span>
        ) : (
          <span
            className="dvx-subagent-activity-line"
            key={`${latestActivity.action}\u0000${
              latestActivity.target ?? ""
            }`}
          >
            <span className="dvx-subagent-activity-action">
              {latestActivity.action}
            </span>
            {latestActivity.target === null ? null : (
              <span className="dvx-subagent-activity-target">
                {latestActivity.target}
              </span>
            )}
          </span>
        )}
      </div>
      <div className="dvx-subagent-metrics">
        <span>
          <span className="dvx-subagent-metric-label">Elapsed</span>
          {elapsed}
        </span>
        {toolUseCount === null ? null : (
          <>
            <span className="dvx-subagent-metric-separator">·</span>
            <span>
              <span className="dvx-subagent-metric-label">Tools</span>
              {toolUseCount}
            </span>
          </>
        )}
      </div>
    </button>
  );
});

function formatSubagentStatus(status: string | null): string {
  if (status === null) {
    return "Pending";
  }
  return status.charAt(0).toUpperCase() + status.slice(1);
}

/**
 * "running" / "completed · 7 tool uses · 4.2s"; counters only appear
 * when the invocation ledger reported them.
 */
export function formatSubagentSummary(subagent: {
  readonly status: string | null;
  readonly toolUseCount: number | null;
  readonly durationMs: number | null;
}): string {
  const pieces = [subagent.status ?? ""];
  if (subagent.toolUseCount !== null) {
    pieces.push(
      `${subagent.toolUseCount} tool ${
        subagent.toolUseCount === 1 ? "use" : "uses"
      }`,
    );
  }
  if (subagent.durationMs !== null) {
    pieces.push(formatDuration(subagent.durationMs));
  }
  return pieces.filter((piece) => piece.length > 0).join(" · ");
}

/**
 * A coalesced run of exploration tools (and swallowed short Thinking).
 * The collapsed group is one real button: while active it shows the
 * latest member in a clipped text slot; once finished the same row
 * becomes an "Explored 3 files, 2 searches" summary. Expanding the
 * group exposes the original interactive rows, including Thinking.
 */
export function ActivityGroup({
  indices,
  children,
}: {
  readonly indices: readonly number[];
  readonly children: ReactNode;
}): React.JSX.Element {
  const parts = useAuiState((s) => s.message.parts);
  const members = useMemo(() => {
    const found: GroupCandidatePart[] = [];
    for (const index of indices) {
      const member = parts[index];
      if (member !== undefined) {
        found.push(member);
      }
    }
    return found;
  }, [parts, indices]);
  const summary = useMemo(() => summarizeActivityGroup(members), [members]);
  const [expanded, setExpanded] = useState(false);
  const activeIndex = activeActivityIndex(members);
  const activeMember = members[activeIndex];
  const activeActivity =
    activeMember?.type === "reasoning"
      ? { action: "Thinking", target: null }
      : activeMember === undefined
        ? { action: "", target: null }
        : readToolActivity(activeMember);
  const messageRunning = useAuiState(
    (s) => s.message.status?.type === "running",
  );
  const groupClosed =
    !messageRunning ||
    (indices[indices.length - 1] ?? -1) < parts.length - 1;
  const running = !groupClosed || summary.anyRunning;

  if (!summary.renderAsGroup) {
    return <>{children}</>;
  }

  const stateBits: string[] = [];
  if (summary.failedCount > 0) {
    stateBits.push(`${summary.failedCount} failed`);
  }
  if (summary.stoppedCount > 0) {
    stateBits.push("stopped");
  }
  if (summary.durationMs !== null) {
    stateBits.push(formatDuration(summary.durationMs));
  }
  return (
    <div
      className={`dvx-activity-group${
        running ? " dvx-activity-group-running" : ""
      }`}
    >
      <button
        type="button"
        className={`dvx-activity-group-summary${
          running ? "" : " dvx-activity-group-summary-completed"
        }`}
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <ActivityChevron />
        {running ? (
          <>
            <span className="dvx-activity-group-title">
              <span className="dvx-activity-group-running-dot" />
              <span>Exploring</span>
            </span>
            <span className="dvx-activity-group-current-slot">
              <span
                key={`${activeIndex}:${activeActivity.action}:${
                  activeActivity.target ?? ""
                }`}
                className="dvx-activity-group-current"
              >
                <span>{activeActivity.action}</span>
                {activeActivity.target === null ? null : (
                  <span
                    className="dvx-activity-group-current-target"
                    title={activeActivity.target}
                  >
                    {activeActivity.target}
                  </span>
                )}
              </span>
            </span>
          </>
        ) : (
          <span className="dvx-tool-action">
            Explored {summary.countsLabel}
          </span>
        )}
        {!running && stateBits.length > 0 ? (
          <span
            className={`dvx-activity-state${
              summary.failedCount > 0
                ? " dvx-activity-state-failed"
                : ""
            }`}
          >
            {stateBits.join(" · ")}
          </span>
        ) : null}
      </button>
      <div
        className={`dvx-activity-group-details${
          expanded ? " dvx-activity-group-details-open" : ""
        }`}
        aria-hidden={!expanded}
        inert={expanded ? undefined : true}
      >
        <div className="dvx-activity-group-details-inner">{children}</div>
      </div>
    </div>
  );
}

/**
 * Collapsed-plan position line: `3/7 · <current item>`. The current
 * item is the in-progress step, falling back to the next pending one
 * so a just-advanced plan still reads usefully; fully completed plans
 * show the count alone.
 */
export function formatPlanSummary(detail: string): string | null {
  const steps = parsePlanSteps(detail);
  if (steps.length === 0) {
    return null;
  }
  const completed = steps.filter((step) => step.status === "completed").length;
  const current =
    steps.find((step) => step.status === "in_progress") ??
    steps.find((step) => step.status === "pending");
  return current === undefined
    ? `${completed}/${steps.length}`
    : `${completed}/${steps.length} · ${firstLine(current.text)}`;
}

export function TaskPlan({ detail }: { readonly detail: string }): React.JSX.Element {
  const steps = parsePlanSteps(detail);
  if (steps.length === 0) {
    return <pre className="dvx-tool-command">{detail}</pre>;
  }
  const completed = steps.filter((step) => step.status === "completed").length;
  return (
    <div className="dvx-plan">
      <div className="dvx-plan-progress">
        {completed}/{steps.length} done
      </div>
      <ol className="dvx-plan-list">
        {steps.map((step, index) => (
          <li
            key={index}
            className={`dvx-plan-step dvx-plan-step-${step.status}`}
          >
            <span className="dvx-plan-marker" aria-hidden="true" />
            <span className="dvx-plan-text">{step.text}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
