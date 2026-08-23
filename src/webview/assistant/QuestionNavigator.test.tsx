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
  projectQuestionItems,
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
    expect(findActiveQuestionIndex([20, 240, 900], 700, 700)).toBe(2);
  });

  it("normalizes and bounds hover previews", () => {
    expect(questionPreview("  Why\n now?  ", 0)).toBe("Why now?");
    expect(questionPreview(" ", 2)).toBe("Question 3");
    expect(questionPreview("x".repeat(240), 0)).toHaveLength(180);
  });

  it("projects question markers from runtime user messages", () => {
    expect(
      projectQuestionItems([
        {
          id: "assistant-0",
          role: "assistant",
          content: [{ type: "text", text: "Hi" }],
        },
        {
          id: "user-1",
          role: "user",
          content: [{ type: "text", text: "  Why\n now?  " }],
        },
        {
          id: "user-2",
          role: "user",
          content: [{ type: "text", text: "Next" }],
        },
      ]),
    ).toEqual([
      { key: "user-1", preview: "Why now?" },
      { key: "user-2", preview: "Next" },
    ]);
  });

  it("samples the full history while retaining the active neighborhood", () => {
    const items = Array.from({ length: 40 }, (_, index) => ({
      key: `question-${index}`,
      preview: `Question ${index}`,
    }));
    const visible = visibleQuestionItems(items, 20);
    expect(visible).toHaveLength(21);
    expect(visible[0]?.index).toBe(0);
    expect(visible.at(-1)?.index).toBe(39);
    expect(visible.map(({ index }) => index)).toEqual(
      expect.arrayContaining([19, 20, 21]),
    );
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

  it("spaces every rendered question tick evenly", () => {
    render(
      <QuestionNavigator
        visible
        items={items}
        activeIndex={1}
        onNavigate={() => undefined}
      />,
    );
    const positions = items.map(({ preview }) =>
      screen
        .getByRole("button", { name: new RegExp(preview) })
        .style.getPropertyValue("--dvx-question-position"),
    );
    expect(positions).toEqual(["0", "0.5", "1"]);
  });
});
