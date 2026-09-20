import {
  useExternalStoreRuntime,
  type AppendMessage,
  type AssistantRuntime,
  type ExternalStoreAdapter,
  type ThreadMessageLike,
} from '@assistant-ui/react';
import { useMemo, useRef } from 'react';

import { type SentAttachmentSummary } from '../../../shared/protocol/attachments';
import { type SessionTranscriptItem } from '../../../shared/protocol/transcript';
import { stableTranscriptId } from '../../../shared/transcript/hostTranscriptState';
import { canSendMessage, type SendEligibility } from '../composer/sendEligibility';
export { canSendMessage, shouldQueueMessage, type SendEligibility } from '../composer/sendEligibility';
import { formatSelectionQuote } from '../btw/selectionQuote';
import { type AssistantWebviewState } from '../state/types';
import { describeTranscript } from './transcriptGroups';
import { observeCompletion, resolveAssistantStatus, type CompletionClock } from './transcriptStatus';
import { DEFAULT_MESSAGE_WINDOW } from './messageWindow';
export { DEFAULT_MESSAGE_WINDOW, MESSAGE_WINDOW_STEP } from './messageWindow';
export type { CompletionClock } from './transcriptStatus';

export interface SafeRuntimeMessage {
  readonly id: string;
  readonly turnId?: string;
  readonly role: 'user' | 'assistant';
  readonly content: ThreadMessageLike['content'];
  readonly status?: ThreadMessageLike['status'];
  readonly optimistic?: boolean;
  /** SDK message id for user messages that can anchor a rewind. */
  readonly messageId?: string;
  /** Chip metadata for the attachments a user message was sent with. */
  readonly attachments?: readonly SentAttachmentSummary[];
  /** Epoch ms when this assistant reply was seen finishing, if known. */
  readonly completedAt?: number;
  /**
   * False for assistant messages that merely continue a reply run
   * (interactions split one visible reply across several turnIds);
   * the action bar renders only on the run's tail.
   */
  readonly replyTail?: boolean;
  /** Tail-only: every assistant text segment of the run, joined with
   * blank lines — what Copy places on the clipboard. */
  readonly replyCopyText?: string;
}

type SafeRuntimePart = Exclude<ThreadMessageLike['content'], string>[number];

export interface RuntimeAdapterCallbacks {
  readonly onSend: (text: string) => Promise<void> | void;
  readonly onCancel: () => Promise<void> | void;
  readonly isSendDisabled?: boolean;
}

/**
 * Long sessions mount only the trailing message window by default. Rendering
 * every message makes assistant-ui's per-update store notifications and the
 * DOM grow with session length; at a 200-message window each streamed delta
 * cost ~50ms of main-thread work and session recovery blocked for seconds,
 * so the window stays small and "Show earlier messages" loads the rest.
 */
export interface DroidRuntimeWindow {
  readonly runtime: AssistantRuntime;
  readonly hiddenMessageCount: number;
}

export function useDroidExternalStoreRuntime(
  state: AssistantWebviewState,
  callbacks: RuntimeAdapterCallbacks,
  messageWindow: number = DEFAULT_MESSAGE_WINDOW,
): DroidRuntimeWindow {
  const messageCacheRef = useRef<RuntimeMessageCache>(new Map());
  const completionClockRef = useRef<CompletionClock>(new Map());
  const { messages, hiddenMessageCount } = useMemo(() => {
    const all = mapTranscriptToRuntimeMessages(
      state.transcript,
      state.turn,
      messageCacheRef.current,
      completionClockRef.current,
    );
    if (all.length <= messageWindow) {
      return { messages: all, hiddenMessageCount: 0 };
    }
    return {
      messages: all.slice(all.length - messageWindow),
      hiddenMessageCount: all.length - messageWindow,
    };
  }, [messageWindow, state.transcript, state.turn]);
  const adapter = useMemo(
    () => createRuntimeAdapter(state, messages, callbacks),
    [callbacks, messages, state],
  );
  const runtime = useExternalStoreRuntime(adapter);
  return useMemo(() => ({ runtime, hiddenMessageCount }), [hiddenMessageCount, runtime]);
}

export function createRuntimeAdapter(
  state: AssistantWebviewState,
  messages: readonly SafeRuntimeMessage[],
  callbacks: RuntimeAdapterCallbacks,
): ExternalStoreAdapter<SafeRuntimeMessage> {
  const sendEligibility: SendEligibility = {
    connectionStatus: state.connection.status,
    sessionId: state.sessionId,
    turnStatus: state.turn?.status ?? null,
    interactionCount: state.interactions.length,
    queuedCount: state.queue.items.length,
    queueEditing: state.queueEditing !== null,
    settingsUpdating: state.settings.status === 'updating',
  };
  return {
    messages,
    // `stopping` still routes the next prompt through the queue, but the
    // cancelled run is no longer generating. Keeping assistant-ui in a
    // running state here can reject Composer sends until host settlement.
    isRunning: state.turn?.status === 'submitting' || state.turn?.status === 'streaming',
    isSendDisabled: !canSendMessage(
      sendEligibility,
      undefined,
      callbacks.isSendDisabled === true,
    ),
    convertMessage: convertSafeRuntimeMessage,
    onNew: async (message) => {
      const text = extractText(message);
      if (!canSendMessage(sendEligibility, text, callbacks.isSendDisabled === true)) {
        return;
      }
      await callbacks.onSend(text);
    },
    ...(state.turn !== null &&
    (state.turn.status === 'submitting' || state.turn.status === 'streaming')
      ? { onCancel: async () => callbacks.onCancel() }
      : {}),
  };
}

export function convertSafeRuntimeMessage(
  message: SafeRuntimeMessage,
): ThreadMessageLike {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    ...(message.status === undefined ? {} : { status: message.status }),
    metadata: {
      ...(message.optimistic ? { isOptimistic: true } : {}),
      custom: {
        turnId: message.turnId ?? null,
        messageId: message.messageId ?? null,
        attachments: message.attachments ?? null,
        completedAt: message.completedAt ?? null,
        // Absent (user messages, non-adapter paths) means tail so the
        // bar never silently disappears.
        replyTail: message.replyTail ?? true,
        replyCopyText: message.replyCopyText ?? null,
      },
    },
  };
}

export function extractText(message: AppendMessage): string {
  const body = message.content
    .filter(
      (part): part is Extract<typeof part, { type: 'text' }> => part.type === 'text',
    )
    .map(({ text }) => text)
    .join('');
  const quote = message.metadata.custom?.quote;
  return formatSelectionQuote(
    typeof quote === 'object' &&
      quote !== null &&
      'text' in quote &&
      typeof quote.text === 'string'
      ? quote.text
      : '',
    body,
  );
}

interface RuntimeMessageCacheEntry {
  readonly message: SafeRuntimeMessage;
  readonly items: readonly SessionTranscriptItem[];
  readonly stateKey: string;
}

export type RuntimeMessageCache = Map<string, RuntimeMessageCacheEntry>;

export function mapTranscriptToRuntimeMessages(
  transcript: readonly SessionTranscriptItem[],
  turn: Pick<NonNullable<AssistantWebviewState['turn']>, 'turnId' | 'status'> | null,
  cache?: RuntimeMessageCache,
  completionClock?: CompletionClock,
): readonly SafeRuntimeMessage[] {
  const { descriptors, replyTails } = describeTranscript(transcript);

  // Reuse prior message identities when the underlying transcript items and
  // derived state are unchanged, so assistant-ui's per-message conversion
  // cache stays warm and untouched messages skip re-rendering during
  // streaming.
  const nextEntries: [string, RuntimeMessageCacheEntry][] = [];
  const messages = descriptors.map((descriptor): SafeRuntimeMessage => {
    if (descriptor.kind === 'user') {
      const item = descriptor.item;
      const optimistic =
        turn?.status === 'submitting' &&
        (item.id === stableTranscriptId('user', turn.turnId) ||
          item.id === `user:${turn.turnId}`);
      const stateKey = optimistic ? 'optimistic' : 'sent';
      const identityItems = [item, ...descriptor.images];
      const cached = cache?.get(item.id);
      if (
        cached !== undefined &&
        cached.stateKey === stateKey &&
        sameItemIdentities(cached.items, identityItems)
      ) {
        nextEntries.push([item.id, cached]);
        return cached.message;
      }
      const message: SafeRuntimeMessage = {
        id: item.id,
        role: 'user',
        // Thumbs above the prompt text, matching the composer's
        // pending-attachment layout.
        content: [
          ...descriptor.images.map((item) => mapItemToPart(item)),
          { type: 'text', text: item.text },
        ],
        optimistic,
        ...(item.messageId === undefined ? {} : { messageId: item.messageId }),
        ...(item.attachments === undefined ? {} : { attachments: item.attachments }),
      };
      nextEntries.push([item.id, { message, items: identityItems, stateKey }]);
      return message;
    }

    const status = resolveAssistantStatus(descriptor.items, descriptor.turnId, turn);
    // The clock must observe every pass (even cache hits) so the
    // streaming → settled transition is stamped exactly once; the
    // transition also changes stateKey, rebuilding the message with
    // the stamp in the same pass.
    const completedAt =
      completionClock === undefined
        ? undefined
        : observeCompletion(completionClock, descriptor.id, status.type === 'running');
    const replyCopyText = replyTails.get(descriptor.id);
    const replyTail = replyCopyText !== undefined;
    // Tail-ness and the aggregated copy text are derived from OTHER
    // descriptors too, so they participate in the cache key: a former
    // tail rebuilds without its bar when the run grows, and a tail
    // rebuilds when any run segment's text changes length.
    const stateKey = `${status.type}:${
      'reason' in status ? status.reason : ''
    }:${replyTail ? `tail:${replyCopyText.length}` : 'cont'}`;
    const cached = cache?.get(descriptor.id);
    if (
      cached !== undefined &&
      cached.stateKey === stateKey &&
      sameItemIdentities(cached.items, descriptor.items)
    ) {
      nextEntries.push([descriptor.id, cached]);
      return cached.message;
    }
    const message: SafeRuntimeMessage = {
      id: descriptor.id,
      turnId: descriptor.turnId,
      role: 'assistant',
      content: uniqueToolCallIds(
        descriptor.items.map((item) => mapItemToPart(item, status.type === 'running')),
      ),
      status,
      ...(completedAt === undefined ? {} : { completedAt }),
      replyTail,
      ...(replyCopyText === undefined ? {} : { replyCopyText }),
    };
    nextEntries.push([descriptor.id, { message, items: descriptor.items, stateKey }]);
    return message;
  });

  if (cache !== undefined) {
    cache.clear();
    for (const [id, entry] of nextEntries) {
      cache.set(id, entry);
    }
  }
  if (completionClock !== undefined) {
    const liveIds = new Set(messages.map((message) => message.id));
    for (const key of [...completionClock.keys()]) {
      if (!liveIds.has(key)) {
        completionClock.delete(key);
      }
    }
  }
  return messages;
}

function sameItemIdentities(
  a: readonly SessionTranscriptItem[],
  b: readonly SessionTranscriptItem[],
): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) {
      return false;
    }
  }
  return true;
}

/**
 * assistant-ui throws (and React unmounts the whole tree) when two
 * tool-call parts in one message share a toolCallId. Persisted recovery
 * checkpoints written before the reconcile fix can still contain such
 * duplicates, so uniquify defensively at the render boundary.
 */
function uniqueToolCallIds(
  parts: readonly SafeRuntimePart[],
): readonly SafeRuntimePart[] {
  const seen = new Set<string>();
  return parts.map((part) => {
    // toolCallId is optional on the library part type; our
    // mapItemToPart always sets it, but the narrowing is type-mandated.
    if (part.type !== 'tool-call' || part.toolCallId === undefined) {
      return part;
    }
    const base = part.toolCallId;
    let id = base;
    let collision = 0;
    while (seen.has(id)) {
      collision += 1;
      id = `${base}#${collision}`;
    }
    seen.add(id);
    return id === base ? part : { ...part, toolCallId: id };
  });
}

function mapItemToPart(
  item: SessionTranscriptItem,
  messageRunning = false,
): SafeRuntimePart {
  switch (item.kind) {
    case 'assistant':
      return {
        type: 'text',
        text: item.text,
        ...(item.text.length === 0 && messageRunning
          ? { status: { type: 'running' as const } }
          : {}),
      };
    case 'thinking':
      return {
        type: 'reasoning',
        text: item.text,
        status: mapActivityStatus(item.status),
        providerMetadata: {
          droidvisx: {
            durationMs: item.durationMs ?? null,
            truncated: item.truncated,
          },
        },
      };
    case 'tool':
      return {
        type: 'tool-call',
        toolCallId: item.toolUseId,
        toolName: item.toolName,
        args: {},
        argsText: '',
        providerMetadata: {
          droidvisx: {
            turnId: item.turnId,
            action: item.action,
            status: item.status,
            progressCount: item.progressCount,
            latestUpdateKind: item.latestUpdateKind,
            executionPhase: item.executionPhase ?? null,
            operationDiff: item.operationDiff?.status === 'ready' ? {
              status: item.operationDiff.status, source: item.operationDiff.source,
              callId: item.operationDiff.callId ?? null,
              sourceSessionId: item.operationDiff.sourceSessionId ?? null,
              files: item.operationDiff.files.map((file) => ({
                path: file.path, kind: file.kind, patch: file.patch,
                previousPath: file.previousPath ?? null, outcome: file.outcome ?? null,
                message: file.message ?? null, reversible: file.reversible ?? false,
              })),
            } : item.operationDiff ? { status: item.operationDiff.status, reason: item.operationDiff.reason } : null,
            durationMs: item.durationMs ?? null,
            filePath: item.filePath ?? null,
            detailKind: item.detailKind ?? null,
            detail: item.detail ?? null,
            target: item.target ?? null,
            errorMessage: item.errorMessage ?? null,
            outputTail: item.outputTail ?? null,
            resultPreview:
              item.resultPreview === undefined
                ? null
                : item.resultPreview.availability === 'available'
                  ? { ...item.resultPreview, source: { ...item.resultPreview.source } }
                  : {
                      availability: item.resultPreview.availability,
                      reason: item.resultPreview.reason,
                      ...(item.resultPreview.source === undefined
                        ? {}
                        : { source: { ...item.resultPreview.source } }),
                    },
            // Rebuilt as literals: interfaces lack the index
            // signature ReadonlyJSONValue requires.
            backgroundHint:
              item.backgroundHint === undefined
                ? null
                : {
                    fireAndForget: item.backgroundHint.fireAndForget,
                  },
            subagent:
              item.subagent === undefined
                ? null
                : {
                    type: item.subagent.type,
                    description: item.subagent.description,
                    status: item.subagent.status ?? null,
                    toolUseCount: item.subagent.toolUseCount ?? null,
                    durationMs: item.subagent.durationMs ?? null,
                  },
          },
        },
      };
    case 'changes':
      return {
        type: 'data',
        name: 'droid-changes',
        data: {
          turnId: item.turnId,
          writing: item.writing === true,
          files: item.files.map((file) => ({
            path: file.path,
            additions: file.additions,
            deletions: file.deletions,
          })),
        },
      };
    case 'ask-user-result':
      return {
        type: 'data',
        name: 'droid-ask-user-result',
        data:
          item.status === 'cancelled'
            ? { status: 'cancelled' }
            : {
                status: 'answered',
                answers: item.answers.map(({ topic, question, answer }) => ({
                  topic,
                  ...(question === undefined ? {} : { question }),
                  answer,
                })),
              },
      };
    case 'diagnostic':
      return {
        type: 'data',
        name: 'droid-diagnostic',
        data: {
          severity: item.severity,
          code: item.code.slice(0, 256),
          message: item.message.slice(0, 4_096),
          ...(item.relatedSessionId === undefined
            ? {}
            : { relatedSessionId: item.relatedSessionId }),
        },
      };
    case 'image':
      return {
        type: 'data',
        name: 'droid-image',
        data: {
          origin: item.origin,
          mediaType: item.mediaType,
          data: item.data,
          generated: item.generated,
          byteLength: item.byteLength,
        },
      };
    case 'user':
      return { type: 'text', text: item.text };
  }
}

function mapActivityStatus(
  status: Extract<SessionTranscriptItem, { kind: 'thinking' }>['status'],
):
  | { type: 'running' }
  | { type: 'complete' }
  | {
      type: 'incomplete';
      reason: 'cancelled';
    } {
  if (status === 'active') {
    return { type: 'running' };
  }
  if (status === 'stopping' || status === 'stopped') {
    return { type: 'incomplete', reason: 'cancelled' };
  }
  return { type: 'complete' };
}
