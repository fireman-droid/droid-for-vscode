// activityRows: moved verbatim from Thread.tsx (structure-only refactor).

import { useAuiState } from "@assistant-ui/react";
import {
  Children,
  Fragment,
  isValidElement,
  memo,
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
import { PlanAnchorCard } from "../PlanAnchorCard";
import { PlanAnchorContext, PreviewChip, ToolFilePath } from "../Thread";
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

/**
 * Renders the plan's anchor card directly above the todowrite row
 * that created the plan (Cursor-style "Created Plan" in the flow).
 * Later todowrite rows render nothing here — they update the anchored
 * card's projection instead. Rendering through the ordinary tool-part
 * path keeps live turns and history replay isomorphic by
 * construction.
 */
export function PlanAnchorSlot({
  toolCallId,
}: {
  readonly toolCallId: string | undefined;
}): React.JSX.Element | null {
  const { anchors, running } = useContext(PlanAnchorContext);
  const anchor =
    toolCallId === undefined ? undefined : anchors?.get(toolCallId);
  if (anchor === undefined) {
    return null;
  }
  return <PlanAnchorCard anchor={anchor} running={running} />;
}

export function ToolActivityRow({
  activity,
  toolName,
}: {
  readonly activity: ToolActivityPresentation;
  readonly toolName: string;
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
        {planSummary === null ? null : (
          <span className="dvx-plan-summary">{planSummary}</span>
        )}
        {chips.length === 0 ? null : (
          <span className="dvx-command-chips">{chips.join(", ")}</span>
        )}
        {activity.filePath === null ? null : (
          <ToolFilePath path={activity.filePath} />
        )}
        {activity.filePath !== null &&
        activity.status === "completed" &&
        isPreviewableFilePath(activity.filePath) ? (
          <PreviewChip path={activity.filePath} />
        ) : null}
        <span className="dvx-activity-state">
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
      {activity.outputTail === null ? null : (
        <ToolOutputPreview
          text={activity.outputTail}
          running={running}
          open={open}
        />
      )}
      <ExecuteMirrorEntry
        status={activity.status}
        detailKind={activity.detailKind}
      />
      {activity.status === "failed" && activity.errorMessage !== null ? (
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
  parentSettled = false,
  parentRunning = false,
}: NonNullable<ToolActivityPresentation["subagent"]> & {
  /** The parent Task row reached a terminal state. */
  readonly parentSettled?: boolean;
  /** The parent Task row is still streaming. */
  readonly parentRunning?: boolean;
}): React.JSX.Element {
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
  return (
    <div className="dvx-subagent-row">
      {effectiveStatus === "running" ? (
        <span className="dvx-subagent-spinner" aria-hidden="true" />
      ) : null}
      <span className="dvx-subagent-label">
        {`Delegated to ${type} subagent`}
      </span>
      {label === null ? null : (
        <span className="dvx-activity-state">
          {formatSubagentSummary({
            status: label,
            toolUseCount,
            durationMs,
          })}
        </span>
      )}
      {description.length > 0 ? (
        <span className="dvx-subagent-description">{description}</span>
      ) : null}
    </div>
  );
});

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

  if (!summary.renderAsGroup) {
    return <>{children}</>;
  }

  if (summary.anyRunning) {
    // One-row vertical ticker (user report batch 2 §1): only the
    // member that is running now shows under the header; a new
    // arrival slides the old row up and out.
    return (
      <div className="dvx-activity-group dvx-activity-group-running">
        <div className="dvx-activity-group-header">
          <span className="dvx-activity-indicator" />
          <span className="dvx-shimmer-text">Exploring</span>
        </div>
        <ActivityTicker activeIndex={activeTickerIndex(members)}>
          {children}
        </ActivityTicker>
      </div>
    );
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
    <div className="dvx-activity-group">
      <button
        type="button"
        className="dvx-activity-group-summary"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <span className="dvx-activity-indicator" />
        <span className="dvx-tool-action">Explored {summary.countsLabel}</span>
        {stateBits.length > 0 ? (
          <span
            className={`dvx-activity-state${
              summary.failedCount > 0 ? " dvx-activity-state-failed" : ""
            }`}
          >
            {stateBits.join(" · ")}
          </span>
        ) : null}
        <ActivityChevron />
      </button>
      <div
        className={`dvx-activity-group-details${
          expanded ? " dvx-activity-group-details-open" : ""
        }`}
      >
        <div className="dvx-activity-group-details-inner">{children}</div>
      </div>
    </div>
  );
}

/** Matches the ticker slide transition in styles.css, plus headroom;
 * the timeout is the commit fallback when the transition never fires
 * (reduced motion, occluded webviews). */
export const TICKER_SLIDE_FALLBACK_MS = 320;

/**
 * One-row vertical ticker over the grouped children: shows only the
 * active member; when the active index advances, the old row slides
 * up and out while the new one slides in from below. The trail holds
 * [previous, current] during a slide and a mid-slide arrival commits
 * the running slide first (fast-forward), so bursts never queue up.
 * prefers-reduced-motion degrades to a direct swap via CSS (the
 * transition is disabled, the fallback timer commits).
 */
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

export function ActivityTicker({
  activeIndex,
  children,
}: {
  readonly activeIndex: number;
  readonly children: ReactNode;
}): React.JSX.Element {
  const childArray = tickerChildArray(children);
  const [trail, setTrail] = useState<readonly number[]>([activeIndex]);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const current = trail[trail.length - 1];
  if (current !== undefined && current !== activeIndex) {
    // Adjust during render so the outgoing/incoming pair mounts in
    // the same pass the active index changes.
    setTrail([current, activeIndex]);
  }

  // The slide runs on the DOM class, not rendered className: a forced
  // style flush pins the two-row track at translateY(0), adding the
  // class in the same task then transitions from that committed base.
  // No rAF — headless/occluded webviews throttle it (phase-1 probe).
  useLayoutEffect(() => {
    const track = trackRef.current;
    if (track === null) {
      return undefined;
    }
    if (trail.length < 2) {
      track.classList.remove("dvx-ticker-slide");
      return undefined;
    }
    track.classList.remove("dvx-ticker-slide");
    void track.offsetHeight;
    track.classList.add("dvx-ticker-slide");
    const commit = (): void => {
      setTrail((previous) =>
        previous.length > 1 ? [previous[previous.length - 1]!] : previous,
      );
    };
    const timer = setTimeout(commit, TICKER_SLIDE_FALLBACK_MS);
    const onTransitionEnd = (event: TransitionEvent): void => {
      if (event.target === track) {
        commit();
      }
    };
    track.addEventListener("transitionend", onTransitionEnd);
    return () => {
      clearTimeout(timer);
      track.removeEventListener("transitionend", onTransitionEnd);
    };
  }, [trail]);

  return (
    <div className="dvx-activity-ticker" aria-label="Exploration in progress">
      <div className="dvx-ticker-track" ref={trackRef}>
        {trail.map((index) => (
          <div className="dvx-ticker-item" key={index}>
            {childArray[index] ?? null}
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
