// @vitest-environment jsdom
// ActivityTicker trail mechanics (exploration ticker fade rework):
// the outgoing row must remain mounted while it slides out, arrivals
// mid-slide must extend the trail (retarget, never reset or queue),
// and the trail must prune back to one row when the slide settles.
// The visual halves (transform + opacity actually transitioning
// together) are covered by the headless-Chrome harness
// artifacts/smoke-ticker-fade.mjs against the real dist build.
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const aui = vi.hoisted(() => ({
  parts: [] as Array<Record<string, unknown>>,
}));

vi.mock('@assistant-ui/react', () => ({
  useAuiState: (
    selector: (state: {
      message: { parts: Array<Record<string, unknown>> };
    }) => unknown,
  ) => selector({ message: { parts: aui.parts } }),
}));

import {
  ACTIVITY_SETTLE_FALLBACK_MS,
  ActivityGroup,
  ActivityTicker,
  TICKER_SLIDE_FALLBACK_MS,
  ToolActivityRow,
} from './activityRows';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  aui.parts = [];
});

const members = [
  <div key="m0" data-member="0"><button type="button">member 0</button></div>,
  <div key="m1" data-member="1"><button type="button">member 1</button></div>,
  <div key="m2" data-member="2"><button type="button">member 2</button></div>,
];

function groupParts(running: boolean): Array<Record<string, unknown>> {
  return [
    toolPart('Read'),
    toolPart('Grep'),
    toolPart('Read', running ? 'running' : 'complete'),
  ];
}

function toolPart(
  toolName: string,
  status = 'complete',
): Record<string, unknown> {
  return {
    type: 'tool-call',
    toolName,
    providerMetadata: { droidvisx: { status } },
  };
}

function activityGroup(): React.JSX.Element {
  return (
    <ActivityGroup indices={[0, 1, 2]}>
      <>{members}</>
    </ActivityGroup>
  );
}

function readState(container: HTMLElement): {
  track: HTMLElement;
  rows: readonly string[];
  actives: readonly boolean[];
  sliding: boolean;
  offset: string;
} {
  const track = container.querySelector<HTMLElement>('.dvx-ticker-track');
  if (track === null) {
    throw new Error('ticker track not mounted');
  }
  const items = [...track.querySelectorAll<HTMLElement>('.dvx-ticker-item')];
  return {
    track,
    rows: items.map(
      (item) =>
        item.querySelector<HTMLElement>('[data-member]')?.dataset[
          'member'
        ] ?? 'empty',
    ),
    actives: items.map((item) =>
      item.classList.contains('dvx-ticker-item-active'),
    ),
    sliding: track.classList.contains('dvx-ticker-slide'),
    offset: track.style.getPropertyValue('--dvx-ticker-offset'),
  };
}

describe('ActivityTicker', () => {
  it('mounts a single visible row without a slide in flight', () => {
    const { container } = render(
      <ActivityTicker activeIndex={0}>{members}</ActivityTicker>,
    );
    expect(readState(container)).toMatchObject({
      rows: ['0'],
      actives: [true],
      sliding: false,
      offset: '',
    });
    expect(
      container.querySelector('.dvx-activity-ticker')?.hasAttribute('inert'),
    ).toBe(true);
  });

  it('keeps the outgoing row mounted and marks only the incoming row active', () => {
    vi.useFakeTimers();
    const { container, rerender } = render(
      <ActivityTicker activeIndex={0}>{members}</ActivityTicker>,
    );
    rerender(<ActivityTicker activeIndex={1}>{members}</ActivityTicker>);
    expect(readState(container)).toMatchObject({
      rows: ['0', '1'],
      actives: [false, true],
      sliding: true,
      offset: '1',
    });
  });

  it('extends the trail on a mid-slide arrival instead of resetting', () => {
    vi.useFakeTimers();
    const { container, rerender } = render(
      <ActivityTicker activeIndex={0}>{members}</ActivityTicker>,
    );
    rerender(<ActivityTicker activeIndex={1}>{members}</ActivityTicker>);
    rerender(<ActivityTicker activeIndex={2}>{members}</ActivityTicker>);
    expect(readState(container)).toMatchObject({
      rows: ['0', '1', '2'],
      actives: [false, false, true],
      sliding: true,
      offset: '2',
    });
  });

  it('prunes to the newest row and clears the slide when the fallback fires', () => {
    vi.useFakeTimers();
    const { container, rerender } = render(
      <ActivityTicker activeIndex={0}>{members}</ActivityTicker>,
    );
    rerender(<ActivityTicker activeIndex={1}>{members}</ActivityTicker>);
    rerender(<ActivityTicker activeIndex={2}>{members}</ActivityTicker>);
    act(() => {
      vi.advanceTimersByTime(TICKER_SLIDE_FALLBACK_MS + 10);
    });
    expect(readState(container)).toMatchObject({
      rows: ['2'],
      actives: [true],
      sliding: false,
      offset: '',
    });
  });

  it('commits when the track transform transition ends, ignoring bubbled row events', () => {
    vi.useFakeTimers();
    const { container, rerender } = render(
      <ActivityTicker activeIndex={0}>{members}</ActivityTicker>,
    );
    rerender(<ActivityTicker activeIndex={1}>{members}</ActivityTicker>);
    const { track } = readState(container);
    const item = track.querySelector('.dvx-ticker-item');
    // A row's opacity transitionend bubbles through the track; it must
    // not commit the slide early.
    act(() => {
      item?.dispatchEvent(
        new Event('transitionend', { bubbles: true }),
      );
    });
    expect(readState(container).rows).toEqual(['0', '1']);
    act(() => {
      track.dispatchEvent(new Event('transitionend', { bubbles: true }));
    });
    expect(readState(container)).toMatchObject({
      rows: ['1'],
      actives: [true],
      sliding: false,
    });
  });

  it('renders a bounced-back member twice without key collisions', () => {
    vi.useFakeTimers();
    const { container, rerender } = render(
      <ActivityTicker activeIndex={0}>{members}</ActivityTicker>,
    );
    rerender(<ActivityTicker activeIndex={1}>{members}</ActivityTicker>);
    rerender(<ActivityTicker activeIndex={0}>{members}</ActivityTicker>);
    expect(readState(container)).toMatchObject({
      rows: ['0', '1', '0'],
      actives: [false, false, true],
      offset: '2',
    });
  });
});

describe('ToolActivityRow', () => {
  it('shows the bounded input-derived target beside the action', () => {
    const { container } = render(
      <ToolActivityRow
        toolName="Grep"
        activity={{
          action: 'Searched workspace files',
          status: 'completed',
          progressCount: 0,
          latestUpdateKind: null,
          durationMs: null,
          filePath: null,
          detailKind: null,
          detail: null,
          target: 'needle · src · **/*.ts',
          errorMessage: null,
          outputTail: null,
          background: false,
          subagent: null,
        }}
      />,
    );
    const target = container.querySelector('.dvx-tool-target');
    expect(target?.textContent).toBe('needle · src · **/*.ts');
    expect(target?.getAttribute('title')).toBe('needle · src · **/*.ts');
  });
});

describe('ActivityGroup completion transition', () => {
  it('keeps the final running view mounted while the summary enters', () => {
    vi.useFakeTimers();
    aui.parts = groupParts(true);
    const { container, rerender } = render(activityGroup());
    const summaryButton = container.querySelector(
      '.dvx-activity-group-summary',
    );
    expect(
      container.querySelector('.dvx-activity-group-running'),
    ).not.toBeNull();

    aui.parts = groupParts(false);
    rerender(activityGroup());
    expect(
      container.querySelector('.dvx-activity-group-summary'),
    ).toBe(summaryButton);
    const group = container.querySelector('.dvx-activity-group');
    expect(group?.classList.contains('dvx-activity-group-settling')).toBe(
      true,
    );
    expect(
      container.querySelector('.dvx-activity-group-running-view'),
    ).not.toBeNull();
    expect(container.textContent).toContain('Exploring');
    expect(container.textContent).toContain('Explored 2 files, 1 search');
  });

  it('commits on the group height transition instead of waiting for fallback', () => {
    vi.useFakeTimers();
    aui.parts = groupParts(true);
    const { container, rerender } = render(activityGroup());
    aui.parts = groupParts(false);
    rerender(activityGroup());

    const stage = container.querySelector('.dvx-activity-group-stage');
    if (!(stage instanceof HTMLElement)) {
      throw new Error('activity group stage not mounted');
    }
    fireEvent.transitionEnd(stage, { propertyName: 'height' });
    expect(
      container
        .querySelector('.dvx-activity-group')
        ?.classList.contains('dvx-activity-group-completed'),
    ).toBe(true);
    expect(
      container.querySelector('.dvx-activity-group-running-view'),
    ).toBeNull();
  });

  it('falls back when reduced motion or an occluded webview emits no transition event', () => {
    vi.useFakeTimers();
    aui.parts = groupParts(true);
    const { container, rerender } = render(activityGroup());
    aui.parts = groupParts(false);
    rerender(activityGroup());
    act(() => {
      vi.advanceTimersByTime(ACTIVITY_SETTLE_FALLBACK_MS + 1);
    });
    expect(
      container
        .querySelector('.dvx-activity-group')
        ?.classList.contains('dvx-activity-group-completed'),
    ).toBe(true);
  });

  it('cancels completion when activity resumes before the settle ends', () => {
    vi.useFakeTimers();
    aui.parts = groupParts(true);
    const { container, rerender } = render(activityGroup());
    aui.parts = groupParts(false);
    rerender(activityGroup());
    expect(
      container
        .querySelector('.dvx-activity-group')
        ?.classList.contains('dvx-activity-group-settling'),
    ).toBe(true);

    aui.parts = groupParts(true);
    rerender(activityGroup());
    act(() => {
      vi.advanceTimersByTime(ACTIVITY_SETTLE_FALLBACK_MS + 1);
    });
    expect(
      container
        .querySelector('.dvx-activity-group')
        ?.classList.contains('dvx-activity-group-running'),
    ).toBe(true);
  });

  it('mounts historical completed groups directly without replaying motion', () => {
    aui.parts = groupParts(false);
    const { container } = render(activityGroup());
    expect(
      container
        .querySelector('.dvx-activity-group')
        ?.classList.contains('dvx-activity-group-completed'),
    ).toBe(true);
    expect(
      container.querySelector('.dvx-activity-group-running-view'),
    ).toBeNull();
    const details = container.querySelector('.dvx-activity-group-details');
    expect(details?.hasAttribute('inert')).toBe(true);
    const summary = container.querySelector('.dvx-activity-group-summary');
    if (!(summary instanceof HTMLElement)) {
      throw new Error('activity summary not mounted');
    }
    fireEvent.click(summary);
    expect(details?.hasAttribute('inert')).toBe(false);
    expect(details?.getAttribute('aria-hidden')).toBe('false');
  });
});
