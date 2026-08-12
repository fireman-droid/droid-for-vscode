import { useState } from 'react';

import type { PlanAnchorState } from './planAnchor';

/**
 * The plan's anchor card in the transcript (Cursor-style "Created
 * Plan"): quiet eyebrow, title, one-line summary, and a footer with
 * a View Plan toggle on the left and a status control on the right —
 * a warm "Building… n/m" while the turn runs, a quiet "Completed
 * n/n" once every step is done, a bare "n/m" for an open plan at
 * rest. Both footer controls expand the full checklist inside the
 * card. The card is a normal transcript member: it scrolls with the
 * flow, renders identically in live turns and history replay, and is
 * updated in place by later todowrites (see planAnchor.ts).
 */
export function PlanAnchorCard({
  anchor,
  running,
}: {
  readonly anchor: PlanAnchorState;
  readonly running: boolean;
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const toggle = (): void => setExpanded((value) => !value);
  const building = running && !anchor.allCompleted;
  const count = `${anchor.completedCount}/${anchor.totalCount}`;
  return (
    <section
      className={`dvx-plan-anchor${
        anchor.allCompleted ? ' dvx-plan-anchor-done' : ''
      }`}
      aria-label={`Task plan, ${anchor.completedCount} of ${anchor.totalCount} done`}
    >
      <p className="dvx-plan-anchor-eyebrow">Created Plan</p>
      <h4 className="dvx-plan-anchor-title">{anchor.title}</h4>
      <p className="dvx-plan-anchor-summary">{anchor.summary}</p>
      <div className="dvx-plan-anchor-foot">
        <button
          type="button"
          className="dvx-plan-anchor-view"
          aria-expanded={expanded}
          onClick={toggle}
        >
          {expanded ? 'Hide Plan' : 'View Plan'}
        </button>
        <button
          type="button"
          className={`dvx-plan-anchor-status${
            building ? ' dvx-plan-anchor-status-building' : ''
          }`}
          aria-expanded={expanded}
          onClick={toggle}
        >
          {anchor.allCompleted ? <AnchorCheckIcon /> : null}
          <span className="dvx-plan-anchor-status-label">
            {anchor.allCompleted
              ? `Completed ${count}`
              : building
                ? `Building… ${count}`
                : count}
          </span>
          <AnchorChevron open={expanded} />
        </button>
      </div>
      {/* Always mounted so collapse can animate (grid-rows 0fr↔1fr);
          aria-hidden keeps the closed checklist out of the
          accessibility tree. */}
      <div
        className="dvx-plan-anchor-body"
        data-open={expanded ? 'true' : 'false'}
        aria-hidden={!expanded}
      >
        <div className="dvx-plan-anchor-body-inner">
          <ol className="dvx-plan-anchor-list">
            {anchor.steps.map((step, index) => (
              <li
                key={index}
                className={`dvx-plan-anchor-step dvx-plan-anchor-step-${step.status}`}
              >
                {step.status === 'completed' ? (
                  <AnchorCheckIcon />
                ) : (
                  <span className="dvx-plan-anchor-marker" aria-hidden="true" />
                )}
                <span className="dvx-plan-anchor-text">{step.text}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

function AnchorCheckIcon(): React.JSX.Element {
  return (
    <svg
      className="dvx-plan-anchor-check"
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="m2.6 6.4 2.2 2.2 4.6-5.2"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function AnchorChevron({
  open,
}: {
  readonly open: boolean;
}): React.JSX.Element {
  return (
    <svg
      className="dvx-plan-anchor-chevron"
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
