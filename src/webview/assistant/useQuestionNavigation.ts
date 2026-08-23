import { useAuiState } from "@assistant-ui/react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

import { readMessageText } from "./thread/readers";
import type { TranscriptVirtualizerApi } from "./thread/buildTurns";

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
  maxScrollTop = Number.POSITIVE_INFINITY,
): number {
  if (questionTops.length === 0) {
    return 0;
  }
  if (maxScrollTop - scrollTop <= 1) {
    return questionTops.length - 1;
  }
  let low = 0;
  let high = questionTops.length - 1;
  let activeIndex = 0;
  while (low <= high) {
    const index = (low + high) >> 1;
    const top = questionTops[index] ?? Number.POSITIVE_INFINITY;
    if (top <= scrollTop + 1) {
      activeIndex = index;
      low = index + 1;
    } else {
      high = index - 1;
    }
  }
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

function readDomQuestionTops(
  column: HTMLElement,
  scroller: HTMLElement,
  keys: readonly string[],
): readonly number[] | null {
  const scrollerTop = layoutTop(scroller);
  const byId = new Map<string, number>();
  Array.from(
    column.querySelectorAll<HTMLElement>(".dvx-question-anchor"),
  ).forEach((element) => {
    const id = element.dataset.questionId;
    if (id !== undefined) {
      byId.set(id, layoutTop(element) - scrollerTop);
    }
  });
  if (byId.size === 0) {
    return null;
  }
  return keys.map((key, index) => byId.get(key) ?? (byId.get(keys[index - 1] ?? "") ?? 0));
}

export function projectQuestionItems(
  messages: readonly {
    readonly id: string;
    readonly role: string;
    readonly content: unknown;
  }[],
): readonly QuestionNavigationItem[] {
  const items: QuestionNavigationItem[] = [];
  for (const message of messages) {
    if (message.role !== "user") {
      continue;
    }
    const content = Array.isArray(message.content) ? message.content : [];
    items.push({
      key: message.id,
      preview: questionPreview(readMessageText(content), items.length),
    });
  }
  return items;
}

export function useQuestionNavigation(
  readingColumnRef: RefObject<HTMLDivElement | null>,
  virtualizerApiRef: RefObject<TranscriptVirtualizerApi | null>,
): QuestionNavigationState & {
  readonly navigate: (messageId: string) => void;
} {
  const prevQuestionsRef = useRef<readonly QuestionNavigationItem[]>([]);
  const questions = useAuiState((state) => {
    const next = projectQuestionItems(state.thread.messages);
    const previous = prevQuestionsRef.current;
    if (
      previous.length === next.length &&
      previous.every(
        (item, index) =>
          item.key === next[index]?.key &&
          item.preview === next[index]?.preview,
      )
    ) {
      return previous;
    }
    prevQuestionsRef.current = next;
    return next;
  });
  const [state, setState] = useState<QuestionNavigationState>(EMPTY_STATE);
  const measure = useCallback((): void => {
    const column = readingColumnRef.current;
    const scroller = column?.closest(".dvx-thread-viewport");
    if (column === null || !(scroller instanceof HTMLElement)) {
      setState(EMPTY_STATE);
      return;
    }
    const keys = questions.map((item) => item.key);
    const virtualTops = virtualizerApiRef.current?.questionTops();
    const usedVirtual =
      virtualTops !== undefined && virtualTops.length === keys.length;
    const tops = usedVirtual
      ? virtualTops
      : (readDomQuestionTops(column, scroller, keys) ?? []);
    const visible =
      keys.length > 0 &&
      isScrollableTranscript(scroller.scrollHeight, scroller.clientHeight);
    const maxScrollTop = Math.max(
      0,
      scroller.scrollHeight - scroller.clientHeight,
    );
    const activeIndex = findActiveQuestionIndex(
      tops,
      scroller.scrollTop,
      maxScrollTop,
    );
    setState((previous) => {
      const next: QuestionNavigationState = {
        visible,
        activeIndex,
        items: questions,
      };
      return sameState(previous, next) ? previous : next;
    });
  }, [questions, readingColumnRef, virtualizerApiRef]);
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
      virtualizerApiRef.current?.scrollToMessageId(messageId);
    },
    [virtualizerApiRef],
  );
  return { ...state, navigate };
}
