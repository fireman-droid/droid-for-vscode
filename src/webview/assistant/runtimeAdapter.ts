import {
  useExternalStoreRuntime,
  type AppendMessage,
  type AssistantRuntime,
  type ExternalStoreAdapter,
  type ThreadMessageLike,
} from '@assistant-ui/react';
import { useMemo } from 'react';

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
): AssistantRuntime {
  const messages = useMemo(
    () => mapTranscriptToRuntimeMessages(state.transcript, state.turn),
    [state.transcript, state.turn],
  );
  const adapter = useMemo(
    () => createRuntimeAdapter(state, messages, callbacks),
    [callbacks, messages, state],
  );
  return useExternalStoreRuntime(adapter);
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
    metadata: message.optimistic ? { isOptimistic: true } : {},
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

export function mapTranscriptToRuntimeMessages(
  transcript: readonly SessionTranscriptItem[],
  turn: AssistantWebviewState['turn'],
): readonly SafeRuntimeMessage[] {
  const messages: SafeRuntimeMessage[] = [];
  const groups = new Map<
    string,
    {
      id: string;
      turnId: string;
      items: SessionTranscriptItem[];
    }
  >();

  for (const item of transcript) {
    if (item.kind === 'user') {
      messages.push({
        id: item.id,
        role: 'user',
        content: [{ type: 'text', text: item.text }],
        optimistic:
          item.id.startsWith('user:') &&
          turn?.turnId === item.id.slice('user:'.length) &&
          turn.status === 'submitting',
      });
      continue;
    }

    const key = item.turnId ?? `diagnostic:${item.id}`;
    let group = groups.get(key);
    if (group === undefined) {
      group = {
        id: `assistant-turn:${key}`,
        turnId: key,
        items: [],
      };
      groups.set(key, group);
      messages.push({
        id: group.id,
        role: 'assistant',
        content: [],
      });
    }
    group.items.push(item);
  }

  return messages.map((message) => {
    if (message.role === 'user') {
      return message;
    }
    const group = groups.get(
      message.id.slice('assistant-turn:'.length),
    );
    if (group === undefined) {
      return message;
    }
    return {
      ...message,
      content: group.items.map(mapItemToPart),
      status: resolveAssistantStatus(group.items, group.turnId, turn),
    };
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
