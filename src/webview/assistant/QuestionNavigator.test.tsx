// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  QuestionNavigator,
  visibleQuestionItems,
} from "./QuestionNavigator";
import {
  findActiveQuestionIndex,
  isScrollableTranscript,
  questionPreview,
  scrollQuestionToTop,
} from "./useQuestionNavigation";

afterEach(cleanup);

describe("question navigation helpers", () => {
  it("shows only for real vertical overflow", () => {
    expect(isScrollableTranscript(500, 300)).toBe(true);
    expect(isScrollableTranscript(301, 300)).toBe(false);
    expect(isScrollableTranscript(300, 300)).toBe(false);
  });

  it("tracks the latest question that reached the viewport top", () => {
    expect(findActiveQuestionIndex([20, 240, 580], 0)).toBe(0);
    expect(findActiveQuestionIndex([20, 240, 580], 240)).toBe(1);
    expect(findActiveQuestionIndex([20, 240, 580], 900)).toBe(2);
  });

  it("normalizes and bounds hover previews", () => {
    expect(questionPreview("  Why\n now?  ", 0)).toBe("Why now?");
    expect(questionPreview(" ", 2)).toBe("Question 3");
    expect(questionPreview("x".repeat(240), 0)).toHaveLength(180);
  });

  it("keeps a bounded window centered on long histories", () => {
    const items = Array.from({ length: 40 }, (_, index) => ({
      key: `question-${index}`,
      preview: `Question ${index}`,
    }));
    const visible = visibleQuestionItems(items, 20);
    expect(visible).toHaveLength(13);
    expect(visible[0]?.index).toBe(14);
    expect(visible.at(-1)?.index).toBe(26);
  });

  it("top-snaps with reduced-motion support", () => {
    const scroller = document.createElement("div");
    const element = document.createElement("div");
    Object.defineProperty(element, "offsetTop", { value: 420 });
    scroller.scrollTo = vi.fn();
    scrollQuestionToTop(scroller, element, true);
    expect(scroller.scrollTo).toHaveBeenCalledWith({
      top: 420,
      behavior: "auto",
    });
  });
});

describe("QuestionNavigator", () => {
  const items = [
    { key: "one", preview: "First question" },
    { key: "two", preview: "Second question" },
    { key: "three", preview: "Third question" },
  ];

  it("stays absent until the transcript overflows", () => {
    const { container } = render(
      <QuestionNavigator
        visible={false}
        items={items}
        activeIndex={0}
        onNavigate={() => undefined}
      />,
    );
    expect(container.childElementCount).toBe(0);
  });

  it("navigates markers and adjacent questions", () => {
    const onNavigate = vi.fn();
    render(
      <QuestionNavigator
        visible
        items={items}
        activeIndex={1}
        onNavigate={onNavigate}
      />,
    );
    expect(
      screen
        .getByRole("button", { name: /Second question/ })
        .getAttribute("aria-current"),
    ).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Previous question" }));
    fireEvent.click(screen.getByRole("button", { name: /Third question/ }));
    fireEvent.click(screen.getByRole("button", { name: "Next question" }));
    expect(onNavigate.mock.calls).toEqual([["one"], ["three"], ["three"]]);
  });
});
