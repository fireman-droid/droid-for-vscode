// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  SubagentPanelContext,
  type SubagentPanelFlowValue,
} from './subagentPanelFlow';
import type { WorkingSubagent } from './subagentWorking';
import { WorkingBadge } from './WorkingBadge';

function makeRows(count: number): WorkingSubagent[] {
  return Array.from({ length: count }, (_, index) => ({
    turnId: 'turn-1',
    toolUseId: `task-${index + 1}`,
    type: 'repo-researcher',
    description: `slice ${index + 1}`,
  }));
}

afterEach(cleanup);

describe('WorkingBadge', () => {
  it('renders nothing without working subagents', () => {
    const { container } = render(
      <WorkingBadge rows={[]} />,
    );
    expect(container.querySelector('.dvx-working-badge')).toBeNull();
  });

  it('shows the live count with a spinner on the pill', () => {
    const { container } = render(
      <WorkingBadge rows={makeRows(3)} />,
    );
    const badge = container.querySelector('.dvx-working-badge');
    expect(badge?.textContent).toBe('3 Working');
    expect(badge?.querySelector('.dvx-working-spinner')).not.toBeNull();
    expect(container.querySelector('.dvx-working-popup')).toBeNull();
  });

  it('opens the popup with one row per delegation and elapsed time', () => {
    const rows: WorkingSubagent[] = [
      {
        turnId: 'turn-1',
        toolUseId: 'task-1',
        type: 'repo-researcher',
        description: '研究整体项目架构',
      },
      {
        turnId: 'turn-1',
        toolUseId: 'task-2',
        type: 'change-reviewer',
        description: '',
      },
    ];
    const { container } = render(
      <WorkingBadge rows={rows} />,
    );
    fireEvent.click(container.querySelector('.dvx-working-badge')!);
    const rendered = [
      ...container.querySelectorAll('.dvx-working-row'),
    ];
    expect(rendered).toHaveLength(2);
    expect(
      rendered[0]?.querySelector('.dvx-working-row-type')?.textContent,
    ).toBe('repo-researcher subagent');
    expect(
      rendered[0]?.querySelector('.dvx-working-row-desc')?.textContent,
    ).toBe('研究整体项目架构');
    expect(
      rendered[0]?.querySelector('.dvx-working-row-elapsed')?.textContent,
    ).toBe('0s');
    // An empty description renders no desc line instead of a blank.
    expect(rendered[1]?.querySelector('.dvx-working-row-desc')).toBeNull();
    expect(
      container.querySelector('.dvx-working-popup-title')?.textContent,
    ).toBe('2 Working');
  });

  it('ticks the elapsed label once per second while open', () => {
    vi.useFakeTimers();
    try {
      const { container } = render(
        <WorkingBadge rows={makeRows(1)} />,
      );
      fireEvent.click(container.querySelector('.dvx-working-badge')!);
      expect(
        container.querySelector('.dvx-working-row-elapsed')?.textContent,
      ).toBe('0s');
      act(() => vi.advanceTimersByTime(3_100));
      expect(
        container.querySelector('.dvx-working-row-elapsed')?.textContent,
      ).toBe('3s');
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows live activity without exposing subagent stop controls', () => {
    const onPanelToggle = vi.fn();
    const flow: SubagentPanelFlowValue = {
      activities: new Map([
        ['task-1', { action: 'Grep' }],
        ['task-2', { action: null }],
      ]),
      sheet: null,
      actions: {
        onOpenTranscript: vi.fn(),
        onRefreshTranscript: vi.fn(),
        onCloseSheet: vi.fn(),
        onPanelToggle,
      },
    };
    const { container } = render(
      <SubagentPanelContext.Provider value={flow}>
        <WorkingBadge rows={makeRows(2)} />
      </SubagentPanelContext.Provider>,
    );
    fireEvent.click(container.querySelector('.dvx-working-badge')!);
    // The open/close signal gates host-side polling.
    expect(onPanelToggle).toHaveBeenLastCalledWith(true);
    const rows = [...container.querySelectorAll('.dvx-working-row')];
    // Activity remains visible, but cancellation is deliberately absent.
    expect(
      rows[0]?.querySelector('.dvx-working-row-activity')?.textContent,
    ).toBe('Grep');
    expect(container.querySelector('.dvx-working-stop-all')).toBeNull();
    expect(container.querySelector('.dvx-working-row-stop')).toBeNull();
    expect(rows[1]?.querySelector('.dvx-working-row-activity')).toBeNull();
  });

  it('renders no stop-control placeholder without panel activity', () => {
    const { container } = render(
      <WorkingBadge rows={makeRows(1)} />,
    );
    fireEvent.click(container.querySelector('.dvx-working-badge')!);
    expect(container.querySelector('.dvx-working-popup')).not.toBeNull();
    expect(container.querySelector('.dvx-working-stop-all')).toBeNull();
    expect(container.querySelector('.dvx-working-popup-note')).toBeNull();
  });

  it('offers no per-row stop button or View entry in this slice', () => {
    const { container } = render(
      <WorkingBadge rows={makeRows(2)} />,
    );
    fireEvent.click(container.querySelector('.dvx-working-badge')!);
    const row = container.querySelector('.dvx-working-row');
    expect(row?.querySelector('button')).toBeNull();
  });

  it('disappears once every delegation settles', () => {
    const { container, rerender } = render(
      <WorkingBadge rows={makeRows(2)} />,
    );
    fireEvent.click(container.querySelector('.dvx-working-badge')!);
    expect(container.querySelector('.dvx-working-popup')).not.toBeNull();
    rerender(
      <WorkingBadge rows={[]} />,
    );
    expect(container.querySelector('.dvx-working-badge')).toBeNull();
    expect(container.querySelector('.dvx-working-popup')).toBeNull();
  });

  it('keeps a stable start time as the row set changes', () => {
    vi.useFakeTimers();
    try {
      const first = makeRows(1);
      const { container, rerender } = render(
        <WorkingBadge rows={first} />,
      );
      fireEvent.click(container.querySelector('.dvx-working-badge')!);
      act(() => vi.advanceTimersByTime(5_000));
      // A second delegation appears later; the first keeps its clock.
      rerender(
        <WorkingBadge rows={[...first, ...makeRows(2).slice(1)]} />,
      );
      act(() => vi.advanceTimersByTime(2_000));
      const elapsed = [
        ...container.querySelectorAll('.dvx-working-row-elapsed'),
      ].map((el) => el.textContent);
      expect(elapsed).toEqual(['7s', '2s']);
    } finally {
      vi.useRealTimers();
    }
  });
});
