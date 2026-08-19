import {
  useCallback,
  useEffect,
  useState,
  type RefObject,
} from "react";

const MAX_PREVIEW_LENGTH = 180;

export interface QuestionNavigationItem {
  readonly key: string;
  readonly preview: string;
}

interface QuestionNavigationState {
  readonly visible: boolean;
  readonly items: readonly QuestionNavigationItem[];
  readonly activeIndex: number;
}

const EMPTY_STATE: QuestionNavigationState = {
  visible: false,
  items: [],
  activeIndex: 0,
};

export function isScrollableTranscript(
  scrollHeight: number,
  clientHeight: number,
): boolean {
  return scrollHeight > clientHeight + 1;
}

export function findActiveQuestionIndex(
  questionTops: readonly number[],
  scrollTop: number,
): number {
  if (questionTops.length === 0) {
    return 0;
  }
  let activeIndex = 0;
  questionTops.forEach((top, index) => {
    if (top <= scrollTop + 1) {
      activeIndex = index;
    }
  });
  return activeIndex;
}

export function questionPreview(text: string, index: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length === 0) {
    return `Question ${index + 1}`;
  }
  return normalized.length <= MAX_PREVIEW_LENGTH
    ? normalized
    : `${normalized.slice(0, MAX_PREVIEW_LENGTH - 1)}…`;
}

export function scrollQuestionToTop(
  scroller: HTMLElement,
  element: HTMLElement,
  reducedMotion: boolean,
): void {
  scroller.scrollTo({
    top: layoutTop(element) - layoutTop(scroller),
    behavior: reducedMotion ? "auto" : "smooth",
  });
}

function layoutTop(element: HTMLElement): number {
  let top = 0;
  let current: HTMLElement | null = element;
  while (current !== null) {
    top += current.offsetTop;
    current =
      current.offsetParent instanceof HTMLElement
        ? current.offsetParent
        : null;
  }
  return top;
}

function sameState(
  previous: QuestionNavigationState,
  next: QuestionNavigationState,
): boolean {
  return (
    previous.visible === next.visible &&
    previous.activeIndex === next.activeIndex &&
    previous.items.length === next.items.length &&
    previous.items.every(
      (item, index) =>
        item.key === next.items[index]?.key &&
        item.preview === next.items[index]?.preview,
    )
  );
}

function readQuestionItems(
  elements: readonly HTMLElement[],
): readonly QuestionNavigationItem[] {
  return elements.map((element, index) => ({
    key: element.dataset.questionId ?? `question-${index}`,
    preview: questionPreview(
      element.nextElementSibling?.querySelector(".dvx-user-text")
        ?.textContent ?? "",
      index,
    ),
  }));
}

export function useQuestionNavigation(
  readingColumnRef: RefObject<HTMLDivElement | null>,
): QuestionNavigationState & {
  readonly navigate: (messageId: string) => void;
} {
  const [state, setState] = useState<QuestionNavigationState>(EMPTY_STATE);
  const measure = useCallback((): void => {
    const column = readingColumnRef.current;
    const scroller = column?.closest(".dvx-thread-viewport");
    if (column === null || !(scroller instanceof HTMLElement)) {
      setState(EMPTY_STATE);
      return;
    }
    const elements = Array.from(
      column.querySelectorAll<HTMLElement>(".dvx-question-anchor"),
    );
    const scrollerTop = layoutTop(scroller);
    const visible =
      elements.length > 0 &&
      isScrollableTranscript(scroller.scrollHeight, scroller.clientHeight);
    const activeIndex = findActiveQuestionIndex(
      elements.map((element) => layoutTop(element) - scrollerTop),
      scroller.scrollTop,
    );
    const keys = elements.map(
      (element, index) =>
        element.dataset.questionId ?? `question-${index}`,
    );
    setState((previous) => {
      const sameQuestions =
        previous.items.length === keys.length &&
        previous.items.every((item, index) => item.key === keys[index]);
      const next: QuestionNavigationState = {
        visible,
        activeIndex,
        items: sameQuestions ? previous.items : readQuestionItems(elements),
      };
      return sameState(previous, next) ? previous : next;
    });
  }, [readingColumnRef]);
  useEffect(() => {
    const column = readingColumnRef.current;
    const scroller = column?.closest(".dvx-thread-viewport");
    if (column === null || !(scroller instanceof HTMLElement)) {
      return undefined;
    }
    let frame = 0;
    const schedule = (): void => {
      if (frame === 0) {
        frame = requestAnimationFrame(() => {
          frame = 0;
          measure();
        });
      }
    };
    scroller.addEventListener("scroll", schedule, { passive: true });
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(schedule);
    resizeObserver?.observe(scroller);
    resizeObserver?.observe(column);
    const mutationObserver =
      typeof MutationObserver === "undefined"
        ? null
        : new MutationObserver(schedule);
    // assistant-ui owns an intermediate messages container, so history
    // prepends happen below the reading column rather than as direct children.
    mutationObserver?.observe(column, { subtree: true, childList: true });
    measure();
    return () => {
      scroller.removeEventListener("scroll", schedule);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      if (frame !== 0) {
        cancelAnimationFrame(frame);
      }
    };
  }, [measure, readingColumnRef]);
  const navigate = useCallback(
    (messageId: string): void => {
      const column = readingColumnRef.current;
      const target = Array.from(
        column?.querySelectorAll<HTMLElement>(".dvx-question-anchor") ?? [],
      ).find((element) => element.dataset.questionId === messageId);
      if (target === undefined) {
        return;
      }
      const scroller = column?.closest(".dvx-thread-viewport");
      if (!(scroller instanceof HTMLElement)) {
        return;
      }
      scrollQuestionToTop(
        scroller,
        target,
        window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ??
          false,
      );
    },
    [readingColumnRef],
  );
  return { ...state, navigate };
}
