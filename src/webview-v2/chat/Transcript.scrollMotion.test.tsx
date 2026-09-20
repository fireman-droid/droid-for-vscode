// @vitest-environment jsdom
import { act, cleanup, fireEvent, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useTranscriptScroll } from '../../../packages/chat-ui/src/chat/useTranscriptScroll';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

function transcript(reducedMotion = false) {
  const frames = new Map<number, FrameRequestCallback>();
  const resizeCallbacks = new Set<() => void>();
  let id = 0, time = 0, height = 400, scrollHeight = 2000;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++id, callback); return id; });
  vi.stubGlobal('cancelAnimationFrame', (value: number) => frames.delete(value));
  vi.stubGlobal('matchMedia', () => ({ matches: reducedMotion, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resizeCallbacks.add(callback); }
    observe() {} disconnect() {} unobserve() {}
  });
  const wrapper = document.createElement('div'), viewport = document.createElement('div'), column = document.createElement('div');
  viewport.append(column); wrapper.append(viewport); document.body.append(wrapper);
  Object.defineProperties(viewport, {
    clientHeight: { get: () => height }, scrollHeight: { get: () => scrollHeight },
  });
  viewport.scrollTo = ({ top }: ScrollToOptions) => { viewport.scrollTop = Number(top); };
  const viewportRef = { current: viewport }, columnRef = { current: column };
  const { result } = renderHook(() => useTranscriptScroll(viewportRef, columnRef, 'history', 0));
  act(() => { result.current.stopFollowing(); viewport.scrollTop = 100; fireEvent.scroll(viewport); });
  return {
    viewport, result, frames,
    frame: () => act(() => {
      const pending = [...frames.values()]; frames.clear(); time += 16;
      pending.forEach((callback) => callback(time));
    }),
    resize: (nextHeight: number, nextScrollHeight = scrollHeight) => act(() => {
      height = nextHeight; scrollHeight = nextScrollHeight;
      resizeCallbacks.forEach((callback) => callback());
    }),
  };
}

it('animates a requested return to bottom through viewport and content size changes', () => {
  const chat = transcript();
  act(() => chat.result.current.scrollToBottom());
  expect(chat.viewport.scrollTop).toBe(100);
  chat.frame();
  const first = chat.viewport.scrollTop;
  expect(first).toBeGreaterThan(100);
  expect(first).toBeLessThan(1600);
  chat.resize(450, 2200);
  expect(chat.viewport.scrollTop).toBe(first);
  chat.frame();
  expect(chat.viewport.scrollTop).toBeGreaterThan(first);
  expect(chat.viewport.scrollTop).toBeLessThan(1750);
  for (let index = 0; index < 100 && chat.frames.size; index += 1) chat.frame();
  expect(Math.abs(chat.viewport.scrollTop - 1750)).toBeLessThanOrEqual(1);
  expect(chat.frames.size).toBe(0);
  chat.resize(500);
  expect(chat.viewport.scrollTop).toBe(1700);
});

it('lets an upward wheel cancel a return to bottom even when later content grows', () => {
  const chat = transcript();
  act(() => chat.result.current.scrollToBottom());
  chat.frame();
  fireEvent.wheel(chat.viewport, { deltaY: -120 });
  const stopped = chat.viewport.scrollTop;
  chat.resize(400, 2400);
  chat.frame();
  expect(chat.viewport.scrollTop).toBe(stopped);
  expect(chat.result.current.follow.current.following).toBe(false);
  expect(chat.frames.size).toBe(0);
});

it('honors reduced motion when returning to the latest reply', () => {
  const chat = transcript(true);
  act(() => chat.result.current.scrollToBottom());
  chat.frame();
  expect(chat.viewport.scrollTop).toBe(1600);
});
