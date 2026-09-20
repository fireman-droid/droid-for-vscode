// @vitest-environment jsdom
import { act, cleanup, fireEvent, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useTranscriptScroll } from '../../../packages/chat-ui/src/chat/useTranscriptScroll';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

it('waits for delayed Markdown layout without polling and lets a wheel gesture cancel the target', async () => {
  const frames = new Map<number, FrameRequestCallback>();
  let id = 0;
  let time = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++id, callback); return id; });
  vi.stubGlobal('cancelAnimationFrame', (value: number) => frames.delete(value));
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  const frame = () => act(() => {
    const pending = [...frames.values()]; frames.clear();
    pending.forEach((callback) => callback(time += 16));
  });
  const wrapper = document.createElement('div');
  const viewport = document.createElement('div');
  const column = document.createElement('div');
  const markdown = document.createElement('div');
  markdown.setAttribute('data-markdown-pending', 'true');
  column.append(markdown); viewport.append(column); wrapper.append(viewport); document.body.append(wrapper);
  Object.defineProperties(viewport, { clientHeight: { value: 400 }, scrollHeight: { value: 2000 } });
  viewport.scrollTo = ({ top }: ScrollToOptions) => { viewport.scrollTop = Number(top); };
  const viewportRef = { current: viewport }, columnRef = { current: column };
  const { result } = renderHook(() => useTranscriptScroll(viewportRef, columnRef, 'history', 0));
  let target = 200;
  act(() => result.current.scrollToTarget(() => target));
  frame(); frame(); frame();
  expect(viewport.scrollTop).toBe(200);
  expect(result.current.navigation.current).not.toBeNull();
  expect(frames.size).toBe(0);
  // The worker settles long after the original three-frame navigation window.
  target = 600;
  await act(async () => { markdown.removeAttribute('data-markdown-pending'); await Promise.resolve(); });
  frame(); frame(); frame(); frame();
  expect(viewport.scrollTop).toBe(600);
  expect(result.current.navigation.current).toBeNull();

  markdown.setAttribute('data-markdown-pending', 'true');
  target = 300;
  act(() => result.current.scrollToTarget(() => target));
  frame(); frame();
  fireEvent.wheel(viewport, { deltaY: -120 });
  expect(result.current.navigation.current).toBeNull();
  target = 900;
  await act(async () => { markdown.removeAttribute('data-markdown-pending'); await Promise.resolve(); });
  frame();
  expect(viewport.scrollTop).toBe(300);
});
