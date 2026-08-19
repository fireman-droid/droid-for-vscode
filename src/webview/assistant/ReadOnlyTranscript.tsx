import {
  AssistantRuntimeProvider,
  ThreadPrimitive,
  useExternalStoreRuntime,
  type ExternalStoreAdapter,
} from '@assistant-ui/react';
import { useMemo, useRef } from 'react';

import type { SessionTranscriptItem } from '../../shared/bridgeMessages';
import {
  InlineHtmlPreviewContext,
  LocalImageContext,
  OpenPathContext,
  PathPreviewContext,
} from './MarkdownText';
import {
  convertSafeRuntimeMessage,
  mapTranscriptToRuntimeMessages,
  type CompletionClock,
  type RuntimeMessageCache,
  type SafeRuntimeMessage,
} from './runtimeAdapter';
import {
  SelectSessionContext,
  TerminalMirrorContext,
} from './Thread';
import { ReadOnlyAssistantMessage } from './thread/AssistantMessage';
import { ReadOnlyUserMessage } from './thread/UserMessage';

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
}: {
  readonly items: readonly SessionTranscriptItem[];
  readonly running: boolean;
  readonly className?: string;
}): React.JSX.Element {
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
                    className={`dvx-readonly-thread${
                      className.length === 0
                        ? ''
                        : ` ${className}`
                    }`}
                  >
                    <ThreadPrimitive.Messages>
                      {({ message }) =>
                        message.role === 'user' ? (
                          <ReadOnlyUserMessage />
                        ) : (
                          <ReadOnlyAssistantMessage />
                        )
                      }
                    </ThreadPrimitive.Messages>
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
