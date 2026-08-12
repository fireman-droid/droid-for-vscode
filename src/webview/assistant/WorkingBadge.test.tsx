// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
      <WorkingBadge rows={[]} turnActive={false} onStopAll={() => {}} />,
    );
    expect(container.querySelector('.dvx-working-badge')).toBeNull();
  });

  it('shows the live count with a spinner on the pill', () => {
    const { container } = render(
      <WorkingBadge
        rows={makeRows(3)}
        turnActive
        onStopAll={() => {}}
      />,
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
      <WorkingBadge rows={rows} turnActive onStopAll={() => {}} />,
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
        <WorkingBadge
          rows={makeRows(1)}
          turnActive
          onStopAll={() => {}}
        />,
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

  it('Stop All fires the existing stop channel and closes the popup', () => {
    const onStopAll = vi.fn();
    const { container } = render(
      <WorkingBadge rows={makeRows(2)} turnActive onStopAll={onStopAll} />,
    );
    fireEvent.click(container.querySelector('.dvx-working-badge')!);
    const stop = container.querySelector('.dvx-working-stop-all');
    expect(stop?.hasAttribute('disabled')).toBe(false);
    fireEvent.click(stop!);
    expect(onStopAll).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.dvx-working-popup')).toBeNull();
  });

  it('renders no stop control at all outside an active turn', () => {
    // Probed 2026-08-12: out of turn, session.interrupt() does not
    // cancel a background child. Unstoppable work gets no control —
    // not a disabled one (user decision 2026-08-12); the rows just
    // show their state.
    const { container } = render(
      <WorkingBadge
        rows={makeRows(1)}
        turnActive={false}
        onStopAll={() => {}}
      />,
    );
    fireEvent.click(container.querySelector('.dvx-working-badge')!);
    expect(container.querySelector('.dvx-working-popup')).not.toBeNull();
    expect(container.querySelector('.dvx-working-stop-all')).toBeNull();
    expect(container.querySelector('.dvx-working-popup-note')).toBeNull();
  });

  it('offers no per-row stop button or View entry in this slice', () => {
    const { container } = render(
      <WorkingBadge rows={makeRows(2)} turnActive onStopAll={() => {}} />,
    );
    fireEvent.click(container.querySelector('.dvx-working-badge')!);
    const row = container.querySelector('.dvx-working-row');
    expect(row?.querySelector('button')).toBeNull();
  });

  it('disappears once every delegation settles', () => {
    const { container, rerender } = render(
      <WorkingBadge rows={makeRows(2)} turnActive onStopAll={() => {}} />,
    );
    fireEvent.click(container.querySelector('.dvx-working-badge')!);
    expect(container.querySelector('.dvx-working-popup')).not.toBeNull();
    rerender(
      <WorkingBadge rows={[]} turnActive={false} onStopAll={() => {}} />,
    );
    expect(container.querySelector('.dvx-working-badge')).toBeNull();
    expect(container.querySelector('.dvx-working-popup')).toBeNull();
  });

  it('keeps a stable start time as the row set changes', () => {
    vi.useFakeTimers();
    try {
      const first = makeRows(1);
      const { container, rerender } = render(
        <WorkingBadge rows={first} turnActive onStopAll={() => {}} />,
      );
      fireEvent.click(container.querySelector('.dvx-working-badge')!);
      act(() => vi.advanceTimersByTime(5_000));
      // A second delegation appears later; the first keeps its clock.
      rerender(
        <WorkingBadge
          rows={[...first, ...makeRows(2).slice(1)]}
          turnActive
          onStopAll={() => {}}
        />,
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
