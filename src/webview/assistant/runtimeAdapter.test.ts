import { describe, expect, it, vi } from 'vitest';

import type { AppendMessage } from '@assistant-ui/react';
import { MAX_TURN_TEXT_LENGTH } from '../../shared/bridgeMessages';
import {
  canSendMessage,
  createRuntimeAdapter,
  extractText,
  mapTranscriptToRuntimeMessages,
} from './runtimeAdapter';
import {
  initialAssistantWebviewState,
  type AssistantWebviewState,
} from './store';

function userAppend(
  content: AppendMessage['content'],
): AppendMessage {
  return {
    role: 'user',
    content,
    attachments: [],
    createdAt: new Date(0),
    metadata: { custom: {} },
    parentId: null,
    sourceId: null,
    runConfig: undefined,
  };
}

const connectedState: AssistantWebviewState = {
  ...initialAssistantWebviewState,
  sequence: 0,
  sessionId: 'session-a',
  connection: { status: 'connected' },
  historyStatus: 'complete',
};

describe('Droid external-store adapter', () => {
  it('applies the shared send state and text limits', () => {
    const eligible = {
      connectionStatus: 'connected' as const,
      sessionId: 'session-a',
      turnStatus: null,
      interactionCount: 0,
    };

    expect(canSendMessage(eligible, 'Ship it')).toBe(true);
    expect(canSendMessage(eligible, '   ')).toBe(false);
    expect(
      canSendMessage(eligible, 'x'.repeat(MAX_TURN_TEXT_LENGTH + 1)),
    ).toBe(false);
    expect(
      canSendMessage({ ...eligible, turnStatus: 'stopping' }, 'Ship it'),
    ).toBe(false);
    expect(canSendMessage(eligible, 'Ship it', true)).toBe(false);
  });

  it('groups assistant parts by turn without exposing tool payloads', () => {
    const messages = mapTranscriptToRuntimeMessages(
      [
        { id: 'user-a', kind: 'user', text: 'Inspect it' },
        {
          id: 'thinking-a',
          kind: 'thinking',
          turnId: 'turn-a',
          text: 'Looking',
          status: 'active',
          truncated: false,
        },
        {
          id: 'tool-a',
          kind: 'tool',
          turnId: 'turn-a',
          toolUseId: 'tool-use-a',
          toolName: 'Read',
          action: 'Read workspace files',
          status: 'running',
          progressCount: 3,
          latestUpdateKind: 'status',
        },
        {
          id: 'assistant-a',
          kind: 'assistant',
          turnId: 'turn-a',
          text: 'Found it.',
        },
        {
          id: 'diagnostic-a',
          kind: 'diagnostic',
          turnId: 'turn-a',
          severity: 'warning',
          code: 'W'.repeat(400),
          message: 'm'.repeat(5_000),
        },
      ],
      { turnId: 'turn-a', status: 'streaming' },
    );

    expect(messages).toHaveLength(2);
    const assistant = messages[1]!;
    expect(assistant.role).toBe('assistant');
    expect(assistant.status).toEqual({ type: 'running' });
    expect(assistant.content).toMatchObject([
      { type: 'reasoning', text: 'Looking' },
      {
        type: 'tool-call',
        toolCallId: 'tool-use-a',
        toolName: 'Read',
        args: {},
        argsText: '',
        providerMetadata: {
          droidvisx: {
            action: 'Read workspace files',
            status: 'running',
            progressCount: 3,
            latestUpdateKind: 'status',
          },
        },
      },
      { type: 'text', text: 'Found it.' },
      {
        type: 'data',
        name: 'droid-diagnostic',
        data: { severity: 'warning' },
      },
    ]);
    const serialized = JSON.stringify(assistant);
    expect(serialized).not.toContain('"result"');
    expect(serialized).not.toContain('"artifact"');
    const diagnostic = Array.isArray(assistant.content)
      ? assistant.content[3]
      : undefined;
    if (diagnostic?.type !== 'data') {
      throw new Error('Expected diagnostic data');
    }
    expect(
      (diagnostic.data as { code: string; message: string }).code,
    ).toHaveLength(256);
    expect(
      (diagnostic.data as { code: string; message: string }).message,
    ).toHaveLength(4_096);
  });

  it('uniquifies duplicate toolCallIds within one assistant message', () => {
    // Recovery checkpoints persisted before the reconcile fix can carry
    // two tool items with the same toolUseId in one turn; assistant-ui
    // throws on duplicate toolCallIds and blanks the whole panel.
    const toolItem = (id: string) =>
      ({
        id,
        kind: 'tool',
        turnId: 'turn-a',
        toolUseId: 'tool-dupe',
        toolName: 'Glob',
        action: 'Inspected workspace structure',
        status: 'stopped',
        progressCount: 0,
        latestUpdateKind: null,
      }) as const;
    const messages = mapTranscriptToRuntimeMessages(
      [toolItem('tool-a'), toolItem('tool-b')],
      null,
    );

    expect(messages).toHaveLength(1);
    const content = messages[0]!.content;
    if (!Array.isArray(content)) {
      throw new Error('Expected content array');
    }
    const callIds = content
      .filter((part) => part.type === 'tool-call')
      .map((part) => (part as { toolCallId: string }).toolCallId);
    expect(callIds).toHaveLength(2);
    expect(new Set(callIds).size).toBe(2);
    expect(callIds[0]).toBe('tool-dupe');
  });

  it('reuses message identities for untouched transcript items', () => {
    const userItem = {
      id: 'user-a',
      kind: 'user',
      text: 'Inspect it',
    } as const;
    const settledAssistant = {
      id: 'assistant-a',
      kind: 'assistant',
      turnId: 'turn-a',
      text: 'Done.',
    } as const;
    const streamingAssistant = {
      id: 'assistant-b',
      kind: 'assistant',
      turnId: 'turn-b',
      text: 'Working',
    } as const;
    const cache = new Map();

    const first = mapTranscriptToRuntimeMessages(
      [userItem, settledAssistant, streamingAssistant],
      { turnId: 'turn-b', status: 'streaming' },
      cache,
    );
    const second = mapTranscriptToRuntimeMessages(
      [
        userItem,
        settledAssistant,
        { ...streamingAssistant, text: 'Working harder' },
      ],
      { turnId: 'turn-b', status: 'streaming' },
      cache,
    );

    expect(second[0]).toBe(first[0]);
    expect(second[1]).toBe(first[1]);
    expect(second[2]).not.toBe(first[2]);
    expect(second[2]).toMatchObject({
      role: 'assistant',
      content: [{ type: 'text', text: 'Working harder' }],
    });

    const third = mapTranscriptToRuntimeMessages(
      [
        userItem,
        settledAssistant,
        { ...streamingAssistant, text: 'Working harder' },
      ],
      { turnId: 'turn-b', status: 'completed' },
      cache,
    );
    expect(third[1]).toBe(first[1]);
    expect(third[2]).not.toBe(second[2]);
    expect(third[2]?.status).toEqual({
      type: 'complete',
      reason: 'stop',
    });
  });

  it('extracts only text and refuses sends while gated', async () => {
    const onSend = vi.fn();
    const append = userAppend([
      { type: 'text', text: 'first' },
      { type: 'data', name: 'ignored', data: { secret: true } },
      { type: 'text', text: ' second' },
    ]);
    expect(extractText(append)).toBe('first second');

    const adapter = createRuntimeAdapter(
      { ...connectedState, interactions: [{
        sessionId: 'session-a',
        turnId: 'turn-a',
        request: {
          kind: 'ask-user',
          requestId: 'ask-a',
          toolCallId: 'tool-a',
          questions: [{
            index: 0,
            topic: '',
            question: 'Continue?',
            options: ['Yes'],
            multiSelect: false,
          }],
        },
      }] },
      [],
      { onSend, onCancel: vi.fn() },
    );
    await adapter.onNew(append);
    expect(onSend).not.toHaveBeenCalled();
    expect(adapter.isSendDisabled).toBe(true);
  });

  it('forwards accepted text and the active cancellation only', async () => {
    const onSend = vi.fn();
    const onCancel = vi.fn();
    const ready = createRuntimeAdapter(
      connectedState,
      [],
      { onSend, onCancel },
    );
    await ready.onNew(userAppend([{ type: 'text', text: 'Ship it' }]));
    expect(onSend).toHaveBeenCalledWith('Ship it');
    expect(ready.onCancel).toBeUndefined();

    const running = createRuntimeAdapter(
      {
        ...connectedState,
        turn: { turnId: 'turn-a', status: 'streaming' },
      },
      [],
      { onSend, onCancel },
    );
    await running.onCancel?.();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
