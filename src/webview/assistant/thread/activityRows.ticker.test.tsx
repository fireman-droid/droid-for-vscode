// @vitest-environment jsdom
// ActivityTicker trail mechanics (exploration ticker fade rework):
// the outgoing row must remain mounted while it slides out, arrivals
// mid-slide must extend the trail (retarget, never reset or queue),
// and the trail must prune back to one row when the slide settles.
// The visual halves (transform + opacity actually transitioning
// together) are covered by the headless-Chrome harness
// artifacts/smoke-ticker-fade.mjs against the real dist build.
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ActivityTicker,
  TICKER_SLIDE_FALLBACK_MS,
} from './activityRows';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const members = [
  <div key="m0" data-member="0" />,
  <div key="m1" data-member="1" />,
  <div key="m2" data-member="2" />,
];

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
