import { useState } from 'react';

import type { PlanAnchorState } from './planAnchor';

/**
 * Plan card anchored directly under the user message that triggered
 * the turn (spec §3.5, 2026-08-15 — this REPLACES the 2026-08-13
 * "no card chrome" decision). Collapsed it is a one-row card — 32px
 * title row (status dot, title, n / m, chevron) closed by a 2px
 * completion bar — and the whole row is the single disclosure
 * target. Expanded it lists the steps below a hairline, each led by
 * a small circle: hollow for pending, accent-filled for the current
 * step, grey with a check for completed ones. While the turn is
 * building the plan the status dot carries the only ambient
 * animation (accent glow); once every step is done the dot and the
 * bar retire to grey.
 *
 * The line is a normal member of the sticky user-message block: the
 * its user-led virtual turn carries it through the browser's native
 * sticky hand-off. No scroll listening lives here. Later TodoWrites
 * of the same lineage update the line in
 * place; a new lineage replaces the old card session-wide (see
 * planAnchor.ts). Live turns and history replay render identically.
 */
export function PlanLine({
  anchor,
  running,
}: {
  readonly anchor: PlanAnchorState;
  readonly running: boolean;
}): React.JSX.Element {
  // While the turn is building the plan the checklist opens by
  // itself so the live check-off is visible without a click, and it
  // settles closed once every step is done (user report 2026-08-13:
  // "打钩要一边跑一边看得到"). An explicit reader toggle always wins;
  // history replay is never "building", so replays mount collapsed.
  const [expandOverride, setExpandOverride] = useState<boolean | null>(
    null,
  );
  const building = running && !anchor.allCompleted;
  const expanded = expandOverride ?? building;
  const autoExpanded = expandOverride === null && expanded;
  // Spaced "n / m" — the approved harness form (user correction
  // 2026-08-13 evening).
  const count = `${anchor.completedCount} / ${anchor.totalCount}`;
  const progressPercent =
    anchor.totalCount > 0
      ? (anchor.completedCount / anchor.totalCount) * 100
      : 0;
  return (
    <section
      className={`dvx-plan-line${
        anchor.allCompleted ? ' dvx-plan-line-done' : ''
      }${building ? ' dvx-plan-line-live' : ''}`}
      aria-label={`Task plan, ${anchor.completedCount} of ${anchor.totalCount} done`}
    >
      <button
        type="button"
        className="dvx-plan-line-row"
        aria-expanded={expanded}
        onClick={() => setExpandOverride(!expanded)}
      >
        <span className="dvx-plan-line-dot" aria-hidden="true" />
        <span className="dvx-plan-line-title">{anchor.title}</span>
        <span className="dvx-plan-line-count">{count}</span>
        <PlanLineChevron open={expanded} />
      </button>
      {/* 2px completion bar seated on the title row's bottom edge
          (spec §3.5); turns grey with the retired card. */}
      <span className="dvx-plan-line-bar" aria-hidden="true">
        <span
          className="dvx-plan-line-bar-fill"
          style={{ width: `${progressPercent}%` }}
        />
      </span>
      {/* Always mounted so collapse can animate (grid-rows 0fr↔1fr);
          aria-hidden keeps the closed checklist out of the
          accessibility tree. data-auto marks a building auto-open
          (as opposed to a reader's explicit toggle). */}
      <div
        className="dvx-plan-line-body"
        data-open={expanded ? 'true' : 'false'}
        data-auto={autoExpanded ? 'true' : 'false'}
        aria-hidden={!expanded}
      >
        <div className="dvx-plan-line-body-inner">
          <ol className="dvx-plan-line-steps">
            {anchor.steps.map((step, index) => (
              <li
                key={index}
                className={`dvx-plan-line-step dvx-plan-line-step-${step.status}`}
              >
                <span className="dvx-plan-line-ring" aria-hidden="true">
                  {step.status === 'completed' ? <StepCheckIcon /> : null}
                </span>
                <span className="dvx-plan-line-text">{step.text}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

function StepCheckIcon(): React.JSX.Element {
  return (
    <svg
      className="dvx-plan-line-check"
      viewBox="0 0 10 10"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="m2.3 5.3 1.9 1.9 3.6-4.2"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PlanLineChevron({
  open,
}: {
  readonly open: boolean;
}): React.JSX.Element {
  return (
    <svg
      className="dvx-plan-line-chevron"
      data-open={open ? 'true' : 'false'}
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
