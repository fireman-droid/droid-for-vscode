// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TaskPlanPinState } from './planPin';
import {
  TASK_PLAN_PIN_FADE_MS,
  TASK_PLAN_PIN_SETTLE_MS,
  TaskPlanPin,
} from './TaskPlanPin';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function makePin(
  overrides: Partial<TaskPlanPinState> = {},
): TaskPlanPinState {
  return {
    planKey: 'turn-1:use-1',
    steps: [
      { status: 'completed', text: 'Read the config' },
      { status: 'in_progress', text: 'Wire the selector' },
      { status: 'pending', text: 'Write the tests' },
    ],
    completedCount: 1,
    totalCount: 3,
    currentText: 'Wire the selector',
    allCompleted: false,
    ...overrides,
  };
}

function donePin(planKey = 'turn-1:use-1'): TaskPlanPinState {
  return makePin({
    planKey,
    steps: [
      { status: 'completed', text: 'Read the config' },
      { status: 'completed', text: 'Wire the selector' },
      { status: 'completed', text: 'Write the tests' },
    ],
    completedCount: 3,
    currentText: null,
    allCompleted: true,
  });
}

function toggle(): HTMLElement {
  return screen.getByRole('button', { name: /Task plan/ });
}

describe('TaskPlanPin', () => {
  it('renders nothing without a plan', () => {
    const { container } = render(<TaskPlanPin pin={null} />);
    expect(container.querySelector('.dvx-plan-pin')).toBeNull();
  });

  it('shows the current step and count while collapsed', () => {
    render(<TaskPlanPin pin={makePin()} />);
    const bar = toggle();
    expect(bar.getAttribute('aria-expanded')).toBe('false');
    expect(bar.textContent).toContain('Wire the selector');
    expect(bar.textContent).toContain('1/3');
    expect(document.querySelector('.dvx-plan-pin-list')).toBeNull();
  });

  it('expands to the full checklist and collapses on a second click', () => {
    render(<TaskPlanPin pin={makePin()} />);
    fireEvent.click(toggle());
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    const steps = [...document.querySelectorAll('.dvx-plan-pin-step')];
    expect(steps.map((step) => step.textContent)).toEqual([
      'Read the config',
      'Wire the selector',
      'Write the tests',
    ]);
    expect(steps[0]?.className).toContain('dvx-plan-pin-step-completed');
    expect(steps[1]?.className).toContain('dvx-plan-pin-step-in_progress');
    expect(steps[2]?.className).toContain('dvx-plan-pin-step-pending');
    fireEvent.click(toggle());
    expect(document.querySelector('.dvx-plan-pin-list')).toBeNull();
  });

  it('collapses on a pointer press outside and on Escape', () => {
    render(
      <div>
        <button type="button">outside</button>
        <TaskPlanPin pin={makePin()} />
      </div>,
    );
    fireEvent.click(toggle());
    fireEvent.pointerDown(screen.getByRole('button', { name: 'outside' }));
    expect(document.querySelector('.dvx-plan-pin-list')).toBeNull();
    fireEvent.click(toggle());
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(document.querySelector('.dvx-plan-pin-list')).toBeNull();
  });

  it('stays open on a pointer press inside the card', () => {
    render(<TaskPlanPin pin={makePin()} />);
    fireEvent.click(toggle());
    fireEvent.pointerDown(toggle());
    expect(document.querySelector('.dvx-plan-pin-list')).not.toBeNull();
  });

  it('follows plan updates in place', () => {
    const { rerender } = render(<TaskPlanPin pin={makePin()} />);
    rerender(
      <TaskPlanPin
        pin={makePin({
          steps: [
            { status: 'completed', text: 'Read the config' },
            { status: 'completed', text: 'Wire the selector' },
            { status: 'in_progress', text: 'Write the tests' },
          ],
          completedCount: 2,
          currentText: 'Write the tests',
        })}
      />,
    );
    expect(toggle().textContent).toContain('Write the tests');
    expect(toggle().textContent).toContain('2/3');
  });

  it('shows the finished state briefly, then fades out', () => {
    vi.useFakeTimers();
    const { rerender, container } = render(<TaskPlanPin pin={makePin()} />);
    rerender(<TaskPlanPin pin={donePin()} />);
    const pin = container.querySelector('.dvx-plan-pin');
    expect(pin?.className).toContain('dvx-plan-pin-done');
    expect(pin?.textContent).toContain('Plan complete');
    expect(pin?.textContent).toContain('3/3');
    act(() => vi.advanceTimersByTime(TASK_PLAN_PIN_SETTLE_MS));
    expect(
      container.querySelector('.dvx-plan-pin')?.className,
    ).toContain('dvx-plan-pin-leaving');
    act(() => vi.advanceTimersByTime(TASK_PLAN_PIN_FADE_MS));
    expect(container.querySelector('.dvx-plan-pin')).toBeNull();
  });

  it('collapses the checklist when the plan finishes', () => {
    vi.useFakeTimers();
    const { rerender } = render(<TaskPlanPin pin={makePin()} />);
    fireEvent.click(toggle());
    rerender(<TaskPlanPin pin={donePin()} />);
    expect(document.querySelector('.dvx-plan-pin-list')).toBeNull();
  });

  it('never mounts a plan that was already finished (history replay)', () => {
    const { container } = render(<TaskPlanPin pin={donePin()} />);
    expect(container.querySelector('.dvx-plan-pin')).toBeNull();
  });

  it('disappears when the session switches to one without a plan', () => {
    const { rerender, container } = render(<TaskPlanPin pin={makePin()} />);
    fireEvent.click(toggle());
    rerender(<TaskPlanPin pin={null} />);
    expect(container.querySelector('.dvx-plan-pin')).toBeNull();
  });

  it('resets state for a new plan identity', () => {
    vi.useFakeTimers();
    const { rerender, container } = render(<TaskPlanPin pin={makePin()} />);
    // Finish the first plan and let it fade away entirely.
    rerender(<TaskPlanPin pin={donePin()} />);
    act(() =>
      vi.advanceTimersByTime(TASK_PLAN_PIN_SETTLE_MS + TASK_PLAN_PIN_FADE_MS),
    );
    expect(container.querySelector('.dvx-plan-pin')).toBeNull();
    // A new plan (new key) with open steps shows again, collapsed.
    rerender(
      <TaskPlanPin
        pin={makePin({ planKey: 'turn-2:use-9', currentText: 'Next slice' })}
      />,
    );
    const bar = toggle();
    expect(bar.getAttribute('aria-expanded')).toBe('false');
    expect(document.querySelector('.dvx-plan-pin-list')).toBeNull();
    // An already-finished *new* plan key never shows (replayed switch).
    rerender(<TaskPlanPin pin={donePin('turn-3:use-1')} />);
    expect(container.querySelector('.dvx-plan-pin')).toBeNull();
  });

  it('restores the pin for a recovered session with open steps', () => {
    // Mounting directly with unfinished steps (history restore) shows.
    render(<TaskPlanPin pin={makePin()} />);
    expect(toggle().textContent).toContain('Wire the selector');
  });
});
