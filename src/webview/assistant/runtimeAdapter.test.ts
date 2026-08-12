import { describe, expect, it, vi } from 'vitest';

import type { AppendMessage } from '@assistant-ui/react';
import { MAX_TURN_TEXT_LENGTH } from '../../shared/bridgeMessages';
import { MAX_QUEUED_MESSAGES } from '../../shared/queueProtocol';
import {
  canSendMessage,
  createRuntimeAdapter,
  extractText,
  mapTranscriptToRuntimeMessages,
  shouldQueueMessage,
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
      queuedCount: 0,
    };

    expect(canSendMessage(eligible, 'Ship it')).toBe(true);
    expect(canSendMessage(eligible, '   ')).toBe(false);
    expect(
      canSendMessage(eligible, 'x'.repeat(MAX_TURN_TEXT_LENGTH + 1)),
    ).toBe(false);
    // A running turn keeps the composer open: the send routes to the
    // queue instead of a direct turn.send.
    expect(
      canSendMessage({ ...eligible, turnStatus: 'stopping' }, 'Ship it'),
    ).toBe(true);
    expect(
      canSendMessage(
        {
          ...eligible,
          turnStatus: 'streaming',
          queuedCount: MAX_QUEUED_MESSAGES,
        },
        'Ship it',
      ),
    ).toBe(false);
    expect(canSendMessage(eligible, 'Ship it', true)).toBe(false);
  });

  it('routes sends to the queue while a turn runs or prompts wait', () => {
    expect(
      shouldQueueMessage({ turnStatus: null, queuedCount: 0 }),
    ).toBe(false);
    expect(
      shouldQueueMessage({ turnStatus: 'streaming', queuedCount: 0 }),
    ).toBe(true);
    expect(
      shouldQueueMessage({ turnStatus: 'stopping', queuedCount: 0 }),
    ).toBe(true);
    // A paused, non-empty queue keeps ordering: no overtaking sends.
    expect(
      shouldQueueMessage({ turnStatus: null, queuedCount: 2 }),
    ).toBe(true);
    expect(
      shouldQueueMessage({ turnStatus: 'completed', queuedCount: 0 }),
    ).toBe(false);
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

  it('marks one reply tail per run and aggregates its copy text', () => {
    const messages = mapTranscriptToRuntimeMessages(
      [
        { id: 'user-a', kind: 'user', text: 'Plan and do it' },
        // Turn A ends at a plan approval; the user's consent starts
        // turn B — one visible reply, two turnIds.
        {
          id: 'assistant-a1',
          kind: 'assistant',
          turnId: 'turn-a',
          text: 'Here is the plan.',
        },
        {
          id: 'assistant-a2',
          kind: 'assistant',
          turnId: 'turn-a',
          text: 'Waiting for your approval.',
        },
        {
          id: 'assistant-b1',
          kind: 'assistant',
          turnId: 'turn-b',
          text: 'Approved — done.',
        },
        { id: 'user-b', kind: 'user', text: 'Thanks' },
        {
          id: 'assistant-c1',
          kind: 'assistant',
          turnId: 'turn-c',
          text: 'Anytime.',
        },
      ],
      null,
    );

    expect(messages.map((message) => message.id)).toEqual([
      'user-a',
      'assistant-turn:turn-a',
      'assistant-turn:turn-b',
      'user-b',
      'assistant-turn:turn-c',
    ]);
    const [, turnA, turnB, , turnC] = messages;
    expect(turnA!.replyTail).toBe(false);
    expect(turnA!.replyCopyText).toBeUndefined();
    expect(turnB!.replyTail).toBe(true);
    expect(turnB!.replyCopyText).toBe(
      'Here is the plan.\n\nWaiting for your approval.\n\nApproved — done.',
    );
    expect(turnC!.replyTail).toBe(true);
    expect(turnC!.replyCopyText).toBe('Anytime.');
  });

  it('hangs the bar on the last text-bearing turn of a run', () => {
    const messages = mapTranscriptToRuntimeMessages(
      [
        { id: 'user-a', kind: 'user', text: 'Do it' },
        {
          id: 'assistant-a1',
          kind: 'assistant',
          turnId: 'turn-a',
          text: 'All done.',
        },
        // A trailing text-less turn (tool-only follow-up) must not
        // steal the bar from the reply text…
        {
          id: 'tool-b1',
          kind: 'tool',
          turnId: 'turn-b',
          toolUseId: 'use-b1',
          toolName: 'Read',
          action: 'Read workspace files',
          status: 'completed',
          progressCount: 1,
          latestUpdateKind: 'tool-result',
        },
      ],
      null,
    );
    expect(messages[1]!.replyTail).toBe(true);
    expect(messages[1]!.replyCopyText).toBe('All done.');
    expect(messages[2]!.replyTail).toBe(false);

    // …but a run with no text at all keeps its last message as tail
    // so Regenerate/Fork stay reachable.
    const textless = mapTranscriptToRuntimeMessages(
      [
        { id: 'user-a', kind: 'user', text: 'Do it' },
        {
          id: 'tool-a1',
          kind: 'tool',
          turnId: 'turn-a',
          toolUseId: 'use-a1',
          toolName: 'Read',
          action: 'Read workspace files',
          status: 'completed',
          progressCount: 1,
          latestUpdateKind: 'tool-result',
        },
      ],
      null,
    );
    expect(textless[1]!.replyTail).toBe(true);
    expect(textless[1]!.replyCopyText).toBe('');
  });

  it('moves the tail (and cached identity) when the run grows', () => {
    const cache = new Map();
    const base = [
      { id: 'user-a', kind: 'user', text: 'Go' } as const,
      {
        id: 'assistant-a1',
        kind: 'assistant',
        turnId: 'turn-a',
        text: 'Step one.',
      } as const,
    ];
    const first = mapTranscriptToRuntimeMessages(base, null, cache);
    expect(first[1]!.replyTail).toBe(true);

    const second = mapTranscriptToRuntimeMessages(
      [
        ...base,
        {
          id: 'assistant-b1',
          kind: 'assistant',
          turnId: 'turn-b',
          text: 'Step two.',
        },
      ],
      null,
      cache,
    );
    // The former tail rebuilt as a continuation despite unchanged items.
    expect(second[1]!.replyTail).toBe(false);
    expect(second[2]!.replyTail).toBe(true);
    expect(second[2]!.replyCopyText).toBe('Step one.\n\nStep two.');
  });

  it('forwards a subagent summary through tool metadata', () => {
    const messages = mapTranscriptToRuntimeMessages(
      [
        { id: 'user-a', kind: 'user', text: 'Delegate it' },
        {
          id: 'tool-a',
          kind: 'tool',
          turnId: 'turn-a',
          toolUseId: 'tool-use-a',
          toolName: 'Task',
          action: 'Delegated work',
          status: 'completed',
          progressCount: 1,
          latestUpdateKind: null,
          subagent: {
            type: 'explore',
            description: 'Map the payment flow',
            status: 'completed',
            toolUseCount: 7,
            durationMs: 4_200,
          },
        },
      ],
      null,
    );

    const assistant = messages[1]!;
    expect(assistant.content).toMatchObject([
      {
        type: 'tool-call',
        providerMetadata: {
          droidvisx: {
            subagent: {
              type: 'explore',
              description: 'Map the payment flow',
              status: 'completed',
              toolUseCount: 7,
              durationMs: 4_200,
            },
          },
        },
      },
    ]);
  });

  it('attaches user images to their prompt and maps others to data parts', () => {
    const image = (
      id: string,
      origin: 'user' | 'assistant' | 'tool-result',
      generated = false,
    ) =>
      ({
        id,
        kind: 'image',
        turnId: 'turn-a',
        origin,
        mediaType: 'image/png',
        data: 'aGVsbG8=',
        generated,
        byteLength: 5,
      }) as const;
    const messages = mapTranscriptToRuntimeMessages(
      [
        { id: 'user-a', kind: 'user', text: 'What is this?' },
        image('image-user', 'user'),
        {
          id: 'assistant-a',
          kind: 'assistant',
          turnId: 'turn-a',
          text: 'A diagram.',
        },
        image('image-tool', 'tool-result'),
        image('image-gen', 'assistant', true),
      ],
      null,
    );

    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({
      role: 'user',
      content: [
        {
          type: 'data',
          name: 'droid-image',
          data: {
            origin: 'user',
            mediaType: 'image/png',
            data: 'aGVsbG8=',
            generated: false,
            byteLength: 5,
          },
        },
        { type: 'text', text: 'What is this?' },
      ],
    });
    expect(messages[1]).toMatchObject({
      role: 'assistant',
      content: [
        { type: 'text', text: 'A diagram.' },
        {
          type: 'data',
          name: 'droid-image',
          data: { origin: 'tool-result' },
        },
        {
          type: 'data',
          name: 'droid-image',
          data: { origin: 'assistant', generated: true },
        },
      ],
    });
  });

  it('adopts user images that precede their prompt (history order)', () => {
    // History projection walks the raw message's content blocks, where
    // the CLI stores image blocks BEFORE the text block — the reverse
    // of the live echo order. Both must land in the user bubble.
    const image = (id: string) =>
      ({
        id,
        kind: 'image',
        turnId: 'turn-a',
        origin: 'user',
        mediaType: 'image/png',
        data: 'aGVsbG8=',
        generated: false,
        byteLength: 5,
      }) as const;
    const messages = mapTranscriptToRuntimeMessages(
      [
        image('image-1'),
        image('image-2'),
        { id: 'user-a', kind: 'user', text: 'What is this?' },
        {
          id: 'assistant-a',
          kind: 'assistant',
          turnId: 'turn-a',
          text: 'A chart.',
        },
      ],
      null,
    );

    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({
      role: 'user',
      content: [
        { type: 'data', name: 'droid-image' },
        { type: 'data', name: 'droid-image' },
        { type: 'text', text: 'What is this?' },
      ],
    });
    expect(messages[1]).toMatchObject({ role: 'assistant' });
    // A dangling user image with no adjacent prompt still renders
    // standalone inside its turn group.
    const dangling = mapTranscriptToRuntimeMessages(
      [
        { id: 'user-a', kind: 'user', text: 'Prompt' },
        {
          id: 'assistant-a',
          kind: 'assistant',
          turnId: 'turn-a',
          text: 'Reply.',
        },
        image('image-late'),
        {
          id: 'assistant-b',
          kind: 'assistant',
          turnId: 'turn-a',
          text: 'More.',
        },
      ],
      null,
    );
    expect(dangling).toHaveLength(2);
    expect(dangling[1]!.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'data', name: 'droid-image' }),
      ]),
    );
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
