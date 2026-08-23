// activityRows: moved verbatim from Thread.tsx (structure-only refactor).

import { useAuiState } from "@assistant-ui/react";
import {
  Children,
  Fragment,
  isValidElement,
  memo,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { isPreviewableFilePath } from "../../../shared/validateMessage";
import {
  activeTickerIndex,
  summarizeActivityGroup,
  type GroupCandidatePart,
} from "../activityGrouping";
import { commandCardTitle, commandChips } from "../commandCard";
import { parsePlanSteps } from "../planAnchor";
import {
  useSubagentActivity,
} from "../subagentPanelFlow";
import { formatElapsed } from "../subagentWorking";
import { PreviewChip, ToolFilePath } from "./transcriptRows";
import {
  CommandCardMenu,
  CommandWellLine,
  ExecuteMirrorEntry,
} from "./commandCard";
import { ActivityChevron } from "./icons";
import {
  firstLine,
  formatDuration,
  formatToolLifecycle,
  formatToolProgress,
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
        <span className="dvx-activity-indicator" />
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
          />
        )}
        {activity.filePath !== null &&
        activity.status === "completed" &&
        isPreviewableFilePath(activity.filePath) ? (
          <PreviewChip path={activity.filePath} />
        ) : null}
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
        {isCommand ? (
          <CommandCardMenu command={activity.detail ?? ""} />
        ) : null}
        <ActivityChevron />
      </summary>
      {activity.detailKind === "plan" && activity.detail !== null ? (
        <TaskPlan detail={activity.detail} />
      ) : isCommand ? (
        <div className="dvx-command-well">
          <CommandWellLine command={activity.detail ?? ""} />
        </div>
      ) : (
        <div className="dvx-tool-summary">
          <code>{toolName}</code>
          <span>{formatToolProgress(activity)}</span>
        </div>
      )}
      {outputText === null ? null : (
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
  parentSettled = false,
  parentRunning = false,
}: NonNullable<ToolActivityPresentation["subagent"]> & {
  /** Opaque row handle for the read-only transcript entry point. */
  readonly toolUseId?: string;
  /** The parent Task row reached a terminal state. */
  readonly parentSettled?: boolean;
  /** The parent Task row is still streaming. */
  readonly parentRunning?: boolean;
}): React.JSX.Element {
  const activity = useSubagentActivity(toolUseId);
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
  const recentActivities = activities.slice(1);
  return (
    <div className={`dvx-subagent-row${running ? " dvx-subagent-live" : ""}`}>
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
      </div>
      {description.length > 0 ? (
        <span className="dvx-subagent-description">{description}</span>
      ) : null}
      <div className="dvx-subagent-activity">
        <span className="dvx-subagent-activity-label">
          Latest activity
        </span>
        {latestActivity === null ? (
          <span className="dvx-subagent-activity-empty">
            {running ? "Waiting for activity…" : "No activity recorded"}
          </span>
        ) : (
          <span className="dvx-subagent-activity-line">
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
      {recentActivities.length === 0 ? null : (
        <div className="dvx-subagent-recent">
          <span className="dvx-subagent-activity-label">Recent</span>
          <ol className="dvx-subagent-recent-list">
            {recentActivities.map((recentActivity, index) => (
              <li
                className="dvx-subagent-recent-item"
                key={`${recentActivity.action}\u0000${
                  recentActivity.target ?? ""
                }\u0000${String(index)}`}
              >
                <span>{recentActivity.action}</span>
                {recentActivity.target === null ? null : (
                  <span className="dvx-subagent-activity-target">
                    {recentActivity.target}
                  </span>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}
      <div className="dvx-subagent-metrics">
        <span>
          <span className="dvx-subagent-metric-label">Elapsed</span>
          {elapsed}
        </span>
        {toolUseCount === null ? null : (
          <span>
            <span className="dvx-subagent-metric-label">Tools</span>
            {toolUseCount}
          </span>
        )}
      </div>
    </div>
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
 * While any member runs it shows an "Exploring" header over a bounded
 * auto-scrolling preview of the live rows; once finished it collapses
 * to an "Explored 3 files, 2 searches" summary that expands on click.
 * Runs below the batch threshold render their rows unchanged.
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
  const activeIndex = activeTickerIndex(members);
  const messageRunning = useAuiState(
    (s) => s.message.status?.type === "running",
  );
  const groupClosed =
    !messageRunning ||
    (indices[indices.length - 1] ?? -1) < parts.length - 1;
  const requiresPlaybackRef = useRef(messageRunning);
  const [visibleTickerIndex, setVisibleTickerIndex] = useState(0);
  const [phase, setPhase] = useState<ActivityGroupPhase>(
    groupClosed ? "completed" : "running",
  );
  const handleTickerSettled = useCallback((index: number): void => {
    setVisibleTickerIndex(index);
  }, []);

  useLayoutEffect(() => {
    const visualComplete =
      !requiresPlaybackRef.current ||
      visibleTickerIndex >= members.length - 1;
    if (!groupClosed || !visualComplete) {
      setPhase((current) => (current === "running" ? current : "running"));
      return;
    }
    setPhase((current) => (current === "running" ? "settling" : current));
  }, [groupClosed, members.length, visibleTickerIndex]);

  useEffect(() => {
    if (phase !== "settling") {
      return undefined;
    }
    const timer = setTimeout(() => {
      setPhase((current) =>
        current === "settling" ? "completed" : current,
      );
    }, ACTIVITY_SETTLE_FALLBACK_MS);
    return () => clearTimeout(timer);
  }, [phase]);

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
    <div className={`dvx-activity-group dvx-activity-group-${phase}`}>
      <div
        className="dvx-activity-group-stage"
        onTransitionEnd={(event) => {
          if (
            phase === "settling" &&
            event.target === event.currentTarget &&
            event.propertyName === "height"
          ) {
            setPhase("completed");
          }
        }}
      >
        {phase !== "completed" ? (
          <div
            className="dvx-activity-group-running-view"
            aria-hidden={phase !== "running"}
          >
            <button
              type="button"
              className="dvx-activity-group-header"
              aria-expanded={expanded}
              onClick={() => setExpanded((value) => !value)}
            >
              <span className="dvx-activity-indicator" />
              <span className="dvx-shimmer-text">Exploring</span>
              <ActivityChevron />
            </button>
            <ActivityTicker
              activeIndex={activeIndex}
              onSettled={handleTickerSettled}
            >
              {children}
            </ActivityTicker>
          </div>
        ) : null}
        <button
          type="button"
          className="dvx-activity-group-summary"
          aria-expanded={phase === "completed" && expanded}
          aria-hidden={phase === "running"}
          tabIndex={phase === "completed" ? 0 : -1}
          onClick={() => {
            if (phase === "completed") {
              setExpanded((value) => !value);
            }
          }}
        >
          <span className="dvx-activity-indicator" />
          <span className="dvx-tool-action">
            Explored {summary.countsLabel}
          </span>
          {stateBits.length > 0 ? (
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
          <ActivityChevron />
        </button>
      </div>
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

type ActivityGroupPhase = "running" | "settling" | "completed";

/** Matches the 200ms group-height transition, plus fallback headroom. */
export const ACTIVITY_SETTLE_FALLBACK_MS = 260;

/** Matches the ticker slide transition in
 * 12-exploration-ticker.css (--dvx-ticker-duration, 280ms), plus
 * headroom; the timeout is the commit fallback when the transition
 * never fires (reduced motion, occluded webviews). */
export const TICKER_SLIDE_FALLBACK_MS = 340;

/**
 * GroupedParts hands a group's rendered members as ONE Fragment
 * element; unwrap it so the ticker can index individual member rows
 * (member order is preserved — the mapped nodes are always elements,
 * so toArray drops nothing).
 */
export function tickerChildArray(children: ReactNode): ReturnType<typeof Children.toArray> {
  if (isValidElement(children) && children.type === Fragment) {
    return Children.toArray(
      (children.props as { children?: ReactNode }).children,
    );
  }
  return Children.toArray(children);
}

/** One trail row. Each entry carries its own monotonic mount key so
 * adjacent steps can overlap during the slide without key reuse. */
interface TickerTrailEntry {
  readonly key: number;
  readonly member: number;
}

/**
 * One-row vertical ticker over the grouped children: shows only the
 * active member. When the source advances several members inside one
 * Webview frame, the ticker still moves one index per slide: the
 * outgoing row fades upward and the next row enters below. The latest
 * source index is a monotonic target, not a direct jump, so every
 * explored file remains visible before the group can complete.
 * prefers-reduced-motion degrades to a direct swap via CSS (the
 * transitions are disabled, the fallback timer commits).
 */
export function ActivityTicker({
  activeIndex,
  onSettled,
  children,
}: {
  readonly activeIndex: number;
  readonly onSettled?: (index: number) => void;
  readonly children: ReactNode;
}): React.JSX.Element {
  const childArray = tickerChildArray(children);
  const targetRef = useRef(activeIndex);
  targetRef.current = Math.max(targetRef.current, activeIndex);
  const [trail, setTrail] = useState<readonly TickerTrailEntry[]>([
    { key: 0, member: 0 },
  ]);
  const trackRef = useRef<HTMLDivElement | null>(null);

  // The slide runs on DOM classes and a DOM-set offset variable, not
  // rendered props: the forced style flush pins the freshly mounted
  // incoming row at its pre-slide base (opacity 0, one row below the
  // viewport), then the same task retargets the track offset and the
  // per-row active classes, so transform and opacity transition
  // together from their committed/current values. No rAF —
  // headless/occluded webviews throttle it (phase-1 probe).
  useLayoutEffect(() => {
    const track = trackRef.current;
    if (track === null) {
      return undefined;
    }
    const items = track.children;
    if (trail.length < 2) {
      track.classList.remove("dvx-ticker-slide");
      track.style.removeProperty("--dvx-ticker-offset");
      items[0]?.classList.add("dvx-ticker-item-active");
      const current = trail[0];
      const target = Math.min(
        targetRef.current,
        Math.max(0, childArray.length - 1),
      );
      if (current !== undefined && current.member < target) {
        setTrail([
          current,
          { key: current.key + 1, member: current.member + 1 },
        ]);
      } else if (current !== undefined) {
        onSettled?.(current.member);
      }
      return undefined;
    }
    void track.offsetHeight;
    track.classList.add("dvx-ticker-slide");
    track.style.setProperty("--dvx-ticker-offset", String(trail.length - 1));
    for (let index = 0; index < items.length; index += 1) {
      items[index]!.classList.toggle(
        "dvx-ticker-item-active",
        index === items.length - 1,
      );
    }
    const commit = (): void => {
      setTrail((previous) =>
        previous.length > 1 ? [previous[previous.length - 1]!] : previous,
      );
    };
    const timer = setTimeout(commit, TICKER_SLIDE_FALLBACK_MS);
    const onTransitionEnd = (event: TransitionEvent): void => {
      // Row opacity transitions bubble here too; only the track's own
      // transform end marks the slide as settled.
      if (event.target === track) {
        commit();
      }
    };
    track.addEventListener("transitionend", onTransitionEnd);
    return () => {
      clearTimeout(timer);
      track.removeEventListener("transitionend", onTransitionEnd);
    };
  }, [activeIndex, childArray.length, onSettled, trail]);

  return (
    <div className="dvx-activity-ticker" aria-hidden="true" inert>
      <div className="dvx-ticker-track" ref={trackRef}>
        {trail.map((entry) => (
          <div className="dvx-ticker-item" key={entry.key}>
            {childArray[entry.member] ?? null}
          </div>
        ))}
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
