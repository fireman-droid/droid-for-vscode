/** Entry tolerance for a user message reaching the sticky top edge. */
const PIN_ENTER_PX = 1;
/** Keeps the current owner stable across fractional layout jitter. */
const PIN_RETAIN_PX = 3;
/** Prevents the 6→3 line clamp from toggling at the sticky boundary. */
const COMPACT_RELEASE_PX = 48;

/**
 * Index of the user message currently pinned to the viewport top.
 * A previous owner is retained through a small subpixel deadband so
 * adjacent sticky rows cannot trade ownership every animation frame.
 */
export function computePinnedUserIndex(
  tops: readonly number[],
  viewportTop: number,
  previousPinnedIndex = -1,
): number {
  let pinned = -1;
  tops.forEach((top, index) => {
    if (top <= viewportTop + PIN_ENTER_PX) {
      pinned = index;
    }
  });
  if (
    previousPinnedIndex >= 0 &&
    pinned < previousPinnedIndex &&
    (tops[previousPinnedIndex] ?? Number.POSITIVE_INFINITY) <= viewportTop + PIN_RETAIN_PX
  ) {
    return previousPinnedIndex;
  }
  return pinned;
}

/**
 * The compact question header enters with the sticky state but exits
 * only after moving clearly below it. Its height therefore stays
 * stable while the browser settles a hand-off near the top edge.
 */
export function shouldCompactStickyUser(
  compact: boolean,
  top: number,
  viewportTop: number,
): boolean {
  return top <= viewportTop + (compact ? COMPACT_RELEASE_PX : PIN_ENTER_PX);
}

/** Sticky pin/cover/push-out decisions for one coordinator frame. */
export interface StickyLayout {
  readonly pinnedIndex: number;
  /** Older stuck messages fully hidden behind the pinned one. */
  readonly covered: readonly boolean[];
  /** Pixels the next user message pushes the current owner upward. */
  readonly pushPx: number;
}

export function computeStickyLayout(
  tops: readonly number[],
  heights: readonly number[],
  viewportTop: number,
  editingIndex = -1,
  previousPinnedIndex = -1,
): StickyLayout {
  const pinnedIndex = computePinnedUserIndex(tops, viewportTop, previousPinnedIndex);
  if (editingIndex !== -1 && pinnedIndex >= editingIndex) {
    return {
      pinnedIndex: editingIndex,
      covered: tops.map(
        (top, index) => index !== editingIndex && top <= viewportTop + PIN_ENTER_PX,
      ),
      pushPx: 0,
    };
  }
  const covered = tops.map(
    (top, index) => index < pinnedIndex && top <= viewportTop + PIN_ENTER_PX,
  );
  let pushPx = 0;
  if (pinnedIndex !== -1) {
    const nextTop = tops[pinnedIndex + 1];
    const height = heights[pinnedIndex] ?? 0;
    if (nextTop !== undefined) {
      pushPx = Math.min(
        Math.max(0, viewportTop + height - Math.max(nextTop, viewportTop)),
        height,
      );
    }
  }
  return { pinnedIndex, covered, pushPx };
}

/** Distance from bottom after which the jump control appears. */
export const SCROLL_BOTTOM_SHOW_PX = 48;
