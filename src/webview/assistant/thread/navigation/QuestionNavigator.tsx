import type { CSSProperties } from 'react';

import { visibleQuestionItems, type QuestionNavigationItem } from './questionNavigation';
export { visibleQuestionItems } from './questionNavigation';

interface QuestionNavigatorProps {
  readonly visible: boolean;
  readonly items: readonly QuestionNavigationItem[];
  readonly activeIndex: number;
  readonly onNavigate: (messageId: string) => void;
}

function trackStyle(count: number, dense: boolean): CSSProperties {
  const gap = dense ? 10 : 14;
  return {
    '--dvx-question-track-height': `${Math.max(4, (count - 1) * gap + 4)}px`,
  } as CSSProperties;
}

function QuestionChevron({
  direction,
}: {
  readonly direction: 'up' | 'down';
}): React.JSX.Element {
  return (
    <svg viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path
        d={direction === 'up' ? 'm3 7.25 3-3 3 3' : 'm3 4.75 3 3 3-3'}
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
  const currentIndex = Math.min(Math.max(activeIndex, 0), items.length - 1);
  const visibleItems = visibleQuestionItems(items, currentIndex);
  const dense = items.length > 6;
  return (
    <nav
      className="dvx-question-nav"
      data-density={dense ? 'dense' : 'sparse'}
      aria-label="Question navigation"
    >
      <button
        type="button"
        className="dvx-question-nav-step"
        aria-label="Previous question"
        disabled={currentIndex === 0}
        onClick={() => onNavigate(items[currentIndex - 1]!.key)}
      >
        <QuestionChevron direction="up" />
      </button>
      <div
        className="dvx-question-nav-track"
        style={trackStyle(visibleItems.length, dense)}
      >
        {visibleItems.map(({ item, index }) => (
          <button
            key={item.key}
            type="button"
            className="dvx-question-nav-node"
            aria-label={`Jump to question ${index + 1}: ${item.preview}`}
            aria-current={index === currentIndex ? 'true' : undefined}
            data-adjacent={Math.abs(index - currentIndex) === 1 ? 'true' : undefined}
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
