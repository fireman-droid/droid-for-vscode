import { useState } from 'react';

import type { PlanAnchorState } from './planAnchor';

/**
 * Thin plan line anchored directly under the user message that
 * triggered the turn (decard design §3 A + user corrections
 * 2026-08-13). Collapsed it is one hairline-topped row — status dot,
 * title, n/m, chevron — and the whole row is the single disclosure
 * target. Expanded it lists the steps, each led by a small circle:
 * hollow for pending, accent-filled for the current step, grey with
 * a check for completed ones. While the turn is building the plan
 * the status dot carries the only animation (accent glow); once
 * every step is done the dot retires to grey.
 *
 * The line is a normal member of the sticky user-message block: the
 * existing pin coordinator in Thread.tsx carries it, and
 * [data-pinned] CSS alone adds the readability chassis and swaps the
 * expanded body to a non-displacing overlay. No scroll listening in
 * here. Later todowrites of the same lineage update the line in
 * place (see planAnchor.ts), and live turns and history replay
 * render identically.
 */
export function PlanLine({
  anchor,
  running,
}: {
  readonly anchor: PlanAnchorState;
  readonly running: boolean;
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const building = running && !anchor.allCompleted;
  const count = `${anchor.completedCount}/${anchor.totalCount}`;
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
        onClick={() => setExpanded((value) => !value)}
      >
        <span className="dvx-plan-line-dot" aria-hidden="true" />
        <span className="dvx-plan-line-title">{anchor.title}</span>
        <span className="dvx-plan-line-count">{count}</span>
        <PlanLineChevron open={expanded} />
      </button>
      {/* Always mounted so collapse can animate (grid-rows 0fr↔1fr);
          aria-hidden keeps the closed checklist out of the
          accessibility tree. */}
      <div
        className="dvx-plan-line-body"
        data-open={expanded ? 'true' : 'false'}
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
