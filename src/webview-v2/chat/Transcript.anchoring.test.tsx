// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Virtualizer } from '@tanstack/react-virtual';
import { afterEach, expect, it, vi } from 'vitest';
import { TranscriptView, type TranscriptMessage } from '../../../packages/chat-ui/src/chat/TranscriptView';
import { ReadOnlyTranscriptView } from '../../../packages/chat-ui/src/chat/ReadOnlyTranscriptView';

let list: Virtualizer<HTMLDivElement, Element>;
vi.mock('@tanstack/react-virtual', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-virtual')>();
  return { ...actual, useVirtualizer: (options: Parameters<typeof actual.useVirtualizer<HTMLDivElement, Element>>[0]) => {
    list = actual.useVirtualizer({ ...options,
      // Supply the browser's layout inputs; retain the real range, measurement,
      // adjustment and production scroll callbacks rather than mocking them.
      observeElementRect: (_instance, callback) => { callback({ width: 700, height: 400 }); },
      measureElement: () => 100,
    });
    return list;
  } };
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each(['chat', 'read-only'] as const)('%s retains the reading position when rows above resize while scrolling upward', (kind) => {
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(400);
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(5000);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const scroller = this.parentElement?.closest('[aria-label$="transcript"]');
    return { x: 0, y: -(scroller?.scrollTop ?? 0), top: -(scroller?.scrollTop ?? 0), bottom: -(scroller?.scrollTop ?? 0),
      left: 0, right: 700, width: 700, height: 0, toJSON() {} };
  });
  const previousScrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTo');
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true,
    value(this: HTMLElement, { top }: ScrollToOptions) { this.scrollTop = top ?? 0; },
  });
  try {
    const messages: TranscriptMessage[] = Array.from({ length: 20 }, (_, index) => ({ id: `question-${index}`, role: 'user', text: `Question ${index}` }));
    render(kind === 'chat'
      ? <TranscriptView messages={messages} conversationId="history" sessionKey="history" sendSignal={0} renderMessage={(id) => <p>{id}</p>} />
      : <ReadOnlyTranscriptView messages={messages} renderMessage={(id) => <p>{id}</p>} />);
    const viewport = screen.getByLabelText(kind === 'chat' ? 'Chat transcript' : 'Read-only session transcript');
    act(() => { viewport.scrollTop = 1800; fireEvent.scroll(viewport); });
    fireEvent.wheel(viewport, { deltaY: -100 });
    act(() => { viewport.scrollTop = 1700; fireEvent.scroll(viewport); });
    const readingOffset = () => list.measurementsCache[17]!.start - viewport.scrollTop;
    const before = readingOffset();
    // An older, previously unmeasured turn is much taller than its estimate.
    act(() => list.resizeItem(10, 700));
    expect(viewport.scrollTop).toBe(2300);
    expect(readingOffset()).toBe(before);

    // A later Markdown/remount measurement must also retain that anchor, even
    // when the user continues upward. Rows below the viewport must not pull it.
    act(() => { viewport.scrollTop -= 100; fireEvent.scroll(viewport); });
    const afterWheel = readingOffset();
    act(() => list.resizeItem(10, 724));
    expect(viewport.scrollTop).toBe(2224);
    expect(readingOffset()).toBe(afterWheel);
    act(() => list.resizeItem(19, 900));
    expect(viewport.scrollTop).toBe(2224);
    expect(readingOffset()).toBe(afterWheel);
    // At an unmeasured row's exact leading edge, expansion is beneath the
    // reader; it must not skip the beginning of that newly visible message.
    const rowTop = list.measurementsCache[8]!.start;
    act(() => { viewport.scrollTop = rowTop; fireEvent.scroll(viewport); });
    act(() => list.resizeItem(8, 400));
    expect(viewport.scrollTop).toBe(rowTop);
  } finally {
    if (previousScrollTo) Object.defineProperty(HTMLElement.prototype, 'scrollTo', previousScrollTo);
    else Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo');
  }
});
