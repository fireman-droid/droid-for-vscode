import type { CSSProperties } from "react";

import type { QuestionNavigationItem } from "./useQuestionNavigation";

interface QuestionNavigatorProps {
  readonly visible: boolean;
  readonly items: readonly QuestionNavigationItem[];
  readonly activeIndex: number;
  readonly onNavigate: (messageId: string) => void;
}

const MAX_VISIBLE_QUESTION_NODES = 21;

export function visibleQuestionItems(
  items: readonly QuestionNavigationItem[],
  activeIndex: number,
): readonly { readonly item: QuestionNavigationItem; readonly index: number }[] {
  if (items.length <= MAX_VISIBLE_QUESTION_NODES) {
    return items.map((item, index) => ({ item, index }));
  }
  const current = Math.min(Math.max(activeIndex, 0), items.length - 1);
  const required = new Set(
    [0, items.length - 1, current - 1, current, current + 1].filter(
      (index) => index >= 0 && index < items.length,
    ),
  );
  const selected = new Set<number>();
  for (let slot = 0; slot < MAX_VISIBLE_QUESTION_NODES; slot += 1) {
    selected.add(
      Math.round(
        (slot * (items.length - 1)) /
          (MAX_VISIBLE_QUESTION_NODES - 1),
      ),
    );
  }
  required.forEach((index) => selected.add(index));
  while (selected.size > MAX_VISIBLE_QUESTION_NODES) {
    const removable = [...selected]
      .filter((index) => !required.has(index))
      .sort((left, right) => {
        const leftDistance = Math.min(
          ...[...required].map((index) => Math.abs(index - left)),
        );
        const rightDistance = Math.min(
          ...[...required].map((index) => Math.abs(index - right)),
        );
        return leftDistance - rightDistance || left - right;
      });
    const remove = removable[0];
    if (remove === undefined) {
      break;
    }
    selected.delete(remove);
  }
  return [...selected]
    .sort((left, right) => left - right)
    .map((index) => ({ item: items[index]!, index }));
}

function positionStyle(position: number): CSSProperties {
  return {
    "--dvx-question-position": String(
      Math.min(1, Math.max(0, position)),
    ),
  } as CSSProperties;
}

function QuestionChevron({
  direction,
}: {
  readonly direction: "up" | "down";
}): React.JSX.Element {
  return (
    <svg viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path
        d={direction === "up" ? "m3 7.25 3-3 3 3" : "m3 4.75 3 3 3-3"}
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function QuestionNavigator({
  visible,
  items,
  activeIndex,
  onNavigate,
}: QuestionNavigatorProps): React.JSX.Element | null {
  if (!visible || items.length === 0) {
    return null;
  }
  const currentIndex = Math.min(
    Math.max(activeIndex, 0),
    items.length - 1,
  );
  const visibleItems = visibleQuestionItems(items, currentIndex);
  return (
    <nav className="dvx-question-nav" aria-label="Question navigation">
      <button
        type="button"
        className="dvx-question-nav-step"
        aria-label="Previous question"
        disabled={currentIndex === 0}
        onClick={() => onNavigate(items[currentIndex - 1]!.key)}
      >
        <QuestionChevron direction="up" />
      </button>
      <div className="dvx-question-nav-track">
        {visibleItems.map(({ item, index }, slot) => (
          <button
            key={item.key}
            type="button"
            className="dvx-question-nav-node"
            style={positionStyle(
              visibleItems.length === 1
                ? 0.5
                : slot / (visibleItems.length - 1),
            )}
            aria-label={`Jump to question ${index + 1}: ${item.preview}`}
            aria-current={index === currentIndex ? "true" : undefined}
            data-preview={item.preview}
            onClick={() => onNavigate(item.key)}
          >
            <span className="dvx-question-nav-tick" aria-hidden="true" />
          </button>
        ))}
      </div>
      <button
        type="button"
        className="dvx-question-nav-step"
        aria-label="Next question"
        disabled={currentIndex === items.length - 1}
        onClick={() => onNavigate(items[currentIndex + 1]!.key)}
      >
        <QuestionChevron direction="down" />
      </button>
    </nav>
  );
}
