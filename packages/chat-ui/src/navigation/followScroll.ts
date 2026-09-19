/** A viewport is "at bottom" within this tolerance (fractional
 * scrollTop under display scaling never lands exactly on 0). */
export const FOLLOW_REJOIN_PX = 4;

/** One viewport scroll sample fed to the follow latch. */
export interface FollowScrollSample {
  readonly scrollTop: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
}

/** Mutable stick-to-bottom latch shared by transcript surfaces. */
export interface FollowState {
  following: boolean;
  lastScrollTop: number;
  lastScrollHeight: number;
  /** scrollTop the coordinator itself just wrote; the next matching
   * scroll event is programmatic, not a user gesture. */
  pendingProgrammaticTop: number | null;
}

export function createFollowState(
  initial: FollowScrollSample = {
    scrollTop: 0,
    scrollHeight: 0,
    clientHeight: 0,
  },
): FollowState {
  return {
    following: true,
    lastScrollTop: initial.scrollTop,
    lastScrollHeight: initial.scrollHeight,
    pendingProgrammaticTop: null,
  };
}

/**
 * Applies one scroll event to the follow latch with Cursor semantics:
 * only a genuine upward user scroll releases the latch, and returning
 * to the bottom restores it. Programmatic writes and clamp events from
 * shrinking content never release it.
 */
export function applyFollowScroll(state: FollowState, sample: FollowScrollSample): void {
  const distance = sample.scrollHeight - sample.scrollTop - sample.clientHeight;
  const programmatic =
    state.pendingProgrammaticTop !== null &&
    Math.abs(sample.scrollTop - state.pendingProgrammaticTop) <= 1;
  if (programmatic) {
    state.pendingProgrammaticTop = null;
  } else {
    const shrank = sample.scrollHeight < state.lastScrollHeight;
    const scrolledUp = sample.scrollTop < state.lastScrollTop - 0.5;
    const scrolledDown = sample.scrollTop > state.lastScrollTop + 0.5;
    if (scrolledUp && !shrank) {
      state.following = false;
    }
    // A downward scroll that reaches at least the previous bottom is
    // a return-to-bottom even when streaming grew before this event.
    const previousMaxTop = state.lastScrollHeight - sample.clientHeight;
    if (scrolledDown && (
      distance <= FOLLOW_REJOIN_PX ||
      sample.scrollTop >= previousMaxTop - FOLLOW_REJOIN_PX
    )) {
      state.following = true;
    }
  }
  state.lastScrollTop = sample.scrollTop;
  state.lastScrollHeight = sample.scrollHeight;
}

/**
 * A wheel/touchpad gesture is authoritative reading intent in either
 * direction. Release before ResizeObserver can glue the viewport back
 * to the bottom; reaching bottom naturally re-enables follow later.
 */
export function applyFollowWheelIntent(
  state: FollowState,
  deltaY: number,
  sample: FollowScrollSample,
): boolean {
  if (deltaY === 0) {
    return false;
  }
  const distance = sample.scrollHeight - sample.scrollTop - sample.clientHeight;
  // Wheel intent precedes its native scroll. Do not mistake an older queued
  // programmatic scroll for a downward return after the user starts reading.
  state.lastScrollTop = sample.scrollTop;
  state.lastScrollHeight = sample.scrollHeight;
  if (deltaY > 0 && distance <= FOLLOW_REJOIN_PX) {
    state.following = true;
    return false;
  }
  state.following = false;
  state.pendingProgrammaticTop = null;
  return true;
}
