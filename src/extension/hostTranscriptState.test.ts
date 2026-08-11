import { describe, expect, it } from 'vitest';

import {
  MAX_ASSISTANT_TEXT_LENGTH,
  MAX_SESSION_TRANSCRIPT_ITEMS,
  type SessionTranscriptItem,
} from '../shared/bridgeMessages';
import {
  appendAcceptedUserPrompt,
  attachUserMessageId,
  createHostTranscriptState,
  hydrateHostTranscriptState,
  MAX_HOST_TRANSCRIPT_DIAGNOSTICS,
  projectHostTranscriptMessage,
  stableTranscriptId,
  truncateFromUserMessage,
  type HostTranscriptProjectionMessage,
  type HostTranscriptState,
} from './hostTranscriptState';

describe('hostTranscriptState', () => {
  it('projects accepted prompts and semantic events with stable IDs', () => {
    let state = appendAcceptedUserPrompt(
      createHostTranscriptState('complete'),
      'turn-1',
      'Read the project',
    );
    state = project(state, {
      type: 'assistant.delta',
      sessionId: 'session-1',
      turnId: 'turn-1',
      delta: 'Done',
    });
    state = project(state, {
      type: 'assistant.delta',
      sessionId: 'session-1',
      turnId: 'turn-1',
      delta: ' safely',
    });
    state = project(state, {
      type: 'thinking.delta',
      sessionId: 'session-1',
      turnId: 'turn-1',
      delta: 'Check files',
      truncated: false,
    });
    state = project(state, {
      type: 'thinking.complete',
      sessionId: 'session-1',
      turnId: 'turn-1',
      durationMs: 25,
    });
    state = project(state, {
      type: 'tool.activity',
      sessionId: 'session-1',
      turnId: 'turn-1',
      toolUseId: 'tool-1',
      toolName: 'Read',
      action: 'Read workspace files',
      status: 'running',
      progressCount: 0,
      latestUpdateKind: null,
    });
    state = project(state, {
      type: 'tool.activity',
      sessionId: 'session-1',
      turnId: 'turn-1',
      toolUseId: 'tool-1',
      toolName: 'Read',
      action: 'Read workspace files',
      status: 'completed',
      progressCount: 2,
      latestUpdateKind: 'status',
    });
    state = project(state, {
      type: 'runtime.diagnostic',
      sessionId: 'session-1',
      turnId: 'turn-1',
      severity: 'warning',
      code: 'safe-code',
      message: 'Safe explanation',
    });

    expect(state).toEqual({
      historyStatus: 'complete',
      truncated: false,
      transcript: [
        {
          id: stableTranscriptId('user', 'turn-1'),
          kind: 'user',
          text: 'Read the project',
        },
        {
          id: stableTranscriptId('assistant', 'turn-1'),
          kind: 'assistant',
          turnId: 'turn-1',
          text: 'Done safely',
        },
        {
          id: stableTranscriptId('thinking', 'turn-1'),
          kind: 'thinking',
          turnId: 'turn-1',
          text: 'Check files',
          status: 'complete',
          durationMs: 25,
          truncated: false,
        },
        {
          id: stableTranscriptId('tool', 'turn-1', 'tool-1'),
          kind: 'tool',
          turnId: 'turn-1',
          toolUseId: 'tool-1',
          toolName: 'Read',
          action: 'Read workspace files',
          status: 'completed',
          progressCount: 2,
          latestUpdateKind: 'status',
        },
        expect.objectContaining({
          kind: 'diagnostic',
          turnId: 'turn-1',
          severity: 'warning',
          code: 'safe-code',
          message: 'Safe explanation',
        }),
      ],
    });
    expect(
      stableTranscriptId('assistant', 'turn-1'),
    ).toBe(stableTranscriptId('assistant', 'turn-1'));
  });

  it('preserves alternating Thinking, Tool, and assistant chronology', () => {
    let state = createHostTranscriptState('complete');
    state = project(state, {
      type: 'thinking.delta',
      sessionId: 'session-1',
      turnId: 'turn-1',
      delta: 'First thought',
      truncated: false,
    });
    state = project(state, {
      type: 'assistant.delta',
      sessionId: 'session-1',
      turnId: 'turn-1',
      delta: 'First answer',
    });
    state = project(state, {
      type: 'thinking.delta',
      sessionId: 'session-1',
      turnId: 'turn-1',
      delta: 'Second thought',
      truncated: false,
    });
    state = project(state, {
      type: 'tool.activity',
      sessionId: 'session-1',
      turnId: 'turn-1',
      toolUseId: 'tool-1',
      toolName: 'Read',
      action: 'Read workspace files',
      status: 'completed',
      progressCount: 0,
      latestUpdateKind: null,
    });
    state = project(state, {
      type: 'assistant.delta',
      sessionId: 'session-1',
      turnId: 'turn-1',
      delta: 'Final answer',
    });
    state = project(state, {
      type: 'thinking.complete',
      sessionId: 'session-1',
      turnId: 'turn-1',
      durationMs: 50,
    });

    expect(
      state.transcript.map((item) =>
        item.kind === 'tool' ? item.action : 'text' in item ? item.text : '',
      ),
    ).toEqual([
      'First thought',
      'First answer',
      'Second thought',
      'Read workspace files',
      'Final answer',
    ]);
    expect(
      state.transcript
        .filter((item) => item.kind === 'thinking')
        .map((item) => item.status),
    ).toEqual(['complete', 'complete']);
    expect(new Set(state.transcript.map((item) => item.id)).size).toBe(
      state.transcript.length,
    );
  });

  it('moves unavailable history to partial after observing UI items', () => {
    const unavailable = createHostTranscriptState('unavailable');
    const observed = appendAcceptedUserPrompt(
      unavailable,
      'turn-1',
      'Hello',
    );

    expect(unavailable.historyStatus).toBe('unavailable');
    expect(observed.historyStatus).toBe('partial');
    expect(observed.truncated).toBe(false);
  });

  it('downgrades complete persisted history on restart without changing other statuses', () => {
    const cached = appendAcceptedUserPrompt(
      createHostTranscriptState('complete'),
      'turn-1',
      'Cached',
    );
    const unavailableWithCache: HostTranscriptState = {
      ...cached,
      historyStatus: 'unavailable',
    };

    expect(
      hydrateHostTranscriptState(
        createHostTranscriptState('complete'),
      ).historyStatus,
    ).toBe('unavailable');
    expect(hydrateHostTranscriptState(cached).historyStatus).toBe(
      'partial',
    );
    expect(
      hydrateHostTranscriptState({
        ...cached,
        historyStatus: 'partial',
      }).historyStatus,
    ).toBe('partial');
    expect(
      hydrateHostTranscriptState(unavailableWithCache).historyStatus,
    ).toBe('unavailable');
  });

  it('evicts the oldest diagnostics without evicting conversation entries', () => {
    let state = appendAcceptedUserPrompt(
      createHostTranscriptState('complete'),
      'turn-1',
      'Keep this prompt',
    );
    for (
      let index = 0;
      index <= MAX_HOST_TRANSCRIPT_DIAGNOSTICS;
      index += 1
    ) {
      state = projectHostTranscriptMessage(state, {
        type: 'runtime.diagnostic',
        sessionId: 'session-1',
        turnId: null,
        severity: 'warning',
        code: `diagnostic-${index}`,
        message: `Diagnostic ${index}`,
        sequence: index,
      });
    }

    const diagnostics = state.transcript.filter(
      (item) => item.kind === 'diagnostic',
    );
    expect(diagnostics).toHaveLength(
      MAX_HOST_TRANSCRIPT_DIAGNOSTICS,
    );
    expect(diagnostics[0]).toMatchObject({
      code: 'diagnostic-1',
    });
    expect(state.transcript).toContainEqual(
      expect.objectContaining({
        kind: 'user',
        text: 'Keep this prompt',
      }),
    );
    expect(state).toMatchObject({
      historyStatus: 'partial',
      truncated: true,
    });
  });

  it('downgrades complete history when item or text bounds evict data', () => {
    let items = createHostTranscriptState('complete');
    for (
      let index = 0;
      index <= MAX_SESSION_TRANSCRIPT_ITEMS;
      index += 1
    ) {
      items = appendAcceptedUserPrompt(
        items,
        `turn-${index}`,
        String(index),
      );
    }
    const text = project(createHostTranscriptState('complete'), {
      type: 'assistant.delta',
      sessionId: 'session-1',
      turnId: 'turn-1',
      delta: 'a'.repeat(MAX_ASSISTANT_TEXT_LENGTH + 1),
    });
    const thinking = project(createHostTranscriptState('complete'), {
      type: 'thinking.delta',
      sessionId: 'session-1',
      turnId: 'turn-1',
      delta: '',
      truncated: true,
    });

    expect(items.transcript).toHaveLength(
      MAX_SESSION_TRANSCRIPT_ITEMS,
    );
    expect(items.transcript[0]).toMatchObject({ text: '1' });
    expect(items).toMatchObject({
      historyStatus: 'partial',
      truncated: true,
    });
    expect(text.transcript[0]).toMatchObject({
      kind: 'assistant',
      text: 'a'.repeat(MAX_ASSISTANT_TEXT_LENGTH),
    });
    expect(text).toMatchObject({
      historyStatus: 'partial',
      truncated: true,
    });
    expect(thinking).toMatchObject({
      historyStatus: 'partial',
      truncated: true,
      transcript: [expect.objectContaining({ truncated: true })],
    });
  });

  it('finalizes active turn activity and normalizes restart-only states', () => {
    let state = createHostTranscriptState('complete');
    state = project(state, {
      type: 'thinking.delta',
      sessionId: 'session-1',
      turnId: 'turn-1',
      delta: 'Working',
      truncated: false,
    });
    state = project(state, {
      type: 'tool.activity',
      sessionId: 'session-1',
      turnId: 'turn-1',
      toolUseId: 'tool-1',
      toolName: 'Write',
      action: 'Updated workspace files',
      status: 'running',
      progressCount: 0,
      latestUpdateKind: null,
    });
    const stopping = project(state, {
      type: 'turn.state',
      sessionId: 'session-1',
      turnId: 'turn-1',
      status: 'stopping',
    });
    const restarted = hydrateHostTranscriptState(stopping);
    const terminal = project(state, {
      type: 'turn.state',
      sessionId: 'session-1',
      turnId: 'turn-1',
      status: 'interrupted',
    });

    expect(statuses(stopping)).toEqual(['stopping', 'stopping']);
    expect(statuses(restarted)).toEqual(['stopped', 'stopped']);
    expect(statuses(terminal)).toEqual(['stopped', 'stopped']);
    expect(Object.keys(restarted).sort()).toEqual([
      'historyStatus',
      'transcript',
      'truncated',
    ]);
  });

  it('attaches and preserves a tool file path across activity updates', () => {
    let state = createHostTranscriptState('complete');
    state = project(state, {
      type: 'tool.activity',
      sessionId: 'session-1',
      turnId: 'turn-1',
      toolUseId: 'tool-1',
      toolName: 'Edit',
      action: 'Updated workspace files',
      status: 'running',
      progressCount: 0,
      latestUpdateKind: null,
      filePath: 'src/app.ts',
    });
    // A later update without the path keeps the recorded one.
    state = project(state, {
      type: 'tool.activity',
      sessionId: 'session-1',
      turnId: 'turn-1',
      toolUseId: 'tool-1',
      toolName: 'Edit',
      action: 'Updated workspace files',
      status: 'completed',
      progressCount: 1,
      latestUpdateKind: 'status',
      durationMs: 40,
    });

    expect(state.transcript).toEqual([
      expect.objectContaining({
        kind: 'tool',
        status: 'completed',
        filePath: 'src/app.ts',
      }),
    ]);
  });

  it('never projects interaction or raw tool payload shapes', () => {
    let state = createHostTranscriptState('complete');
    state = project(state, {
      type: 'tool.activity',
      sessionId: 'session-1',
      turnId: 'turn-1',
      toolUseId: 'tool-1',
      toolName: 'Edit',
      action: 'Updated workspace files',
      status: 'running',
      progressCount: 0,
      latestUpdateKind: null,
      input: { secret: 'raw-input' },
      result: { secret: 'raw-result' },
      progress: 'raw-progress',
      error: 'raw-error',
      attachments: ['raw-attachment'],
      interaction: { secret: 'raw-interaction' },
    } as unknown as UnsequencedProjection);

    const serialized = JSON.stringify(state);
    expect(serialized).not.toContain('raw-');
    expect(state.transcript).toEqual([
      expect.objectContaining({
        kind: 'tool',
        toolName: 'Edit',
        status: 'running',
      }),
    ]);
  });

  it('attaches the SDK message id to the accepted prompt of a turn', () => {
    const base = appendAcceptedUserPrompt(
      createHostTranscriptState('complete'),
      'turn-1',
      'First question',
    );

    const attached = attachUserMessageId(base, 'turn-1', 'sdk-msg-1');
    expect(attached.transcript).toEqual([
      {
        id: stableTranscriptId('user', 'turn-1'),
        kind: 'user',
        text: 'First question',
        messageId: 'sdk-msg-1',
      },
    ]);

    expect(attachUserMessageId(attached, 'turn-1', 'sdk-msg-1')).toBe(
      attached,
    );
    expect(attachUserMessageId(base, 'turn-unknown', 'sdk-msg-1')).toBe(
      base,
    );
  });

  it('truncates the transcript from a rewound user message', () => {
    let state = appendAcceptedUserPrompt(
      createHostTranscriptState('complete'),
      'turn-1',
      'First question',
    );
    state = attachUserMessageId(state, 'turn-1', 'sdk-msg-1');
    state = project(state, {
      type: 'assistant.delta',
      sessionId: 'session-1',
      turnId: 'turn-1',
      delta: 'First answer',
    });
    state = appendAcceptedUserPrompt(state, 'turn-2', 'Second question');
    state = attachUserMessageId(state, 'turn-2', 'sdk-msg-2');
    state = project(state, {
      type: 'assistant.delta',
      sessionId: 'session-1',
      turnId: 'turn-2',
      delta: 'Second answer',
    });

    const truncated = truncateFromUserMessage(state, 'sdk-msg-2');
    expect(truncated?.transcript).toEqual([
      expect.objectContaining({
        kind: 'user',
        text: 'First question',
        messageId: 'sdk-msg-1',
      }),
      expect.objectContaining({
        kind: 'assistant',
        text: 'First answer',
      }),
    ]);

    const fromFirst = truncateFromUserMessage(state, 'sdk-msg-1');
    expect(fromFirst?.transcript).toEqual([]);
    expect(truncateFromUserMessage(state, 'sdk-msg-unknown')).toBeNull();
  });
});

function project(
  state: HostTranscriptState,
  message: UnsequencedProjection,
): HostTranscriptState {
  return projectHostTranscriptMessage(state, {
    ...message,
    sequence: 1,
  } as HostTranscriptProjectionMessage);
}

function statuses(state: HostTranscriptState): string[] {
  return state.transcript
    .filter(
      (
        item,
      ): item is Extract<
        SessionTranscriptItem,
        { kind: 'thinking' | 'tool' }
      > => item.kind === 'thinking' || item.kind === 'tool',
    )
    .map((item) => item.status);
}

type UnsequencedProjection =
  HostTranscriptProjectionMessage extends infer Message
    ? Message extends HostTranscriptProjectionMessage
      ? Omit<Message, 'sequence'>
      : never
    : never;
