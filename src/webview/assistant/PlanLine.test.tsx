// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { PlanAnchorState } from './planAnchor';
import { PlanLine } from './PlanLine';

function makeAnchor(overrides: Partial<PlanAnchorState> = {}): PlanAnchorState {
  return {
    anchorToolUseId: 'use-1',
    latestTurnId: 'turn-1',
    title: 'Read the config',
    steps: [
      { status: 'completed', text: 'Read the config' },
      { status: 'in_progress', text: 'Wire the selector' },
      { status: 'pending', text: 'Write the tests' },
    ],
    completedCount: 1,
    totalCount: 3,
    allCompleted: false,
    ...overrides,
  };
}

function doneAnchor(): PlanAnchorState {
  return makeAnchor({
    steps: [
      { status: 'completed', text: 'Read the config' },
      { status: 'completed', text: 'Wire the selector' },
      { status: 'completed', text: 'Write the tests' },
    ],
    completedCount: 3,
    allCompleted: true,
  });
}

afterEach(cleanup);

describe('PlanLine', () => {
  it('renders one collapsed disclosure row: dot, title, count, chevron', () => {
    const { container } = render(
      <PlanLine anchor={makeAnchor()} running={false} />,
    );
    const row = container.querySelector('.dvx-plan-line-row');
    expect(row?.tagName).toBe('BUTTON');
    expect(row?.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('.dvx-plan-line-dot')).not.toBeNull();
    expect(container.querySelector('.dvx-plan-line-title')?.textContent).toBe(
      'Read the config',
    );
    expect(container.querySelector('.dvx-plan-line-count')?.textContent).toBe(
      '1 / 3',
    );
    expect(container.querySelector('.dvx-plan-line-chevron')).not.toBeNull();
    // The old card chrome is gone: no eyebrow, no summary, no
    // separate View/status controls.
    expect(container.querySelectorAll('button').length).toBe(1);
    expect(
      container
        .querySelector('.dvx-plan-line-body')
        ?.getAttribute('data-open'),
    ).toBe('false');
    expect(
      container
        .querySelector('.dvx-plan-line-body')
        ?.getAttribute('aria-hidden'),
    ).toBe('true');
  });

  it('marks the line live while the turn runs (dot glow carrier)', () => {
    const { container } = render(<PlanLine anchor={makeAnchor()} running />);
    expect(container.querySelector('.dvx-plan-line')?.className).toContain(
      'dvx-plan-line-live',
    );
  });

  it('auto-opens the checklist while the plan is building', () => {
    const { container } = render(
      <PlanLine anchor={makeAnchor()} running />,
    );
    const body = container.querySelector('.dvx-plan-line-body');
    expect(body?.getAttribute('data-open')).toBe('true');
    // Marked auto so the pinned overlay can suppress it.
    expect(body?.getAttribute('data-auto')).toBe('true');
  });

  it('settles the auto-open closed once every step is done', () => {
    const { rerender, container } = render(
      <PlanLine anchor={makeAnchor()} running />,
    );
    rerender(<PlanLine anchor={doneAnchor()} running={false} />);
    expect(
      container
        .querySelector('.dvx-plan-line-body')
        ?.getAttribute('data-open'),
    ).toBe('false');
  });

  it('lets an explicit reader toggle beat the building auto-open', () => {
    const { container } = render(
      <PlanLine anchor={makeAnchor()} running />,
    );
    fireEvent.click(container.querySelector('.dvx-plan-line-row')!);
    const body = container.querySelector('.dvx-plan-line-body');
    expect(body?.getAttribute('data-open')).toBe('false');
    // A manual open is not auto: the pinned overlay may show it.
    fireEvent.click(container.querySelector('.dvx-plan-line-row')!);
    expect(body?.getAttribute('data-open')).toBe('true');
    expect(body?.getAttribute('data-auto')).toBe('false');
  });

  it('retires quietly once every step is done', () => {
    const { container } = render(
      <PlanLine anchor={doneAnchor()} running={false} />,
    );
    const line = container.querySelector('.dvx-plan-line');
    expect(line?.className).toContain('dvx-plan-line-done');
    expect(line?.className).not.toContain('dvx-plan-line-live');
    expect(container.querySelector('.dvx-plan-line-count')?.textContent).toBe(
      '3 / 3',
    );
  });

  it('never glows for a finished plan even while running', () => {
    const { container } = render(<PlanLine anchor={doneAnchor()} running />);
    expect(container.querySelector('.dvx-plan-line')?.className).not.toContain(
      'dvx-plan-line-live',
    );
  });

  it('expands the circle step list from the row and collapses again', () => {
    const { container } = render(
      <PlanLine anchor={makeAnchor()} running={false} />,
    );
    const row = container.querySelector('.dvx-plan-line-row');
    fireEvent.click(row as Element);
    expect((row as Element).getAttribute('aria-expanded')).toBe('true');
    const body = container.querySelector('.dvx-plan-line-body');
    expect(body?.getAttribute('data-open')).toBe('true');
    expect(body?.getAttribute('aria-hidden')).toBe('false');
    const steps = container.querySelectorAll('.dvx-plan-line-step');
    expect(steps.length).toBe(3);
    expect(steps[0]?.className).toContain('dvx-plan-line-step-completed');
    expect(steps[1]?.className).toContain('dvx-plan-line-step-in_progress');
    expect(steps[2]?.className).toContain('dvx-plan-line-step-pending');
    // Every step leads with a circle; only completed ones carry the
    // small check inside the grey ring.
    expect(container.querySelectorAll('.dvx-plan-line-ring').length).toBe(3);
    expect(
      container.querySelectorAll('.dvx-plan-line-ring .dvx-plan-line-check')
        .length,
    ).toBe(1);
    fireEvent.click(row as Element);
    expect(body?.getAttribute('data-open')).toBe('false');
  });
});
