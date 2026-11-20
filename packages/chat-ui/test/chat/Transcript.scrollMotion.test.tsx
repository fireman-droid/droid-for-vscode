// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ChatLayout, type ChatFooterInsetStore } from '../../src/chat/ChatLayout';
import { useTranscriptScroll } from '../../src/chat/useTranscriptScroll';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

function transcript(reducedMotion = false, runway = 0) {
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
  const viewportRef = { current: viewport }, columnRef = { current: column }, syncRunway = () => runway;
  const { result, rerender } = renderHook(({ editing, conversationId, sendSignal }) =>
    useTranscriptScroll(viewportRef, columnRef, conversationId, sendSignal, undefined, undefined, editing, syncRunway),
  { initialProps: { editing: false, conversationId: 'history', sendSignal: 0 } });
  act(() => { result.current.stopFollowing(); viewport.scrollTop = 100; fireEvent.scroll(viewport); });
  return {
    viewport, result, frames, setEditing: (editing: boolean) => rerender({ editing, conversationId: 'history', sendSignal: 0 }),
    setSendSignal: (sendSignal: number) => rerender({ editing: false, conversationId: 'history', sendSignal }),
    setConversation: () => rerender({ editing: false, conversationId: 'another', sendSignal: 0 }),
    frame: () => act(() => {
      const pending = [...frames.values()]; frames.clear(); time += 16;
      pending.forEach((callback) => callback(time));
    }),
    resize: (nextHeight: number, nextScrollHeight = scrollHeight) => act(() => {
      height = nextHeight; scrollHeight = nextScrollHeight;
      resizeCallbacks.forEach((callback) => callback());
    }),
    resizeViewport: (nextHeight: number) => act(() => {
      height = nextHeight;
      viewport.scrollTop = Math.min(viewport.scrollTop, Math.max(0, scrollHeight - height));
      fireEvent.scroll(viewport);
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

it('keeps the same visible text in a growing turn without duplicating row movement', () => {
  const chat = transcript();
  const row = document.createElement('div'), paragraph = document.createElement('p'), earlier = document.createElement('p');
  row.setAttribute('data-markdown-row', '');
  paragraph.textContent = 'A visible reading position';
  earlier.textContent = 'An earlier reading position';
  row.append(earlier, paragraph);
  chat.viewport.firstElementChild!.append(row);
  const text = paragraph.firstChild as Text, earlierText = earlier.firstChild as Text;
  let visibleText = text;
  chat.viewport.style.setProperty('--pinned-mask-stop', '90px');
  let rowTop = 450, textOffset = 148;
  const rect = (top: number, height: number, width = 400) =>
    ({ top, bottom: top + height, left: 0, right: width, width, height, x: 0, y: top, toJSON() {} }) as DOMRect;
  chat.viewport.getBoundingClientRect = () => rect(0, 400);
  row.getBoundingClientRect = () => rect(rowTop - chat.viewport.scrollTop, 1000);
  const createRange = document.createRange.bind(document);
  const rangeSpy = vi.spyOn(document, 'createRange').mockImplementation(() => {
    const range = createRange();
    range.getBoundingClientRect = () => rect(rowTop + textOffset - (range.startContainer === earlierText ? 80 : 0) - chat.viewport.scrollTop, 20, 8);
    return range;
  });
  Object.defineProperty(document, 'caretRangeFromPoint', { configurable: true, value: (_x: number, y: number) => {
    if (y < 90) return null;
    const range = createRange(); range.setStart(visibleText, 2); range.collapse(true); return range;
  } });
  try {
    act(() => { chat.viewport.scrollTop = 500; fireEvent.scroll(chat.viewport); });
    textOffset += 120; // An image or tool above the line expands within this turn.
    chat.resize(400, 2120);
    expect(chat.viewport.scrollTop).toBe(620);
    chat.resize(400, 2200); // Streaming below the line does not move it.
    expect(chat.viewport.scrollTop).toBe(620);

    rowTop += 80; // The virtualizer has already compensated a preceding row.
    chat.viewport.scrollTop += 80;
    textOffset += 70;
    chat.resize(400, 2350);
    expect(chat.viewport.scrollTop).toBe(770);

    fireEvent.wheel(chat.viewport, { deltaY: -100 });
    visibleText = earlierText;
    act(() => { chat.viewport.scrollTop = 690; fireEvent.scroll(chat.viewport); });
    // The next anchor must be the user's new reading position, not the old one.
    textOffset += 40;
    chat.resize(400, 2390);
    expect(chat.viewport.scrollTop).toBe(730);

    const selection = window.getSelection()!, selected = createRange();
    selected.selectNodeContents(earlier);
    selection.addRange(selected);
    fireEvent(document, new Event('selectionchange'));
    textOffset += 30;
    chat.resize(400, 2420);
    expect(chat.viewport.scrollTop).toBe(760);
    expect(selection.toString()).toBe('An earlier reading position');

    act(() => chat.result.current.scrollToBottom('auto'));
    textOffset += 50;
    chat.resize(400, 2470);
    chat.frame();
    expect(chat.viewport.scrollTop).toBeGreaterThan(2020);
    expect(chat.viewport.scrollTop).toBeLessThanOrEqual(2070);
  } finally {
    rangeSpy.mockRestore();
    Reflect.deleteProperty(document, 'caretRangeFromPoint');
  }
});

it('honors reduced motion when returning to the latest reply', () => {
  const chat = transcript(true);
  act(() => chat.result.current.scrollToBottom());
  chat.frame();
  expect(chat.viewport.scrollTop).toBe(1600);
});

it('eases one prepared send over 200ms without restarting for confirmation or snapping on resize', () => {
  const chat = transcript();
  act(() => chat.result.current.prepareForSend());
  expect(chat.viewport.scrollTop).toBe(100);
  act(() => chat.result.current.followNewQuestion());
  expect(chat.viewport.scrollTop).toBe(100);
  chat.frame();
  expect(chat.viewport.scrollTop).toBeGreaterThan(100);
  expect(chat.viewport.scrollTop).toBeLessThan(1600);
  for (let index = 0; index < 4; index += 1) chat.frame();
  const during = chat.viewport.scrollTop;
  chat.resize(450, 2200);
  expect(chat.viewport.scrollTop).toBe(during);
  act(() => chat.result.current.followNewQuestion());
  expect(chat.viewport.scrollTop).toBe(during);
  for (let index = 0; index < 8; index += 1) chat.frame();
  expect(chat.viewport.scrollTop).toBe(1750);
  expect(chat.result.current.sendBehavior.current).toBeNull();
  for (let index = 0; index < 5; index += 1) chat.frame();
  chat.resize(450, 2400);
  expect(chat.viewport.scrollTop).toBe(1750);
  chat.frame();
  expect(chat.viewport.scrollTop).toBeGreaterThan(1750);
  expect(chat.viewport.scrollTop).toBeLessThan(1950);
});

it('does not replay sends for queue-only signals or conversation changes', () => {
  const chat = transcript();
  chat.setSendSignal(1);
  chat.frame();
  expect(chat.viewport.scrollTop).toBe(100);
  act(() => chat.result.current.followNewQuestion());
  expect(chat.viewport.scrollTop).toBe(1600);
  act(() => chat.result.current.prepareForSend());
  chat.setConversation();
  expect(chat.result.current.sendBehavior.current).toBeNull();
  expect(chat.viewport.scrollTop).toBe(1600);
});

it('places a prepared new question immediately when reduced motion is enabled', () => {
  const chat = transcript(true);
  act(() => { chat.result.current.prepareForSend(); chat.result.current.followNewQuestion(); });
  expect(chat.viewport.scrollTop).toBe(1600);
  expect(chat.result.current.sendBehavior.current).toBeNull();
});

it.each([
  ['wheel', false], ['keyboard', false], ['touch', false],
  ['wheel', true], ['keyboard', true], ['touch', true],
] as const)('cancels a send transition on %s (external overlay: %s) without resuming after layout changes', (gesture, external) => {
  const chat = transcript();
  const target = external ? document.createElement('nav') : chat.viewport;
  if (external) document.body.append(target);
  const release = external ? chat.result.current.wheelOverlayRef(target) : undefined;
  chat.viewport.scrollBy = ({ top }: ScrollToOptions) => { chat.viewport.scrollTop += Number(top); };
  act(() => { chat.result.current.prepareForSend(); chat.result.current.followNewQuestion(); });
  chat.frame();
  if (gesture === 'wheel') fireEvent.wheel(target, { deltaY: -120 });
  if (gesture === 'keyboard') fireEvent.keyDown(target, { key: 'PageUp' });
  if (gesture === 'touch') fireEvent.pointerDown(target, { pointerType: 'touch' });
  const stopped = chat.viewport.scrollTop;
  chat.resize(450, 2400);
  chat.frame();
  expect(chat.viewport.scrollTop).toBe(stopped);
  expect(chat.result.current.follow.current.following).toBe(false);
  expect(chat.result.current.sendBehavior.current).toBeNull();
  release?.();
});

it('marks the transcript as scrolled away when wheeling up during an active pin runway', () => {
  const chat = transcript(true, 360);
  act(() => chat.result.current.scrollToBottom('auto'));
  chat.frame();
  expect(chat.result.current.away).toBe(false);

  fireEvent.wheel(chat.viewport, { deltaY: -80 });
  act(() => { chat.viewport.scrollTop = 1520; fireEvent.scroll(chat.viewport); });
  chat.frame();
  expect(chat.result.current.away).toBe(true);

  act(() => chat.result.current.scrollToBottom('auto'));
  chat.frame();
  expect(chat.result.current.away).toBe(false);
});

it.each(['wheel', 'keyboard', 'touch'] as const)('keeps the chat under user control during message editing after a %s reaches bottom', (gesture) => {
  const chat = transcript(true);
  act(() => chat.result.current.scrollToBottom('auto'));
  act(() => chat.result.current.stopFollowing());
  chat.setEditing(true);
  expect(chat.result.current.follow.current.following).toBe(false);

  act(() => { chat.viewport.scrollTop = 1480; fireEvent.scroll(chat.viewport); });
  if (gesture === 'wheel') fireEvent.wheel(chat.viewport, { deltaY: 120 });
  if (gesture === 'keyboard') fireEvent.keyDown(chat.viewport, { key: 'End' });
  if (gesture === 'touch') fireEvent.pointerDown(chat.viewport, { pointerType: 'touch' });
  act(() => { chat.viewport.scrollTop = 1600; fireEvent.scroll(chat.viewport); });
  // A second wheel event at the edge used to turn following back on, too.
  if (gesture === 'wheel') fireEvent.wheel(chat.viewport, { deltaY: 120 });
  chat.resize(400, 2400);
  chat.frame();
  expect(chat.viewport.scrollTop).toBe(1600);
  expect(chat.result.current.follow.current.following).toBe(false);

  // Streaming must still leave both directions available, and closing the
  // editor must not jump away from the user's reading position.
  fireEvent.wheel(chat.viewport, { deltaY: -120 });
  act(() => { chat.viewport.scrollTop = 1480; fireEvent.scroll(chat.viewport); });
  chat.setEditing(false);
  chat.resize(400, 2600);
  chat.frame();
  expect(chat.viewport.scrollTop).toBe(1480);
  // Once editing ends, returning to the bottom deliberately resumes following.
  fireEvent.wheel(chat.viewport, { deltaY: 720 });
  act(() => { chat.viewport.scrollTop = 2200; fireEvent.scroll(chat.viewport); });
  chat.resize(400, 2800);
  chat.frame();
  expect(chat.viewport.scrollTop).toBe(2400);
});

it('keeps pushing content up consistently when footer panels collapse and re-expand at bottom', () => {
  const chat = transcript(true);
  act(() => chat.result.current.scrollToBottom('auto'));
  expect(chat.viewport.scrollTop).toBe(1600);
  // A downward wheel while already at the bottom must not leave userScrolling latched.
  fireEvent.wheel(chat.viewport, { deltaY: 120 });
  // Panel collapse grows the viewport and the browser clamps scrollTop downward before ResizeObserver runs.
  chat.resizeViewport(480);
  expect(chat.result.current.follow.current.following).toBe(true);
  expect(chat.viewport.scrollTop).toBe(1520);
  // Re-expanding the panel must immediately push the bottom content back up.
  chat.resize(400);
  expect(chat.viewport.scrollTop).toBe(1600);
  // Even after a non-wheel tap at the bottom cleared follow, expanding a panel keeps bottom content visible.
  act(() => chat.result.current.stopFollowing());
  chat.resize(340);
  expect(chat.viewport.scrollTop).toBe(1660);
  // Editing a previous message must still keep the chat under user control without pushing on shrink.
  chat.setEditing(true);
  chat.resize(280);
  expect(chat.viewport.scrollTop).toBe(1660);
});

it('pushes content up when overlapping footerInset grows without breaking scrolled-up or editing state', () => {
  const frames = new Map<number, FrameRequestCallback>();
  let id = 0, inset = 80, scrollHeight = 2000;
  const height = 400;
  const insetListeners = new Set<() => void>();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++id, callback); return id; });
  vi.stubGlobal('cancelAnimationFrame', (value: number) => frames.delete(value));
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('ResizeObserver', class {
    observe() {} disconnect() {} unobserve() {}
  });
  const footerInset: ChatFooterInsetStore = {
    getHeight: () => inset,
    subscribe: (listener) => {
      insetListeners.add(listener);
      return () => { insetListeners.delete(listener); };
    },
  };
  const viewport = document.createElement('div'), column = document.createElement('div');
  viewport.append(column); document.body.append(viewport);
  Object.defineProperties(viewport, {
    clientHeight: { get: () => height }, scrollHeight: { get: () => scrollHeight },
  });
  viewport.scrollTo = ({ top }: ScrollToOptions) => { viewport.scrollTop = Number(top); };
  const viewportRef = { current: viewport }, columnRef = { current: column };
  const { result, rerender } = renderHook(({ editing }) =>
    useTranscriptScroll(viewportRef, columnRef, 'history', 0, undefined, undefined, editing, undefined, footerInset),
  { initialProps: { editing: false } });

  const setInset = (nextInset: number) => act(() => {
    scrollHeight += nextInset - inset;
    inset = nextInset;
    for (const listener of [...insetListeners]) listener();
  });

  act(() => result.current.scrollToBottom('auto'));
  expect(viewport.scrollTop).toBe(1600);

  setInset(160);
  expect(viewport.scrollTop).toBe(1680);

  setInset(80);
  expect(result.current.follow.current.following).toBe(true);
  expect(viewport.scrollTop).toBe(1600);

  act(() => result.current.stopFollowing());
  setInset(140);
  expect(viewport.scrollTop).toBe(1660);

  act(() => { result.current.stopFollowing(); viewport.scrollTop = 500; fireEvent.scroll(viewport); });
  setInset(200);
  expect(viewport.scrollTop).toBe(500);

  act(() => result.current.scrollToBottom('auto'));
  expect(viewport.scrollTop).toBe(1720);
  rerender({ editing: true });
  setInset(260);
  expect(viewport.scrollTop).toBe(1720);
});

it('keeps content inset anchored when a subagent sheet opens inside composer panels', () => {
  const resizeCallbacks = new Set<() => void>();
  let footerHeight = 136;
  let panelsHeight = 80;
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resizeCallbacks.add(callback); }
    observe() {} disconnect() {} unobserve() {}
  });
  const rect = (height: number): DOMRect => ({
    x: 0, y: 0, top: 0, left: 0, bottom: height, right: 600, width: 600, height, toJSON() {},
  }) as DOMRect;
  const protoGetRect = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getBoundingClientRect');
  const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.tagName === 'FOOTER') return rect(footerHeight);
    if (this.classList.contains('v2-composer-panels')) return rect(panelsHeight);
    return protoGetRect?.value ? protoGetRect.value.call(this) : rect(0);
  });
  try {
    const ui = (sheetOpen: boolean) => (
      <ChatLayout
        header={<div>Header</div>}
        footer={
          <div className="v2-composer-dock">
            <div className="v2-composer-panels">
              {sheetOpen ? <section className="dvx-subagent-sheet">Subagent popup</section> : <div>Queue items</div>}
            </div>
            <div>Composer</div>
          </div>
        }
      >
        <div data-testid="chat-child">Transcript</div>
      </ChatLayout>
    );

    const view = render(ui(false));
    const body = view.container.querySelector('[data-footer-clip]') as HTMLElement;
    expect(body).toBeTruthy();
    expect(body.style.getPropertyValue('--chat-footer-height')).toBe('136px');
    expect(body.style.getPropertyValue('--chat-content-inset')).toBe('136px');

    footerHeight = 556;
    panelsHeight = 500;
    view.rerender(ui(true));
    act(() => {
      for (const cb of resizeCallbacks) cb();
    });
    expect(body.style.getPropertyValue('--chat-footer-height')).toBe('556px');
    expect(body.style.getPropertyValue('--chat-content-inset')).toBe('136px');

    footerHeight = 136;
    panelsHeight = 80;
    view.rerender(ui(false));
    act(() => {
      for (const cb of resizeCallbacks) cb();
    });
    expect(body.style.getPropertyValue('--chat-footer-height')).toBe('136px');
    expect(body.style.getPropertyValue('--chat-content-inset')).toBe('136px');
  } finally {
    rectSpy.mockRestore();
  }
});
