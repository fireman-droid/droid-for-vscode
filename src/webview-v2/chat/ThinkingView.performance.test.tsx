// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ThinkingBody } from '../../../packages/chat-ui/src/chat/ThinkingBody';
import { ThinkingView } from '../../../packages/chat-ui/src/chat/ThinkingView';

const longText = ('Review the current code.\n\n**Keep this exact text**: 中文🙂\n').repeat(700);
const visibleLongText = longText.replaceAll('**', '');

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

function textContent(container: HTMLElement) {
  return container.querySelector('[data-radix-scroll-area-viewport] > div > div');
}

it('separates adjacent short headings, removes repeated headings and keeps chunk-boundary emphasis intact', () => {
  const view = render(<ThinkingBody text="**Planning****Planning****Verify results**" running={false} truncated={false} />);
  expect(textContent(view.container)?.textContent).toBe('Planning\nVerify results');
  const prefix = 'x'.repeat(4093);
  view.rerender(<ThinkingBody text={`${prefix}**Read the full file** tail`} running={false} truncated={false} />);
  expect(textContent(view.container)?.textContent).toBe(`${prefix}Read the full file tail`);
  expect(screen.getByText('Read the full file').tagName).toBe('STRONG');
  view.rerender(<ThinkingBody text={`${prefix}**Pending`} running truncated={false} />);
  view.rerender(<ThinkingBody text={`${prefix}**Pending heading**`} running={false} truncated={false} />);
  expect(textContent(view.container)?.textContent).toBe(`${prefix}Pending heading`);
});

it('mounts the complete long thinking only when opened and removes it when collapsed', () => {
  const view = render(<ThinkingView text={longText} status="active" />);
  expect(textContent(view.container)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /Thinking/ }));
  expect(textContent(view.container)?.textContent).toBe(visibleLongText);
  fireEvent.click(screen.getByRole('button', { name: /Thinking/ }));
  expect(textContent(view.container)).toBeNull();
  view.rerender(<ThinkingView text={`${longText}Additional text while closed.`} status="active" />);
  act(() => vi.advanceTimersByTime(200));
  expect(textContent(view.container)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /Thinking/ }));
  expect(textContent(view.container)?.textContent).toBe(`${visibleLongText}Additional text while closed.`);
});

it('coalesces stream updates, retains existing text nodes and flushes the complete final value', () => {
  const view = render(<ThinkingBody text={longText} running truncated={false} />);
  const firstNode = textContent(view.container)?.firstChild;
  for (const suffix of ['1', '12', '123']) {
    view.rerender(<ThinkingBody text={`${longText}${suffix}`} running truncated={false} />);
    act(() => vi.advanceTimersByTime(20));
  }
  expect(textContent(view.container)?.textContent).toBe(visibleLongText);
  act(() => vi.advanceTimersByTime(40));
  expect(textContent(view.container)?.textContent).toBe(`${visibleLongText}123`);
  expect(textContent(view.container)?.firstChild).toBe(firstNode);
  view.rerender(<ThinkingBody text={`${longText}123 final🙂`} running={false} truncated={false} />);
  expect(textContent(view.container)?.textContent).toBe(`${visibleLongText}123 final🙂`);
  view.rerender(<ThinkingBody text="A different reasoning segment." running truncated={false} />);
  expect(textContent(view.container)?.textContent).toBe('A different reasoning segment.');
});

it('pauses when reading upwards and follows appended text again after scrolling back to the bottom', () => {
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0, height = 1_000;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame; });
  vi.stubGlobal('cancelAnimationFrame', (frame: number) => frames.delete(frame));
  const frame = () => act(() => {
    const callbacks = [...frames.values()]; frames.clear();
    callbacks.forEach((callback) => callback(0));
  });
  const view = render(<ThinkingBody text={longText} running truncated={false} />);
  const viewport = view.container.querySelector<HTMLElement>('[data-radix-scroll-area-viewport]')!;
  Object.defineProperties(viewport, {
    scrollHeight: { get: () => height }, clientHeight: { get: () => 256 },
  });
  frame();
  fireEvent.scroll(viewport);
  expect(viewport.scrollTop).toBe(744);
  // A wheel can rejoin within the bottom tolerance without a native scroll
  // event (for example after a fractional scrollbar position).
  fireEvent.wheel(viewport, { deltaY: -1 });
  viewport.scrollTop = 742;
  fireEvent.wheel(viewport, { deltaY: 1 });
  frame();
  expect(viewport.scrollTop).toBe(744);
  fireEvent.scroll(viewport);
  fireEvent.wheel(viewport, { deltaY: -100 });
  viewport.scrollTop = 500;
  fireEvent.scroll(viewport);
  height = 1_100;
  view.rerender(<ThinkingBody text={`${longText} More.`} running truncated={false} />);
  act(() => vi.advanceTimersByTime(100));
  frame();
  expect(viewport.scrollTop).toBe(500);
  viewport.scrollTop = 844;
  fireEvent.scroll(viewport);
  height = 1_200;
  view.rerender(<ThinkingBody text={`${longText} More. Latest.`} running truncated={false} />);
  act(() => vi.advanceTimersByTime(100));
  frame();
  expect(viewport.scrollTop).toBe(944);
});
