import {
  AssistantRuntimeProvider,
  useExternalStoreRuntime,
  type ExternalStoreAdapter,
} from '@assistant-ui/react';
import { useCallback, useMemo, useRef, type RefObject } from 'react';

import { type SessionTranscriptItem } from '../../../shared/protocol/transcript';
import {
  InlineHtmlPreviewContext,
  LocalImageContext,
  OpenPathContext,
  PathPreviewContext,
} from '../markdown/MarkdownText';
import {
  convertSafeRuntimeMessage,
  mapTranscriptToRuntimeMessages,
  type CompletionClock,
  type RuntimeMessageCache,
  type SafeRuntimeMessage,
} from './runtimeAdapter';
import { SelectSessionContext, TerminalMirrorContext } from '../thread/messageContexts';
import { ReadOnlyAssistantMessage } from '../thread/AssistantMessage';
import { ReadOnlyUserMessage } from '../thread/UserMessage';
import { VirtualizedMessages } from '../thread/VirtualizedMessages';

/** Stable identity: MessageById memos on each field of this object. */
const READONLY_MESSAGE_COMPONENTS = {
  UserMessage: ReadOnlyUserMessage,
  AssistantMessage: ReadOnlyAssistantMessage,
};

/**
 * Shared assistant-ui projection for observation-only transcripts.
 * Independent session viewers use the main chat's message, Markdown,
 * Thinking, image and tool rows,
 * but deliberately install no Composer or mutating message actions.
 */
export function ReadOnlyTranscript({
  items,
  running,
  className = '',
  getScroller: getScrollerProp,
  followingRef: followingRefProp,
}: {
  readonly items: readonly SessionTranscriptItem[];
  readonly running: boolean;
  readonly className?: string;
  readonly getScroller?: () => HTMLElement | null;
  readonly followingRef?: RefObject<{ following: boolean } | null>;
}): React.JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null);
  const localFollowRef = useRef({ following: true });
  const followingRef = followingRefProp ?? localFollowRef;
  const getScroller = useCallback((): HTMLElement | null => {
    if (getScrollerProp !== undefined) {
      return getScrollerProp();
    }
    const root = rootRef.current;
    const scroller = root?.closest('.dvx-session-viewer-viewport');
    return scroller instanceof HTMLElement ? scroller : null;
  }, [getScrollerProp]);
  const messageCacheRef = useRef<RuntimeMessageCache>(new Map());
  const completionClockRef = useRef<CompletionClock>(new Map());
  const activeTurn = useMemo(
    () => (running ? lastTranscriptTurn(items) : null),
    [items, running],
  );
  const messages = useMemo(
    () =>
      mapTranscriptToRuntimeMessages(
        items,
        activeTurn,
        messageCacheRef.current,
        completionClockRef.current,
      ),
    [activeTurn, items],
  );
  const adapter = useMemo<ExternalStoreAdapter<SafeRuntimeMessage>>(
    () => ({
      messages,
      isRunning: running,
      isSendDisabled: true,
      convertMessage: convertSafeRuntimeMessage,
      onNew: async () => undefined,
    }),
    [messages, running],
  );
  const runtime = useExternalStoreRuntime(adapter);
  return (
    <OpenPathContext.Provider value={null}>
      <PathPreviewContext.Provider value={null}>
        <InlineHtmlPreviewContext.Provider value={null}>
          <LocalImageContext.Provider value={null}>
            <AssistantRuntimeProvider runtime={runtime}>
              <TerminalMirrorContext.Provider value={null}>
                <SelectSessionContext.Provider value={null}>
                  <div
                    ref={rootRef}
                    className={`dvx-readonly-thread${
                      className.length === 0 ? '' : ` ${className}`
                    }`}
                  >
                    <VirtualizedMessages
                      getScroller={getScroller}
                      followingRef={followingRef}
                      components={READONLY_MESSAGE_COMPONENTS}
                      enablePinnedSurface={false}
                    />
                  </div>
                </SelectSessionContext.Provider>
              </TerminalMirrorContext.Provider>
            </AssistantRuntimeProvider>
          </LocalImageContext.Provider>
        </InlineHtmlPreviewContext.Provider>
      </PathPreviewContext.Provider>
    </OpenPathContext.Provider>
  );
}

function lastTranscriptTurn(
  items: readonly SessionTranscriptItem[],
): { readonly turnId: string; readonly status: 'streaming' } | null {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]!;
    if (item.kind !== 'user' && typeof item.turnId === 'string') {
      return { turnId: item.turnId, status: 'streaming' };
    }
  }
  return null;
}
