import { useCallback, useEffect, useRef, type RefObject } from 'react';

import {
  applyFollowScroll,
  applyFollowWheelIntent,
  createFollowState,
} from './followScroll';
import { isNestedScrollTarget } from './nestedScroll';

const FOLLOW_EASE = 0.24;
const FOLLOW_SETTLED_PX = 0.5;

export interface SmoothFollowScroll<T extends HTMLElement> {
  readonly viewportRef: RefObject<T | null>;
  readonly contentRef: RefObject<HTMLDivElement | null>;
  /**
   * Schedules a descent after projected content changes. `force` is
   * reserved for an explicit navigation to a new transcript/question.
   */
  readonly followNewest: (force?: boolean) => void;
}

/**
 * Shared Cursor-style tail follow for growing side panes. Content growth
 * descends over animation frames, an intentional wheel gesture releases the
 * latch, and naturally reaching the bottom rejoins it.
 */
export function useSmoothFollowScroll<T extends HTMLElement>(): SmoothFollowScroll<T> {
  const viewportRef = useRef<T | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const followNewestRef = useRef<(force?: boolean) => void>(() => undefined);
  const followNewest = useCallback((force = false): void => {
    followNewestRef.current(force);
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (viewport === null) {
      return undefined;
    }
    const follow = createFollowState({
      scrollTop: viewport.scrollTop,
      scrollHeight: viewport.scrollHeight,
      clientHeight: viewport.clientHeight,
    });
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    let frame = 0;
    const cancelFrame = (): void => {
      if (frame !== 0) {
        window.cancelAnimationFrame(frame);
        frame = 0;
      }
    };
    const step = (): void => {
      frame = 0;
      if (!follow.following) {
        return;
      }
      const target = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
      const distance = target - viewport.scrollTop;
      if (distance <= FOLLOW_SETTLED_PX) {
        return;
      }
      const next =
        reducedMotion?.matches === true
          ? target
          : Math.min(target, viewport.scrollTop + Math.max(1, distance * FOLLOW_EASE));
      follow.pendingProgrammaticTop = next;
      viewport.scrollTop = next;
      if (next < target - FOLLOW_SETTLED_PX) {
        frame = window.requestAnimationFrame(step);
      }
    };
    const schedule = (): void => {
      if (follow.following && frame === 0) {
        frame = window.requestAnimationFrame(step);
      }
    };
    followNewestRef.current = (force = false) => {
      if (force) {
        follow.following = true;
      }
      schedule();
    };
    const onScroll = (): void => {
      const wasFollowing = follow.following;
      applyFollowScroll(follow, {
        scrollTop: viewport.scrollTop,
        scrollHeight: viewport.scrollHeight,
        clientHeight: viewport.clientHeight,
      });
      if (!wasFollowing && follow.following) {
        schedule();
      }
    };
    const onWheel = (event: WheelEvent): void => {
      if (event.ctrlKey) return;
      if (isNestedScrollTarget(viewport, event.target)) {
        follow.following = false;
        follow.pendingProgrammaticTop = null;
        cancelFrame();
        return;
      }
      const released = applyFollowWheelIntent(follow, event.deltaY, {
        scrollTop: viewport.scrollTop,
        scrollHeight: viewport.scrollHeight,
        clientHeight: viewport.clientHeight,
      });
      if (released) {
        cancelFrame();
      }
    };
    viewport.addEventListener('scroll', onScroll, { passive: true });
    viewport.addEventListener('wheel', onWheel, { passive: true });
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    observer?.observe(viewport);
    if (contentRef.current !== null) {
      observer?.observe(contentRef.current);
    }
    schedule();
    return () => {
      followNewestRef.current = () => undefined;
      viewport.removeEventListener('scroll', onScroll);
      viewport.removeEventListener('wheel', onWheel);
      observer?.disconnect();
      cancelFrame();
    };
  }, []);

  return { viewportRef, contentRef, followNewest };
}
