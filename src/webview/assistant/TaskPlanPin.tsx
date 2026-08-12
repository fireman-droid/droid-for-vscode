import { useEffect, useRef, useState } from 'react';

import type { TaskPlanPinState } from './planPin';

/** How long the finished plan stays visible before fading out. */
export const TASK_PLAN_PIN_SETTLE_MS = 1600;
/** Matches the CSS opacity transition on .dvx-plan-pin-leaving. */
export const TASK_PLAN_PIN_FADE_MS = 320;

/**
 * The task plan pinned above the Composer (Cursor-style). Collapsed
 * it is one quiet line — status dot, current step, done/total count;
 * clicking expands the full checklist upward, clicking again or
 * outside collapses it. When the plan finishes during a live turn the
 * pin briefly shows its completed state and fades away; a plan that
 * is already complete when it arrives (history replay, session
 * switch) never mounts.
 */
export function TaskPlanPin({
  pin,
}: {
  readonly pin: TaskPlanPinState | null;
}): React.JSX.Element | null {
  const [expanded, setExpanded] = useState(false);
  const [exitPhase, setExitPhase] = useState<'none' | 'leaving' | 'hidden'>(
    'none',
  );
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Whether this session was earlier observed with open steps. That
  // observation separates a live finish (celebrate, then fade) from
  // mounting an already finished plan (history replay: never show).
  // It is per session, not per plan row, because Droid writes the
  // final all-completed update as a fresh todowrite tool call.
  const sawOpenPlanRef = useRef(false);
  const sessionRef = useRef<string | null>(null);
  const sessionKey = pin?.sessionKey ?? null;
  if (sessionRef.current !== sessionKey) {
    sessionRef.current = sessionKey;
    sawOpenPlanRef.current = false;
  }
  if (pin !== null && !pin.allCompleted) {
    sawOpenPlanRef.current = true;
  }

  // Reset the UI when the plan identity changes (new plan written,
  // session switched); adjusting state during render lets the reset
  // land before the first paint of the new plan.
  const previousKeyRef = useRef<string | null>(null);
  const planKey = pin?.planKey ?? null;
  if (previousKeyRef.current !== planKey) {
    previousKeyRef.current = planKey;
    setExpanded(false);
    setExitPhase('none');
  }
  const finishedLive =
    pin !== null && pin.allCompleted && sawOpenPlanRef.current;

  useEffect(() => {
    if (!finishedLive) {
      return undefined;
    }
    setExpanded(false);
    const hold = setTimeout(
      () => setExitPhase('leaving'),
      TASK_PLAN_PIN_SETTLE_MS,
    );
    const gone = setTimeout(
      () => setExitPhase('hidden'),
      TASK_PLAN_PIN_SETTLE_MS + TASK_PLAN_PIN_FADE_MS,
    );
    return () => {
      clearTimeout(hold);
      clearTimeout(gone);
    };
  }, [finishedLive, planKey]);

  useEffect(() => {
    if (!expanded) {
      return undefined;
    }
    const onPointerDown = (event: PointerEvent): void => {
      const container = containerRef.current;
      if (
        container !== null &&
        event.target instanceof Node &&
        !container.contains(event.target)
      ) {
        setExpanded(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setExpanded(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [expanded]);

  if (pin === null) {
    return null;
  }
  if (pin.allCompleted && (!finishedLive || exitPhase === 'hidden')) {
    return null;
  }

  const headline = pin.allCompleted
    ? 'Plan complete'
    : (pin.currentText ?? 'Task plan');
  return (
    <div
      ref={containerRef}
      className={`dvx-plan-pin${expanded ? ' dvx-plan-pin-open' : ''}${
        exitPhase === 'leaving' ? ' dvx-plan-pin-leaving' : ''
      }${pin.allCompleted ? ' dvx-plan-pin-done' : ''}`}
    >
      <button
        type="button"
        className="dvx-plan-pin-toggle"
        aria-expanded={expanded}
        aria-label={`Task plan, ${pin.completedCount} of ${pin.totalCount} done`}
        onClick={() => setExpanded((value) => !value)}
      >
        {pin.allCompleted ? (
          <PinCheckIcon />
        ) : (
          <span className="dvx-plan-pin-dot" aria-hidden="true" />
        )}
        <span className="dvx-plan-pin-current">
          {expanded ? 'Task plan' : headline}
        </span>
        <span className="dvx-plan-pin-count">
          {pin.completedCount}/{pin.totalCount}
        </span>
        <PinChevron />
      </button>
      {expanded ? (
        <ol className="dvx-plan-pin-list">
          {pin.steps.map((step, index) => (
            <li
              key={index}
              className={`dvx-plan-pin-step dvx-plan-pin-step-${step.status}`}
            >
              {step.status === 'completed' ? (
                <PinCheckIcon />
              ) : (
                <span className="dvx-plan-pin-marker" aria-hidden="true" />
              )}
              <span className="dvx-plan-pin-text">{step.text}</span>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

function PinCheckIcon(): React.JSX.Element {
  return (
    <svg
      className="dvx-plan-pin-check"
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

function PinChevron(): React.JSX.Element {
  return (
    <svg
      className="dvx-plan-pin-chevron"
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
