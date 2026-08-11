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
 * DOM grow with session length; measured at 2,000 transcript items this cost
 * ~75ms of main-thread work per streamed delta.
 */
export const DEFAULT_MESSAGE_WINDOW = 200;
export const MESSAGE_WINDOW_STEP = 200;

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
      descriptors.push({ kind: 'user', item });
      continue;
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
      const cached = cache?.get(item.id);
      if (
        cached !== undefined &&
        cached.stateKey === stateKey &&
        cached.items.length === 1 &&
        cached.items[0] === item
      ) {
        nextEntries.push([item.id, cached]);
        return cached.message;
      }
      const message: SafeRuntimeMessage = {
        id: item.id,
        role: 'user',
        content: [{ type: 'text', text: item.text }],
        optimistic,
        ...(item.messageId === undefined
          ? {}
          : { messageId: item.messageId }),
      };
      nextEntries.push([
        item.id,
        { message, items: [item], stateKey },
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
      content: descriptor.items.map(mapItemToPart),
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
          },
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
