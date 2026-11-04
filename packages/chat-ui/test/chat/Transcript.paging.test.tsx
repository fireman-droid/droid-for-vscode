// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { TranscriptView, type TranscriptMessage } from '../../src/chat/TranscriptView';
import { ReadOnlyTranscriptView } from '../../src/chat/ReadOnlyTranscriptView';
import type { TranscriptPaging } from '../../src/chat/useHistoryPaging';

vi.mock('@tanstack/react-virtual', async importOriginal => {
  const actual = await importOriginal<typeof import('@tanstack/react-virtual')>();
  return { ...actual, useVirtualizer: (options: Parameters<typeof actual.useVirtualizer<HTMLDivElement, Element>>[0]) =>
    actual.useVirtualizer({ ...options, observeElementRect: (_instance, callback) => {
      callback({ width: 700, height: 400 });
    }, measureElement: () => 100 }) };
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each([
  ['chat', 0], ['read-only', 0], ['chat', -80], ['read-only', -80],
] as const)('%s preserves the reading position after a pending scroll of %s px', (kind, movement) => {
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(400);
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(5000);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function(this: HTMLElement) {
    const row = this.closest<HTMLElement>('[data-index]'), scroller = this.closest<HTMLElement>('[aria-label$="transcript"]');
    const top = row ? Number(row.dataset.index) * 100 + 20 - (scroller?.scrollTop ?? 0)
      : scroller && this !== scroller ? 20 - scroller.scrollTop : 0;
    return { x: 0, y: top, top, bottom: top + (row ? 100 : 0),
      left: 0, right: 700, width: 700, height: row ? 100 : 0, toJSON() {} };
  });
  const previous = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTo');
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true,
    value(this: HTMLElement, options: ScrollToOptions) { this.scrollTop = options.top ?? 0; } });
  try {
    const onRequest = vi.fn();
    const paging: TranscriptPaging = { version: 'history', revision: 1, hasOlder: true,
      hasNewer: false, loading: null, error: null, onRequest };
    const messages: TranscriptMessage[] = Array.from({ length: 20 }, (_, i) =>
      ({ id: `m${i + 10}`, role: 'user', text: `message ${i + 10}` }));
    const view = (items: readonly TranscriptMessage[], page = paging) => kind === 'chat'
      ? <TranscriptView messages={items} paging={page} conversationId="session" sessionKey="session" sendSignal={0}
        renderMessage={id => <p>{id}</p>} />
      : <ReadOnlyTranscriptView messages={items} paging={page} renderMessage={id => <p>{id}</p>} />;
    const mounted = render(view(messages));
    const viewport = screen.getByLabelText(kind === 'chat' ? 'Chat transcript' : 'Read-only session transcript');
    act(() => { viewport.scrollTop = 1700; fireEvent.scroll(viewport); });
    fireEvent.wheel(viewport, { deltaY: -100 });
    act(() => { viewport.scrollTop = 220; fireEvent.scroll(viewport); });
    expect(onRequest).toHaveBeenCalledExactlyOnceWith('older');
    act(() => { fireEvent.scroll(viewport); fireEvent.scroll(viewport); });
    expect(onRequest).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Show earlier messages/)).toBeNull();
    mounted.rerender(view(messages, { ...paging, loading: 'older' }));
    act(() => { viewport.scrollTop += movement; fireEvent.scroll(viewport); });
    const prepend: TranscriptMessage[] = Array.from({ length: 10 }, (_, i) =>
      ({ id: `m${i}`, role: 'user', text: `message ${i}` }));
    mounted.rerender(view([...prepend, ...messages], { ...paging, revision: 2 }));
    expect(viewport.scrollTop).toBe(1220 + movement);
    expect(onRequest).toHaveBeenCalledTimes(1);
    mounted.rerender(view([...prepend, ...messages, { id: 'live', role: 'assistant', text: 'new output' }],
      { ...paging, revision: 2 }));
    expect(viewport.scrollTop).toBe(1220 + movement);
  } finally {
    if (previous) Object.defineProperty(HTMLElement.prototype, 'scrollTo', previous);
    else Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo');
  }
});
