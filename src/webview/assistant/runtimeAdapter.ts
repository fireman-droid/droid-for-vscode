import {
  useExternalStoreRuntime,
  type AppendMessage,
  type AssistantRuntime,
  type ExternalStoreAdapter,
  type ThreadMessageLike,
} from '@assistant-ui/react';
import { useMemo, useRef } from 'react';

import {
  MAX_TURN_TEXT_LENGTH,
  type SentAttachmentSummary,
  type SessionTranscriptItem,
  type TurnStatus,
} from '../../shared/bridgeMessages';
import {
  type AssistantWebviewState,
  isTurnActive,
} from './store';

export interface SafeRuntimeMessage {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  readonly content: ThreadMessageLike['content'];
  readonly status?: ThreadMessageLike['status'];
  readonly optimistic?: boolean;
  /** SDK message id for user messages that can anchor a rewind. */
  readonly messageId?: string;
  /** Chip metadata for the attachments a user message was sent with. */
  readonly attachments?: readonly SentAttachmentSummary[];
}

type SafeRuntimePart = Exclude<
  ThreadMessageLike['content'],
  string
>[number];

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
export const DEFAULT_MESSAGE_WINDOW = 60;
export const MESSAGE_WINDOW_STEP = 120;

export interface DroidRuntimeWindow {
  readonly runtime: AssistantRuntime;
  readonly hiddenMessageCount: number;
}

export interface SendEligibility {
  readonly connectionStatus: AssistantWebviewState['connection']['status'];
  readonly sessionId: string | null;
  readonly turnStatus: TurnStatus | null;
  readonly interactionCount: number;
}

export function canSendMessage(
  eligibility: SendEligibility,
  text?: string,
  additionallyDisabled = false,
): eligibility is SendEligibility & { readonly sessionId: string } {
  if (
    eligibility.connectionStatus !== 'connected' ||
    eligibility.sessionId === null ||
    eligibility.turnStatus === 'submitting' ||
    eligibility.turnStatus === 'streaming' ||
    eligibility.turnStatus === 'stopping' ||
    eligibility.interactionCount > 0 ||
    additionallyDisabled
  ) {
    return false;
  }
  return (
    text === undefined ||
    (text.trim().length > 0 && text.length <= MAX_TURN_TEXT_LENGTH)
  );
}

export function useDroidExternalStoreRuntime(
  state: AssistantWebviewState,
  callbacks: RuntimeAdapterCallbacks,
  messageWindow: number = DEFAULT_MESSAGE_WINDOW,
): DroidRuntimeWindow {
  const messageCacheRef = useRef<RuntimeMessageCache>(new Map());
  const { messages, hiddenMessageCount } = useMemo(() => {
    const all = mapTranscriptToRuntimeMessages(
      state.transcript,
      state.turn,
      messageCacheRef.current,
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
  return useMemo(
    () => ({ runtime, hiddenMessageCount }),
    [hiddenMessageCount, runtime],
  );
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
  };
  return {
    messages,
    isRunning: isTurnActive(state.turn),
    isSendDisabled: !canSendMessage(
      sendEligibility,
      undefined,
      callbacks.isSendDisabled === true,
    ),
    convertMessage: convertSafeRuntimeMessage,
    onNew: async (message) => {
      const text = extractText(message);
      if (
        !canSendMessage(
          sendEligibility,
          text,
          callbacks.isSendDisabled === true,
        )
      ) {
        return;
      }
      await callbacks.onSend(text);
    },
    ...(state.turn !== null &&
    (state.turn.status === 'submitting' ||
      state.turn.status === 'streaming')
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
        messageId: message.messageId ?? null,
        attachments: message.attachments ?? null,
      },
    },
  };
}

export function extractText(message: AppendMessage): string {
  return message.content
    .filter(
      (part): part is Extract<typeof part, { type: 'text' }> =>
        part.type === 'text',
    )
    .map(({ text }) => text)
    .join('');
}

interface RuntimeMessageCacheEntry {
  readonly message: SafeRuntimeMessage;
  readonly items: readonly SessionTranscriptItem[];
  readonly stateKey: string;
}

export type RuntimeMessageCache = Map<string, RuntimeMessageCacheEntry>;

interface UserMessageDescriptor {
  readonly kind: 'user';
  readonly item: Extract<SessionTranscriptItem, { kind: 'user' }>;
  /** User-origin images sent with this prompt, rendered in the bubble. */
  readonly images: Extract<SessionTranscriptItem, { kind: 'image' }>[];
}

interface AssistantGroupDescriptor {
  readonly kind: 'assistant';
  readonly id: string;
  readonly turnId: string;
  readonly items: SessionTranscriptItem[];
}

export function mapTranscriptToRuntimeMessages(
  transcript: readonly SessionTranscriptItem[],
  turn: AssistantWebviewState['turn'],
  cache?: RuntimeMessageCache,
): readonly SafeRuntimeMessage[] {
  const descriptors: (UserMessageDescriptor | AssistantGroupDescriptor)[] =
    [];
  const groups = new Map<string, AssistantGroupDescriptor>();

  for (const item of transcript) {
    if (item.kind === 'user') {
      descriptors.push({ kind: 'user', item, images: [] });
      continue;
    }
    // A user-origin image belongs to the prompt it was sent with; both
    // the live echo and history projection emit it directly after the
    // user text item. Without a preceding user message it falls through
    // to the assistant turn group and renders standalone.
    if (item.kind === 'image' && item.origin === 'user') {
      const last = descriptors[descriptors.length - 1];
      if (last?.kind === 'user') {
        last.images.push(item);
        continue;
      }
    }
    const key = item.turnId ?? `diagnostic:${item.id}`;
    let group = groups.get(key);
    if (group === undefined) {
      group = {
        kind: 'assistant',
        id: `assistant-turn:${key}`,
        turnId: key,
        items: [],
      };
      groups.set(key, group);
      descriptors.push(group);
    }
    group.items.push(item);
  }

  // Reuse prior message identities when the underlying transcript items and
  // derived state are unchanged, so assistant-ui's per-message conversion
  // cache stays warm and untouched messages skip re-rendering during
  // streaming.
  const nextEntries: [string, RuntimeMessageCacheEntry][] = [];
  const messages = descriptors.map((descriptor): SafeRuntimeMessage => {
    if (descriptor.kind === 'user') {
      const item = descriptor.item;
      const optimistic =
        item.id.startsWith('user:') &&
        turn?.turnId === item.id.slice('user:'.length) &&
        turn.status === 'submitting';
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
        content: [
          { type: 'text', text: item.text },
          ...descriptor.images.map(mapItemToPart),
        ],
        optimistic,
        ...(item.messageId === undefined
          ? {}
          : { messageId: item.messageId }),
        ...(item.attachments === undefined
          ? {}
          : { attachments: item.attachments }),
      };
      nextEntries.push([
        item.id,
        { message, items: identityItems, stateKey },
      ]);
      return message;
    }

    const status = resolveAssistantStatus(
      descriptor.items,
      descriptor.turnId,
      turn,
    );
    const stateKey = `${status.type}:${
      'reason' in status ? status.reason : ''
    }`;
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
      role: 'assistant',
      content: uniqueToolCallIds(descriptor.items.map(mapItemToPart)),
      status,
    };
    nextEntries.push([
      descriptor.id,
      { message, items: descriptor.items, stateKey },
    ]);
    return message;
  });

  if (cache !== undefined) {
    cache.clear();
    for (const [id, entry] of nextEntries) {
      cache.set(id, entry);
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
): SafeRuntimePart {
  switch (item.kind) {
    case 'assistant':
      return {
        type: 'text',
        text: item.text,
        status: item.text.length === 0
          ? { type: 'running' }
          : undefined,
      };
    case 'thinking':
      return {
        type: 'reasoning',
        text: item.text,
        status: mapActivityStatus(item.status),
        providerMetadata: {
          droidvisx: {
            durationMs: item.durationMs ?? null,
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
            action: item.action,
            status: item.status,
            progressCount: item.progressCount,
            latestUpdateKind: item.latestUpdateKind,
            durationMs: item.durationMs ?? null,
            filePath: item.filePath ?? null,
            detailKind: item.detailKind ?? null,
            detail: item.detail ?? null,
            errorMessage: item.errorMessage ?? null,
          },
        },
      };
    case 'changes':
      return {
        type: 'data',
        name: 'droid-changes',
        data: {
          turnId: item.turnId,
          files: item.files.map((file) => ({
            path: file.path,
            additions: file.additions,
            deletions: file.deletions,
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
  status: Extract<
    SessionTranscriptItem,
    { kind: 'thinking' }
  >['status'],
): { type: 'running' } | { type: 'complete' } | {
  type: 'incomplete';
  reason: 'cancelled';
} {
  if (status === 'active' || status === 'stopping') {
    return { type: 'running' };
  }
  if (status === 'stopped') {
    return { type: 'incomplete', reason: 'cancelled' };
  }
  return { type: 'complete' };
}

function resolveAssistantStatus(
  items: readonly SessionTranscriptItem[],
  turnId: string,
  turn: AssistantWebviewState['turn'],
): NonNullable<ThreadMessageLike['status']> {
  if (turn?.turnId === turnId) {
    return mapTurnStatus(turn.status);
  }
  const hasRunning = items.some(
    (item) =>
      item.kind === 'thinking' &&
        (item.status === 'active' || item.status === 'stopping') ||
      item.kind === 'tool' &&
        (item.status === 'running' || item.status === 'stopping'),
  );
  if (hasRunning) {
    return { type: 'running' };
  }
  const hasFailure = items.some(
    (item) =>
      item.kind === 'tool' && item.status === 'failed' ||
      item.kind === 'diagnostic' && item.severity === 'error',
  );
  if (hasFailure) {
    return { type: 'incomplete', reason: 'error' };
  }
  const wasStopped = items.some(
    (item) =>
      item.kind === 'tool' && item.status === 'stopped' ||
      item.kind === 'thinking' && item.status === 'stopped',
  );
  return wasStopped
    ? { type: 'incomplete', reason: 'cancelled' }
    : { type: 'complete', reason: 'stop' };
}

function mapTurnStatus(
  status: TurnStatus,
): NonNullable<ThreadMessageLike['status']> {
  switch (status) {
    case 'submitting':
    case 'streaming':
    case 'stopping':
      return { type: 'running' };
    case 'interrupted':
      return { type: 'incomplete', reason: 'cancelled' };
    case 'failed':
      return { type: 'incomplete', reason: 'error' };
    case 'idle':
    case 'completed':
      return { type: 'complete', reason: 'stop' };
  }
}
