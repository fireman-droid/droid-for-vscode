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
  messageRunning: true,
  messageId: 0,
}));

vi.mock('@assistant-ui/react', () => ({
  useAuiState: (
    selector: (state: {
      message: {
        id: string;
        parts: Array<Record<string, unknown>>;
        status: { type: string };
      };
    }) => unknown,
  ) =>
    selector({
      message: {
        id: `message-${aui.messageId}`,
        parts: aui.parts,
        status: { type: aui.messageRunning ? 'running' : 'complete' },
      },
    }),
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
  aui.messageRunning = true;
  aui.messageId += 1;
});

const members = [
  <div key="m0" data-member="0"><button type="button">member 0</button></div>,
  <div key="m1" data-member="1"><button type="button">member 1</button></div>,
  <div key="m2" data-member="2"><button type="button">member 2</button></div>,
  <div key="m3" data-member="3"><button type="button">member 3</button></div>,
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

function activityGroup(
  indices: readonly number[] = [0, 1, 2],
): React.JSX.Element {
  return (
    <ActivityGroup indices={indices}>
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

function finishGroupTicker(container: HTMLElement): void {
  const track = container.querySelector('.dvx-ticker-track');
  if (!(track instanceof HTMLElement)) {
    throw new Error('ticker track not mounted');
  }
  fireEvent.transitionEnd(track, { propertyName: 'transform' });
  fireEvent.transitionEnd(track, { propertyName: 'transform' });
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

  it('mounts at the current member without replaying earlier rows', () => {
    const { container } = render(
      <ActivityTicker activeIndex={2}>{members}</ActivityTicker>,
    );
    expect(readState(container)).toMatchObject({
      rows: ['2'],
      actives: [true],
      sliding: false,
      offset: '',
    });
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

  it('holds the next sequential row when the source advances mid-slide', () => {
    vi.useFakeTimers();
    const { container, rerender } = render(
      <ActivityTicker activeIndex={0}>{members}</ActivityTicker>,
    );
    rerender(<ActivityTicker activeIndex={1}>{members}</ActivityTicker>);
    rerender(<ActivityTicker activeIndex={2}>{members}</ActivityTicker>);
    expect(readState(container)).toMatchObject({
      rows: ['0', '1'],
      actives: [false, true],
      sliding: true,
      offset: '1',
    });
  });

  it('plays every intermediate row before settling on a burst target', () => {
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
      rows: ['1', '2'],
      actives: [false, true],
      sliding: true,
      offset: '1',
    });
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

  it('does not rewind when a later source snapshot points backward', () => {
    vi.useFakeTimers();
    const { container, rerender } = render(
      <ActivityTicker activeIndex={0}>{members}</ActivityTicker>,
    );
    rerender(<ActivityTicker activeIndex={1}>{members}</ActivityTicker>);
    rerender(<ActivityTicker activeIndex={0}>{members}</ActivityTicker>);
    expect(readState(container)).toMatchObject({
      rows: ['0', '1'],
      actives: [false, true],
      offset: '1',
    });
  });
});

describe('ToolActivityRow', () => {
  it('shows the bounded input-derived target beside the action', () => {
    const { container } = render(
      <ToolActivityRow
        toolName="Grep"
        activity={{
          turnId: null,
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
  it('resumes a remounted running group at its current member', () => {
    vi.useFakeTimers();
    aui.parts = groupParts(true);
    const first = render(activityGroup());
    const track = first.container.querySelector('.dvx-ticker-track');
    if (!(track instanceof HTMLElement)) {
      throw new Error('ticker track not mounted');
    }
    fireEvent.transitionEnd(track, { propertyName: 'transform' });
    first.unmount();

    const resumed = render(activityGroup());
    expect(readState(resumed.container)).toMatchObject({
      rows: ['2'],
      actives: [true],
      sliding: false,
      offset: '',
    });
  });

  it('resumes when the running group gained members while unmounted', () => {
    vi.useFakeTimers();
    aui.parts = groupParts(true);
    const first = render(activityGroup());
    first.unmount();

    aui.parts = [...groupParts(false), toolPart('Grep', 'running')];
    const resumed = render(activityGroup([0, 1, 2, 3]));
    expect(readState(resumed.container)).toMatchObject({
      rows: ['3'],
      actives: [true],
      sliding: false,
      offset: '',
    });
  });

  it('keeps the running view until every burst member has been shown', () => {
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
    aui.messageRunning = false;
    rerender(activityGroup());
    expect(
      container
        .querySelector('.dvx-activity-group')
        ?.classList.contains('dvx-activity-group-running'),
    ).toBe(true);
    finishGroupTicker(container);
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
    aui.messageRunning = false;
    rerender(activityGroup());
    finishGroupTicker(container);

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
    aui.messageRunning = false;
    rerender(activityGroup());
    finishGroupTicker(container);
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
    aui.messageRunning = false;
    rerender(activityGroup());
    finishGroupTicker(container);
    expect(
      container
        .querySelector('.dvx-activity-group')
        ?.classList.contains('dvx-activity-group-settling'),
    ).toBe(true);

    aui.parts = groupParts(true);
    aui.messageRunning = true;
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
    aui.messageRunning = false;
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

  it('opens complete interactive details while exploration is still running', () => {
    aui.parts = groupParts(true);
    const children = [
      <div key="read">Read app.ts</div>,
      <details key="thinking">
        <summary>Thinking</summary>
        <p>Inspect the imports next.</p>
      </details>,
      <div key="grep">Grep imports</div>,
    ];
    const { container } = render(
      <ActivityGroup indices={[0, 1, 2]}>
        <>{children}</>
      </ActivityGroup>,
    );
    const header = container.querySelector('.dvx-activity-group-header');
    const details = container.querySelector('.dvx-activity-group-details');
    if (!(header instanceof HTMLElement)) {
      throw new Error('running group header not mounted');
    }
    expect(header.getAttribute('aria-expanded')).toBe('false');
    expect(details?.hasAttribute('inert')).toBe(true);

    fireEvent.click(header);
    expect(header.getAttribute('aria-expanded')).toBe('true');
    expect(details?.hasAttribute('inert')).toBe(false);
    expect(details?.textContent).toContain('Thinking');
    expect(details?.textContent).toContain('Inspect the imports next.');
  });
});
