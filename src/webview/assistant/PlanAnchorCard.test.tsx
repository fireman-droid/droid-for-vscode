// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { PlanAnchorState } from './planAnchor';
import { PlanAnchorCard } from './PlanAnchorCard';

function makeAnchor(overrides: Partial<PlanAnchorState> = {}): PlanAnchorState {
  return {
    anchorToolUseId: 'use-1',
    title: 'Read the config',
    summary: 'Wire the selector',
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

function doneAnchor(): PlanAnchorState {
  return makeAnchor({
    summary: '3 steps',
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

afterEach(cleanup);

describe('PlanAnchorCard', () => {
  it('renders the eyebrow, title, summary and count collapsed', () => {
    const { container } = render(
      <PlanAnchorCard anchor={makeAnchor()} running={false} />,
    );
    expect(
      container.querySelector('.dvx-plan-anchor-eyebrow')?.textContent,
    ).toBe('Created Plan');
    expect(container.querySelector('.dvx-plan-anchor-title')?.textContent).toBe(
      'Read the config',
    );
    expect(
      container.querySelector('.dvx-plan-anchor-summary')?.textContent,
    ).toBe('Wire the selector');
    expect(
      container.querySelector('.dvx-plan-anchor-status')?.textContent,
    ).toBe('1/3');
    expect(
      container
        .querySelector('.dvx-plan-anchor-body')
        ?.getAttribute('data-open'),
    ).toBe('false');
  });

  it('shows the warm Building state while the turn runs', () => {
    const { container } = render(
      <PlanAnchorCard anchor={makeAnchor()} running />,
    );
    const status = container.querySelector('.dvx-plan-anchor-status');
    expect(status?.className).toContain('dvx-plan-anchor-status-building');
    expect(status?.textContent).toBe('Building… 1/3');
  });

  it('settles into a quiet Completed state', () => {
    const { container } = render(
      <PlanAnchorCard anchor={doneAnchor()} running={false} />,
    );
    const status = container.querySelector('.dvx-plan-anchor-status');
    expect(status?.className).not.toContain('dvx-plan-anchor-status-building');
    expect(status?.textContent).toBe('Completed 3/3');
    expect(container.querySelector('.dvx-plan-anchor')?.className).toContain(
      'dvx-plan-anchor-done',
    );
  });

  it('never shows Building for a finished plan even while running', () => {
    const { container } = render(<PlanAnchorCard anchor={doneAnchor()} running />);
    expect(
      container.querySelector('.dvx-plan-anchor-status')?.textContent,
    ).toBe('Completed 3/3');
  });

  it('expands the checklist from View Plan and collapses again', () => {
    const { container } = render(
      <PlanAnchorCard anchor={makeAnchor()} running={false} />,
    );
    const view = container.querySelector('.dvx-plan-anchor-view');
    expect(view).not.toBeNull();
    fireEvent.click(view as Element);
    expect((view as Element).textContent).toBe('Hide Plan');
    expect((view as Element).getAttribute('aria-expanded')).toBe('true');
    const body = container.querySelector('.dvx-plan-anchor-body');
    expect(body?.getAttribute('data-open')).toBe('true');
    const steps = container.querySelectorAll('.dvx-plan-anchor-step');
    expect(steps.length).toBe(3);
    expect(steps[0]?.className).toContain('dvx-plan-anchor-step-completed');
    expect(steps[1]?.className).toContain('dvx-plan-anchor-step-in_progress');
    expect(steps[2]?.className).toContain('dvx-plan-anchor-step-pending');
    expect(
      container.querySelectorAll('.dvx-plan-anchor-step .dvx-plan-anchor-check')
        .length,
    ).toBe(1);
    fireEvent.click(view as Element);
    expect(body?.getAttribute('data-open')).toBe('false');
  });

  it('also toggles the checklist from the status control', () => {
    const { container } = render(
      <PlanAnchorCard anchor={makeAnchor()} running />,
    );
    const status = container.querySelector('.dvx-plan-anchor-status');
    fireEvent.click(status as Element);
    expect(
      container
        .querySelector('.dvx-plan-anchor-body')
        ?.getAttribute('data-open'),
    ).toBe('true');
    expect((status as Element).getAttribute('aria-expanded')).toBe('true');
  });
});
