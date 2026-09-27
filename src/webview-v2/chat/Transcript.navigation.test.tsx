// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { initialAssistantWebviewState } from '../state/initialState';
import type { AssistantWebviewState } from '../state/types';
import { Transcript } from './Transcript';

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: (options: {
    getScrollElement: () => HTMLElement | null;
    scrollToFn: (offset: number, options: { behavior: ScrollBehavior }) => void;
  }) => {
    const rows = [20, 620, 720].map((start, index) => ({
      index, key: `question-${index}`, start, end: index === 0 ? 620 : start + 100, size: index === 0 ? 600 : 100, lane: 0,
    }));
    return {
      measurementsCache: rows,
      getVirtualItems: () => rows,
      getTotalSize: () => 800,
      getVirtualItemForOffset: (offset: number) => [...rows].reverse().find((row) => row.start <= offset),
      measureElement: () => {},
      scrollToIndex: (index: number) => {
        const element = options.getScrollElement()!;
        options.scrollToFn(Math.min(rows[index].start, element.scrollHeight - element.clientHeight), { behavior: 'auto' });
      },
    };
  },
}));

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('clamps late questions to the real content boundary and pins questions as they enter the viewport', async () => {
  // JSDOM has no media-query API; the production scrolling hook observes this
  // browser preference even when the test controls viewport geometry itself.
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  const isViewport = (element: HTMLElement) => element.getAttribute('aria-label') === 'Chat transcript';
  let viewportHeight = 400;
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) { return isViewport(this) ? viewportHeight : 0; });
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) { return Number.parseFloat(this.style.height) || 0; });
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return isViewport(this) ? 860 : 0;
  });
  const scrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTo');
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
    configurable: true,
    value(this: HTMLElement, { top }: ScrollToOptions) {
      this.scrollTop = Math.max(0, Math.min(top ?? 0, this.scrollHeight - this.clientHeight));
      this.dispatchEvent(new Event('scroll'));
    },
  });
  try {
    const state: AssistantWebviewState = {
      ...initialAssistantWebviewState, sessionId: 'session', conversationId: 'conversation', connection: { status: 'connected' },
      transcript: [0, 1, 2].flatMap((index) => [
        { kind: 'user' as const, id: `question-${index}`, messageId: `message-${index}`, text: `Question ${index + 1}` },
        { kind: 'assistant' as const, id: `answer-${index}`, turnId: `turn-${index}`, text: `Answer ${index + 1}` },
      ]),
    };
    const view = render(<Transcript state={state} port={{ postMessage: vi.fn() }} blocked={false} sendSignal={0} onFork={undefined} />);
    const viewport = screen.getByLabelText('Chat transcript');
    await waitFor(() => expect(viewport.scrollTop).toBe(460));
    expect(screen.getByRole('button', { name: 'Jump to question 1: Question 1' }).getAttribute('aria-current')).toBe('true');
    for (const index of [1, 2, 0]) {
      fireEvent.click(screen.getByRole('button', { name: `Jump to question ${index + 1}: Question ${index + 1}` }));
      await waitFor(() => {
        expect(viewport.scrollTop).toBe([8, 460, 460][index]);
        expect(view.container.querySelector('[data-pinned-question]')?.getAttribute('data-pinned-question')).toBe('question-0');
        expect(screen.getByRole('button', { name: 'Jump to question 1: Question 1' }).getAttribute('aria-current')).toBe('true');
      });
    }
    // With enough actual scroll range, later questions reach the 12px pin gap.
    viewportHeight = 100;
    fireEvent.scroll(viewport);
    for (const index of [1, 2]) {
      fireEvent.click(screen.getByRole('button', { name: `Jump to question ${index + 1}: Question ${index + 1}` }));
      await waitFor(() => {
        expect(viewport.scrollTop).toBe([8, 608, 708][index]);
        expect(view.container.querySelector('[data-pinned-question]')?.getAttribute('data-pinned-question')).toBe(`question-${index}`);
        expect(screen.getByRole('button', { name: `Jump to question ${index + 1}: Question ${index + 1}` }).getAttribute('aria-current')).toBe('true');
      });
    }
    for (const [top, question] of [[606, 'question-0'], [607, 'question-1']] as const) {
      act(() => viewport.scrollTo({ top }));
      await waitFor(() => expect(view.container.querySelector('[data-pinned-question]')?.getAttribute('data-pinned-question')).toBe(question));
    }
    fireEvent.click(screen.getByRole('button', { name: 'Scroll to bottom' }));
    await act(async () => { await new Promise((resolve) => requestAnimationFrame(resolve)); });
    expect(viewport.scrollTop).toBe(760);
  } finally {
    if (scrollTo) Object.defineProperty(HTMLElement.prototype, 'scrollTo', scrollTo);
    else Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo');
  }
});
