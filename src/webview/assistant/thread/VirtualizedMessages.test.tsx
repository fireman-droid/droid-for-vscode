// @vitest-environment jsdom

import { act, cleanup, render } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createFollowState } from './navigation/followScroll';
import { findActiveQuestionIndex } from './navigation/useQuestionNavigation';
import type { TranscriptVirtualizerApi } from './buildTurns';
import { ThreadMessageChromeContext, type ThreadMessageChrome } from './messageChrome';
import { pinnedPushOffset, VirtualizedMessages } from './VirtualizedMessages';

const mocks = vi.hoisted(() => ({
  scrollToIndex: vi.fn(),
  getVirtualItemForOffset: vi.fn(() => undefined),
  scrollToFn: null as
    | null
    | ((
        offset: number,
        options: { adjustments?: number; behavior?: ScrollBehavior },
        instance: { scrollElement: HTMLElement | null },
      ) => void),
}));

vi.mock('@assistant-ui/react', () => ({
  ThreadPrimitive: {
    Unstable_MessageById: ({ messageId }: { messageId: string }) => (
      <div className="dvx-message-user" data-message-id={messageId} />
    ),
  },
  useAuiState: (
    selector: (state: {
      thread: {
        messages: readonly {
          id: string;
          role: 'user' | 'assistant';
        }[];
      };
    }) => unknown,
  ) =>
    selector({
      thread: {
        messages: [
          { id: 'question-1', role: 'user' },
          { id: 'answer-1', role: 'assistant' },
          { id: 'question-2', role: 'user' },
        ],
      },
    }),
}));

vi.mock('@tanstack/react-virtual', () => ({
  observeElementRect: vi.fn(),
  useVirtualizer: (options: { scrollToFn: typeof mocks.scrollToFn }) => {
    mocks.scrollToFn = options.scrollToFn;
    return {
      getTotalSize: () => 240,
      getVirtualItemForOffset: mocks.getVirtualItemForOffset,
      getVirtualItems: () => [],
      measureElement: vi.fn(),
      measurementsCache: [
        { start: 0, end: 120 },
        { start: 120, end: 240 },
      ],
      scrollOffset: 0,
      scrollToIndex: mocks.scrollToIndex,
    };
  },
}));

afterEach(() => {
  cleanup();
  mocks.scrollToIndex.mockClear();
  mocks.getVirtualItemForOffset.mockReset();
  mocks.scrollToFn = null;
  vi.restoreAllMocks();
});

describe('VirtualizedMessages question navigation', () => {
  it('hands the pinned surface backward and forward by scroll position during an edit', () => {
    const scroller = document.createElement('div');
    scroller.scrollTop = 150;
    const overlay = document.createElement('div');
    document.body.append(overlay);
    mocks.getVirtualItemForOffset.mockImplementation((offset) =>
      offset < 120
        ? { start: 0, end: 120, index: 0 }
        : { start: 120, end: 240, index: 1 },
    );
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      function () {
        return {
          top: 0,
          left: 0,
          right: 400,
          bottom: 80,
          width: 400,
          height: 80,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        };
      },
    );
    const editor = {
      draft: { messageId: 'question-2', phase: 'editing', text: 'Keep my changes' },
    };
    try {
      render(
        <ThreadMessageChromeContext.Provider value={{ editor } as ThreadMessageChrome}>
          <VirtualizedMessages
            getScroller={() => scroller}
            followingRef={{ current: { following: false } }}
            floatingHost={overlay}
          />
        </ThreadMessageChromeContext.Provider>,
      );
      expect(
        overlay.querySelector('[data-message-id]')?.getAttribute('data-message-id'),
      ).toBe('question-2');
      act(() => {
        scroller.scrollTop = 100;
        scroller.dispatchEvent(new Event('scroll'));
      });
      expect(
        overlay.querySelector('[data-message-id]')?.getAttribute('data-message-id'),
      ).toBe('question-1');
      // The next question pushes even while another message has an open editor.
      expect((overlay.firstElementChild as HTMLElement).style.transform).toBe(
        'translateY(-60px)',
      );
      expect(scroller.scrollTop).toBe(100);
      act(() => {
        scroller.scrollTop = 150;
        scroller.dispatchEvent(new Event('scroll'));
      });
      expect(
        overlay.querySelector('[data-message-id]')?.getAttribute('data-message-id'),
      ).toBe('question-2');
      expect(editor.draft.text).toBe('Keep my changes');
    } finally {
      cleanup();
      overlay.remove();
    }
  });

  it('lets the next question push the pinned surface out of the viewport', () => {
    expect(pinnedPushOffset(undefined, 100, 80)).toBe(0);
    expect(pinnedPushOffset(200, 100, 80)).toBe(0);
    expect(pinnedPushOffset(160, 100, 80)).toBe(-20);
    expect(pinnedPushOffset(121, 100, 80)).toBe(-59);
  });

  it.each([
    { scrollTop: 119, lookup: 120, activeIndex: 0 },
    { scrollTop: 120, lookup: 121, activeIndex: 1 },
    { scrollTop: 121, lookup: 122, activeIndex: 1 },
  ])(
    'shares question entry at scrollTop $scrollTop',
    ({ scrollTop, lookup, activeIndex }) => {
      const scroller = document.createElement('div');
      scroller.scrollTop = scrollTop;
      mocks.getVirtualItemForOffset.mockImplementation((offset) =>
        offset < 121
          ? { start: 0, end: 121, index: 0 }
          : { start: 121, end: 240, index: 1 },
      );

      render(
        <VirtualizedMessages
          getScroller={() => scroller}
          followingRef={{ current: createFollowState() }}
        />,
      );

      expect(mocks.getVirtualItemForOffset).toHaveBeenCalledWith(lookup);
      expect(findActiveQuestionIndex([0, 121], scrollTop)).toBe(activeIndex);
    },
  );

  it('uses one deterministic top-snap path and releases bottom follow', () => {
    const scroller = document.createElement('div');
    scroller.scrollTop = 40;
    const followingRef = {
      current: createFollowState({
        scrollTop: 40,
        scrollHeight: 800,
        clientHeight: 400,
      }),
    };
    const apiRef = createRef<TranscriptVirtualizerApi | null>();

    render(
      <VirtualizedMessages
        getScroller={() => scroller}
        followingRef={followingRef}
        apiRef={apiRef}
      />,
    );

    act(() => {
      apiRef.current?.scrollToMessageId('question-2');
    });

    expect(mocks.scrollToIndex).toHaveBeenCalledOnce();
    expect(mocks.scrollToIndex).toHaveBeenCalledWith(1, {
      align: 'start',
      behavior: 'auto',
    });
    expect(followingRef.current.following).toBe(false);
    expect(followingRef.current.pendingProgrammaticTop).toBe(40);
  });

  it('lets bottom-follow own scrolling during virtual size corrections', () => {
    const scroller = document.createElement('div');
    const scrollTo = vi.fn();
    scroller.scrollTo = scrollTo;
    const followingRef = {
      current: createFollowState({
        scrollTop: 400,
        scrollHeight: 800,
        clientHeight: 400,
      }),
    };

    render(
      <VirtualizedMessages getScroller={() => scroller} followingRef={followingRef} />,
    );

    act(() => {
      mocks.scrollToFn?.(
        320,
        { adjustments: 24, behavior: 'auto' },
        { scrollElement: scroller },
      );
    });

    expect(scrollTo).not.toHaveBeenCalled();
    expect(followingRef.current.following).toBe(true);
  });
});
