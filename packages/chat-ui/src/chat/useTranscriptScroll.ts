import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import {
  applyFollowScroll,
  applyFollowWheelIntent,
  createFollowState,
  FOLLOW_REJOIN_PX,
} from '../navigation/followScroll';
import { hasTranscriptSelection, readTranscriptSelection } from './transcriptSelection';
import { isNestedScrollTarget } from '../navigation/nestedScroll';

export function useTranscriptScroll(
  viewport: RefObject<HTMLDivElement | null>,
  content: RefObject<HTMLDivElement | null>,
  conversationId: string | null,
  _sendSignal: number,
  reportLayout?: (detail: string) => void,
  onReachedBottom?: () => void,
  pauseAutoFollow = false,
  syncRunway?: () => number,
) {
  const follow = useRef(createFollowState());
  const userScrolling = useRef(false);
  const wheelReleased = useRef(false);
  const [away, setAway] = useState(false);
  const [followingBottom, setFollowingBottom] = useState(false);
  const navigation = useRef<(() => number | undefined) | null>(null);
  const navigationTop = useRef<number | null>(null);
  const bottomNavigation = useRef(false);
  const sendBehavior = useRef<ScrollBehavior | null>(null);
  const sendMotion = useRef<{ from: number; started: number | null } | null>(null);
  const settlingSend = useRef(false);
  const frame = useRef<number | null>(null);
  const lastFrame = useRef(0);
  const scheduleUpdate = useRef<() => void>(() => {});
  const cancelAnimation = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    lastFrame.current = 0;
    navigation.current = null;
    navigationTop.current = null;
    bottomNavigation.current = false;
    sendBehavior.current = null;
    sendMotion.current = null;
    settlingSend.current = false;
  }, []);
  const stopFollowing = useCallback(() => {
    cancelAnimation();
    follow.current.following = false;
    setFollowingBottom(false);
    follow.current.pendingProgrammaticTop = null;
    userScrolling.current = false;
    wheelReleased.current = false;
  }, [cancelAnimation]);
  // Floating controls are siblings of the viewport, so native scroll chaining
  // cannot reach it. Keep the non-passive listener on those overlays only.
  const wheelOverlayRef = useCallback((overlay: HTMLElement | null) => {
    if (overlay === null) return;
    const onWheel = (event: WheelEvent) => {
      const element = viewport.current;
      if (element === null || event.defaultPrevented || !event.cancelable || event.ctrlKey || event.shiftKey || event.deltaY === 0 ||
        isNestedScrollTarget(overlay, event.target, event.deltaY)) return;
      event.preventDefault();
      const unit = event.deltaMode === 1 ? parseFloat(getComputedStyle(element).lineHeight) || 20
        : event.deltaMode === 2 ? element.clientHeight : 1;
      element.scrollBy({ top: event.deltaY * unit, behavior: 'instant' });
    };
    overlay.addEventListener('wheel', onWheel, { passive: false });
    return () => overlay.removeEventListener('wheel', onWheel);
  }, [viewport]);
  const scrollToTarget = useCallback((readTarget: () => number | undefined) => {
    stopFollowing();
    navigation.current = readTarget;
    scheduleUpdate.current();
  }, [stopFollowing]);
  const writeTop = useCallback((top: number, behavior: ScrollBehavior = 'auto') => {
    if (behavior === 'smooth') {
      scrollToTarget(() => top);
      return;
    }
    const element = viewport.current;
    if (element === null || element.clientHeight === 0) return;
    const bounded = Math.max(0, Math.min(top, element.scrollHeight - element.clientHeight));
    userScrolling.current = false;
    element.scrollTo({ top: bounded, behavior: 'instant' });
    follow.current.pendingProgrammaticTop = element.scrollTop;
  }, [viewport, scrollToTarget]);
  const compensateNavigation = useCallback(() => {
    const element = viewport.current;
    const target = navigation.current?.();
    if (element === null || target === undefined) return;
    const bounded = Math.max(0, Math.min(target, element.scrollHeight - element.clientHeight));
    const previous = navigationTop.current;
    navigationTop.current = bounded;
    // Row measurements move the coordinate system, not the requested motion.
    // Apply their delta with the layout instead of easing back to a moved target.
    if (previous !== null && bounded !== previous) writeTop(element.scrollTop + bounded - previous);
  }, [viewport, writeTop]);
  useLayoutEffect(() => { compensateNavigation(); });
  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth', sending = false) => {
    const motion = sending ? sendMotion.current ?? { from: viewport.current?.scrollTop ?? 0, started: null } : null;
    cancelAnimation();
    sendMotion.current = motion;
    sendBehavior.current = motion === null ? null : 'smooth';
    syncRunway?.();
    const element = viewport.current;
    readTranscriptSelection(element?.parentElement ?? null)?.removeAllRanges();
    follow.current.following = true;
    bottomNavigation.current = behavior === 'smooth' && element !== null &&
      element.scrollHeight - element.clientHeight - element.scrollTop > FOLLOW_REJOIN_PX;
    if (element !== null && behavior !== 'smooth') writeTop(Math.max(0, element.scrollHeight - element.clientHeight));
    // A follow request from history is not yet a settled bottom viewport.
    // Keep trailing UI in the transcript until the navigation reaches it.
    setFollowingBottom(element !== null && !bottomNavigation.current);
    setAway(false);
    scheduleUpdate.current();
  }, [viewport, writeTop, cancelAnimation, syncRunway]);
  const prepareForSend = useCallback(() => {
    sendBehavior.current = 'smooth';
  }, []);
  const followNewQuestion = useCallback(() => {
    const animate = sendBehavior.current === 'smooth' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // A confirmed message replacing its optimistic row keeps the same clock.
    scrollToBottom(animate ? 'smooth' : 'auto', animate);
    settlingSend.current = true;
  }, [scrollToBottom]);

  useLayoutEffect(() => { scrollToBottom('auto'); }, [conversationId, scrollToBottom]);
  useLayoutEffect(() => { if (pauseAutoFollow) stopFollowing(); }, [pauseAutoFollow, stopFollowing]);
  useEffect(() => {
    const element = viewport.current;
    const column = content.current;
    if (element === null || column === null) return;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let settledFrames = 0;
    const sample = () => ({
      scrollTop: element.scrollTop,
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
    });
    const selectionRoot = element.parentElement;
    const selecting = () => hasTranscriptSelection(selectionRoot);
    const update = (time: number) => {
      frame.current = null;
      if (element.clientHeight === 0) { lastFrame.current = 0; return; }
      syncRunway?.();
      const bottom = Math.max(0, element.scrollHeight - element.clientHeight);
      if (selecting()) stopFollowing();
      const readTarget = navigation.current;
      const waitingForMarkdown = () => (readTarget !== null || settlingSend.current) && column.querySelector('[data-markdown-pending]') !== null;
      if (readTarget) compensateNavigation();
      const target = readTarget ? readTarget() : follow.current.following ? bottom : undefined;
      if (target !== undefined) {
        const bounded = Math.max(0, Math.min(target, bottom));
        const distance = bounded - element.scrollTop;
        const elapsed = lastFrame.current === 0 ? 16 : Math.min(64, Math.max(1, time - lastFrame.current));
        const blend = 1 - Math.exp(-elapsed / (readTarget ? 70 : 55));
        if (Math.abs(distance) > 1 || sendMotion.current !== null) {
          settledFrames = 0;
          const step = Math.sign(distance) * Math.min(Math.abs(distance), Math.max(1, Math.abs(distance) * blend));
          const previousTop = element.scrollTop;
          const motion = sendMotion.current;
          if (motion !== null) {
            motion.started ??= time - 16;
            const progress = reducedMotion.matches ? 1 : Math.min(1, (time - motion.started) / 200);
            writeTop(motion.from + (bounded - motion.from) * (1 - (1 - progress) ** 3));
            if (progress === 1) { sendMotion.current = null; sendBehavior.current = null; }
          } else writeTop(reducedMotion.matches || settlingSend.current ? bounded : previousTop + step);
          // Chromium can clamp/quantize scrollTop before the integer geometry
          // target is reached. A blocked write must not keep an idle RAF alive.
          if (Math.abs(element.scrollTop - previousTop) > 0.01) schedule();
          else if (!waitingForMarkdown()) { navigation.current = null; navigationTop.current = null; bottomNavigation.current = false; settlingSend.current = false; }
        } else if (waitingForMarkdown()) {
          // Worker results and incremental DOM mounts can arrive after the
          // usual three frames. Keep this target until their layout settles;
          // observers wake it, so waiting does not spin an animation loop.
          settledFrames = 0;
        } else if ((readTarget || settlingSend.current) && ++settledFrames < 3) {
          // Let newly mounted virtual rows report their final measurements.
          schedule();
        } else {
          navigation.current = null;
          navigationTop.current = null;
          bottomNavigation.current = false;
          settlingSend.current = false;
          settledFrames = 0;
        }
      } else {
        navigation.current = null;
        navigationTop.current = null;
        bottomNavigation.current = false;
        settlingSend.current = false;
        settledFrames = 0;
      }
      if (!settlingSend.current) { sendMotion.current = null; sendBehavior.current = null; }
      lastFrame.current = frame.current === null ? 0 : time;
      setFollowingBottom(follow.current.following && navigation.current === null && !bottomNavigation.current);
      setAway(!follow.current.following && bottom - element.scrollTop > FOLLOW_REJOIN_PX);
      if (navigation.current === null && bottom - element.scrollTop <= FOLLOW_REJOIN_PX)
        onReachedBottom?.();
    };
    const schedule = () => { frame.current ??= requestAnimationFrame(update); };
    scheduleUpdate.current = schedule;
    let lastScrollClientHeight = element.clientHeight;
    const onScroll = () => {
      syncRunway?.();
      const next = sample();
      const previousScrollHeight = follow.current.lastScrollHeight;
      const layoutChanged = next.clientHeight !== lastScrollClientHeight ||
        next.scrollHeight !== previousScrollHeight;
      const shrank = next.scrollHeight < previousScrollHeight;
      lastScrollClientHeight = next.clientHeight;
      const releasedByGesture = wheelReleased.current;
      wheelReleased.current = false;
      const atBottom = next.scrollHeight - next.scrollTop - next.clientHeight <= FOLLOW_REJOIN_PX;
      if (!selecting()) {
        const wasFollowing = follow.current.following;
        applyFollowScroll(follow.current, next);
        if (pauseAutoFollow || navigation.current !== null) follow.current.following = false;
        else if (releasedByGesture && !atBottom)
          follow.current.following = false;
        // Finishing replies and virtual-row adjustments are not reading intent.
        // Rejoin only during a user gesture at the current, measured bottom.
        else if ((layoutChanged && (!userScrolling.current || shrank || !atBottom)) || !userScrolling.current ||
          (!wasFollowing && !atBottom))
          follow.current.following = wasFollowing;
      }
      if (shrank) userScrolling.current = false;
      schedule();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Element &&
        (navigation.current !== null || event.pointerType === 'touch' ||
          event.target.closest('[data-transcript-selectable]') || !event.target.closest('button,input,textarea,select,a,[contenteditable="true"]'))) {
        stopFollowing();
        userScrolling.current = event.pointerType === 'touch' || event.target === element;
      }
    };
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.shiftKey || event.deltaY === 0) return;
      const boundary = event.target instanceof Node && element.contains(event.target) ? element : selectionRoot;
      if (boundary && isNestedScrollTarget(boundary, event.target, event.deltaY)) { stopFollowing(); return; }
      const wasFollowing = follow.current.following;
      cancelAnimation();
      applyFollowWheelIntent(follow.current, event.deltaY, sample());
      // Editing a question is a sustained pause, not a single wheel gesture.
      // Reaching today's bottom must not let the next streamed token take over.
      if (pauseAutoFollow) follow.current.following = false;
      setFollowingBottom(follow.current.following);
      userScrolling.current = event.deltaY > 0;
      if (wasFollowing && !follow.current.following) {
        // A gesture that left the bottom outranks the layout heuristics in
        // onScroll; otherwise one grown line re-arms the follow latch and the
        // next frame drags the reader back to the bottom.
        wheelReleased.current = true;
        schedule();
        reportLayout?.(JSON.stringify({ source: 'transcript.follow', input: 'wheel',
          deltaY: event.deltaY, following: false, ...sample() }));
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (isNestedScrollTarget(element, event.target)) { stopFollowing(); return; }
      if (event.key === 'Escape' && navigation.current !== null) { stopFollowing(); return; }
      if (event.target instanceof Element && !event.target.closest('input,textarea,select,[contenteditable="true"]') &&
        !(event.key === ' ' && event.target.closest('button,a')) &&
        ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ', 'Escape'].includes(event.key)) {
        stopFollowing();
        userScrolling.current = ['ArrowDown', 'PageDown', 'End'].includes(event.key) ||
          (event.key === ' ' && !event.shiftKey);
      }
    };
    const onScrollEnd = () => { userScrolling.current = false; };
    const onSelectionChange = () => { if (selecting()) stopFollowing(); };
    let previousHeight = element.clientHeight;
    let resizeCount = 0;
    let minHeight = previousHeight;
    let maxHeight = previousHeight;
    let diagnosticTimer: ReturnType<typeof setTimeout> | undefined;
    const observer = new ResizeObserver(() => {
      syncRunway?.();
      const height = element.clientHeight;
      // New virtual rows and the cleared composer settle together. Correct their
      // geometry before paint, then return to the usual smooth streaming follow.
      if (settlingSend.current && sendMotion.current === null && follow.current.following && !selecting()) {
        writeTop(Math.max(0, element.scrollHeight - height));
        settledFrames = 0;
      }
      if (height !== previousHeight) {
        previousHeight = height;
        resizeCount += 1;
        minHeight = Math.min(minHeight, height);
        maxHeight = Math.max(maxHeight, height);
        // Composer/window layout changes preserve the bottom immediately.
        // Only transcript growth and explicit navigation use the eased target.
        if (follow.current.following && navigation.current === null && !bottomNavigation.current && sendMotion.current === null && !selecting()) {
          writeTop(Math.max(0, element.scrollHeight - height));
        }
        if (reportLayout && diagnosticTimer === undefined) {
          diagnosticTimer = setTimeout(() => {
            diagnosticTimer = undefined;
            reportLayout(JSON.stringify({ source: 'transcript.resize', resizeCount, minHeight, maxHeight,
              ...sample(), following: follow.current.following, navigating: navigation.current !== null,
              composerFocused: document.activeElement?.hasAttribute('data-composer-input') ?? false }));
            resizeCount = 0;
            minHeight = maxHeight = element.clientHeight;
          }, 1000);
        }
      }
      schedule();
    });
    observer.observe(element);
    observer.observe(column);
    for (const child of column.children) {
      if (!child.hasAttribute('data-pin-runway')) observer.observe(child);
    }
    const pendingMarkdown = new MutationObserver(() => { if (navigation.current !== null || settlingSend.current) schedule(); });
    pendingMarkdown.observe(column, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-markdown-pending'] });
    element.addEventListener('scroll', onScroll, { passive: true });
    element.addEventListener('scrollend', onScrollEnd, { passive: true });
    selectionRoot?.addEventListener('wheel', onWheel, { passive: true, capture: true });
    selectionRoot?.addEventListener('pointerdown', onPointerDown);
    selectionRoot?.addEventListener('keydown', onKeyDown);
    document.addEventListener('selectionchange', onSelectionChange);
    reducedMotion.addEventListener('change', schedule);
    schedule();
    return () => {
      scheduleUpdate.current = () => {};
      if (diagnosticTimer !== undefined) clearTimeout(diagnosticTimer);
      observer.disconnect();
      pendingMarkdown.disconnect();
      element.removeEventListener('scroll', onScroll);
      element.removeEventListener('scrollend', onScrollEnd);
      selectionRoot?.removeEventListener('wheel', onWheel, true);
      selectionRoot?.removeEventListener('pointerdown', onPointerDown);
      selectionRoot?.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('selectionchange', onSelectionChange);
      reducedMotion.removeEventListener('change', schedule);
      cancelAnimation();
    };
  }, [viewport, content, writeTop, stopFollowing, cancelAnimation, compensateNavigation, reportLayout, onReachedBottom, pauseAutoFollow, syncRunway]);
  return { follow, followingBottom, away, navigation, sendBehavior, stopFollowing, scrollToBottom, scrollToTarget, writeTop, wheelOverlayRef, prepareForSend, followNewQuestion };
}
