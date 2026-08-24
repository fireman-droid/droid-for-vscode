// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createFollowState } from "../followScroll";
import type { TranscriptVirtualizerApi } from "./buildTurns";
import { VirtualizedMessages } from "./VirtualizedMessages";

const mocks = vi.hoisted(() => ({
  scrollToIndex: vi.fn(),
}));

vi.mock("@assistant-ui/react", () => ({
  ThreadPrimitive: {
    Unstable_MessageById: () => null,
  },
  useAuiState: (
    selector: (state: {
      thread: {
        messages: readonly {
          id: string;
          role: "user" | "assistant";
        }[];
      };
    }) => unknown,
  ) =>
    selector({
      thread: {
        messages: [
          { id: "question-1", role: "user" },
          { id: "answer-1", role: "assistant" },
          { id: "question-2", role: "user" },
        ],
      },
    }),
}));

vi.mock("@tanstack/react-virtual", () => ({
  observeElementRect: vi.fn(),
  useVirtualizer: () => ({
    getTotalSize: () => 240,
    getVirtualItemForOffset: () => undefined,
    getVirtualItems: () => [],
    measureElement: vi.fn(),
    measurementsCache: [
      { start: 0, end: 120 },
      { start: 120, end: 240 },
    ],
    scrollOffset: 0,
    scrollToIndex: mocks.scrollToIndex,
  }),
}));

afterEach(() => {
  cleanup();
  mocks.scrollToIndex.mockClear();
});

describe("VirtualizedMessages question navigation", () => {
  it("uses one deterministic top-snap path and releases bottom follow", () => {
    const scroller = document.createElement("div");
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
      apiRef.current?.scrollToMessageId("question-2");
    });

    expect(mocks.scrollToIndex).toHaveBeenCalledOnce();
    expect(mocks.scrollToIndex).toHaveBeenCalledWith(1, {
      align: "start",
      behavior: "auto",
    });
    expect(followingRef.current.following).toBe(false);
    expect(followingRef.current.pendingProgrammaticTop).toBe(40);
  });
});
