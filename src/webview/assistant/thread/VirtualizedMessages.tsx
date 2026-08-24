import {
  ThreadPrimitive,
  useAuiState,
} from "@assistant-ui/react";
import {
  observeElementRect,
  useVirtualizer,
} from "@tanstack/react-virtual";
import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type RefObject,
} from "react";

import { FOLLOW_REJOIN_PX } from "../followScroll";
import {
  buildTurns,
  questionTurnRows,
  turnIndexForMessage,
  type MessageRow,
  type TranscriptVirtualizerApi,
} from "./buildTurns";
import { THREAD_MESSAGE_COMPONENTS } from "./messageChrome";

const ESTIMATED_MESSAGE_HEIGHT = 120;
const OVERSCAN = 8;
const INITIAL_RECT = { height: 800, width: 400 };

function releaseFollowForJump(
  follow: { following: boolean } | null,
  scrollTop: number,
): void {
  if (follow === null) {
    return;
  }
  follow.following = false;
  if ("pendingProgrammaticTop" in follow) {
    (
      follow as { following: boolean; pendingProgrammaticTop: number | null }
    ).pendingProgrammaticTop = scrollTop;
  }
}

function useThreadMessageRows(): readonly MessageRow[] {
  const prevRowsRef = useRef<readonly MessageRow[]>([]);
  return useAuiState((state) => {
    const messages = state.thread.messages;
    const prev = prevRowsRef.current;
    if (
      prev.length === messages.length &&
      prev.every((row, index) => {
        const message = messages[index];
        return (
          message !== undefined &&
          row.id === message.id &&
          row.role === message.role
        );
      })
    ) {
      return prev;
    }
    const next: MessageRow[] = messages.map((message) => ({
      id: message.id,
      role: message.role,
    }));
    prevRowsRef.current = next;
    return next;
  });
}

export function VirtualizedMessages({
  getScroller,
  followingRef,
  apiRef,
  components = THREAD_MESSAGE_COMPONENTS,
}: {
  readonly getScroller: () => HTMLElement | null;
  readonly followingRef: RefObject<{ following: boolean } | null>;
  readonly apiRef?: RefObject<TranscriptVirtualizerApi | null>;
  readonly components?: {
    readonly UserMessage: ComponentType;
    readonly AssistantMessage: ComponentType;
  };
}): React.JSX.Element | null {
  const rows = useThreadMessageRows();
  const turns = useMemo(() => buildTurns(rows), [rows]);
  const roleById = useMemo(
    () => new Map(rows.map((row) => [row.id, row.role])),
    [rows],
  );
  const questions = useMemo(
    () => questionTurnRows(turns, roleById),
    [roleById, turns],
  );
  const listRef = useRef<HTMLDivElement | null>(null);
  const [scrollMargin, setScrollMargin] = useState(0);

  useLayoutEffect(() => {
    const list = listRef.current;
    const scroller = getScroller();
    if (list === null || scroller === null) {
      return undefined;
    }
    const measure = (): void => {
      const offset =
        list.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top +
        scroller.scrollTop;
      setScrollMargin((previous) =>
        Math.abs(previous - offset) < 1 ? previous : offset,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    const column = list.parentElement;
    if (column !== null) {
      observer.observe(column);
    }
    return () => observer.disconnect();
  }, [getScroller, turns.length]);

  const virtualizer = useVirtualizer({
    count: turns.length,
    estimateSize: (index) =>
      Math.max(
        ESTIMATED_MESSAGE_HEIGHT,
        (turns[index]?.messageIds.length ?? 1) * ESTIMATED_MESSAGE_HEIGHT,
      ),
    overscan: OVERSCAN,
    scrollMargin,
    initialRect: INITIAL_RECT,
    getItemKey: (index) => turns[index]?.id ?? index,
    getScrollElement: getScroller,
    observeElementRect: (instance, onRect) =>
      observeElementRect(instance, (rect) => {
        onRect(rect.height < 1 || rect.width < 1 ? INITIAL_RECT : rect);
      }),
    scrollToFn: (offset, { adjustments, behavior }, instance) => {
      const element = instance.scrollElement;
      if (element === null) {
        return;
      }
      const top = offset + (adjustments ?? 0);
      if (followingRef.current?.following === true) {
        const maxScroll = element.scrollHeight - element.clientHeight;
        const delta = element.scrollTop - top;
        if (
          maxScroll - element.scrollTop <= FOLLOW_REJOIN_PX &&
          top < maxScroll &&
          delta > 0
        ) {
          return;
        }
        if (delta > 80) {
          followingRef.current.following = false;
        }
      }
      releaseFollowForJump(followingRef.current, top);
      if (typeof element.scrollTo === "function") {
        element.scrollTo({ top, behavior });
        return;
      }
      element.scrollTop = top;
    },
  });

  useLayoutEffect(() => {
    if (apiRef === undefined) {
      return undefined;
    }
    const api: TranscriptVirtualizerApi = {
      scrollToMessageId: (messageId) => {
        const index = turnIndexForMessage(turns, messageId);
        const element = getScroller();
        if (index < 0 || element === null) {
          return;
        }
        releaseFollowForJump(followingRef.current, element.scrollTop);
        virtualizer.scrollToIndex(index, {
          align: "start",
          behavior: "auto",
        });
      },
      questionTops: () => {
        const measured = virtualizer.measurementsCache;
        const total = virtualizer.getTotalSize();
        return questions.indexes.map((index) => {
          const start = measured[index]?.start;
          return (
            start ??
            scrollMargin +
              (index / Math.max(turns.length - 1, 1)) * total
          );
        });
      },
    };
    apiRef.current = api;
    return () => {
      if (apiRef.current === api) {
        apiRef.current = null;
      }
    };
  }, [
    apiRef,
    followingRef,
    getScroller,
    questions,
    scrollMargin,
    turns,
    virtualizer,
  ]);

  if (turns.length === 0) {
    return null;
  }

  const items = virtualizer.getVirtualItems();
  const paddingTop = Math.max(
    0,
    (items[0]?.start ?? scrollMargin) - scrollMargin,
  );
  const paddingBottom = Math.max(
    0,
    virtualizer.getTotalSize() -
      ((items.at(-1)?.end ?? scrollMargin) - scrollMargin),
  );
  const scroller = getScroller();
  const scrollTop = scroller?.scrollTop ?? virtualizer.scrollOffset ?? 0;
  const pinCandidate = virtualizer.getVirtualItemForOffset(scrollTop);
  const pinnedTurn =
    pinCandidate !== undefined &&
    pinCandidate.start <= scrollTop + 1
      ? pinCandidate.index
      : -1;

  return (
    <div className="dvx-virtual-turns" ref={listRef}>
      <div
        className="dvx-virtual-turns-window"
        style={{ paddingTop, paddingBottom }}
      >
        {items.map((item) => {
          const turn = turns[item.index];
          if (turn === undefined) {
            return null;
          }
          const ownsSticky =
            item.index === pinnedTurn &&
            roleById.get(turn.messageIds[0] ?? "") === "user";
          return (
            <div
              key={item.key}
              data-index={item.index}
              data-sticky-owner={ownsSticky ? "" : undefined}
              data-sticky-compact={ownsSticky ? "" : undefined}
              ref={virtualizer.measureElement}
              className="dvx-virtual-turn"
            >
              {turn.messageIds.map((messageId) => (
                <ThreadPrimitive.Unstable_MessageById
                  key={messageId}
                  messageId={messageId}
                  components={components}
                />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
