import { describe, expect, it } from 'vitest';

import {
  MAX_ASSISTANT_TEXT_LENGTH,
  MAX_CHANGED_FILES_PER_TURN,
  MAX_IMAGES_PER_TURN,
  MAX_SESSION_TRANSCRIPT_ITEMS,
  type SessionTranscriptItem,
} from '../shared/bridgeMessages';
import { MAX_SESSION_IMAGE_DATA_UNITS } from '../shared/transcriptLimits';
import {
  appendAcceptedUserPrompt,
  appendTurnChanges,
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
      segmentIndex: 0,
    });
    state = project(state, {
      type: 'thinking.complete',
      sessionId: 'session-1',
      turnId: 'turn-1',
      durationMs: 25,
      segmentIndex: 0,
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
      relatedSessionId: 'session-0',
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
          relatedSessionId: 'session-0',
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
      segmentIndex: 0,
    });
    state = project(state, {
      type: 'thinking.complete',
      sessionId: 'session-1',
      turnId: 'turn-1',
      durationMs: 40,
      segmentIndex: 0,
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
      segmentIndex: 1,
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
      segmentIndex: 1,
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
    // Each segment keeps its own completion: no cross-segment
    // status sweep, no durationMs overwrite by the last segment.
    expect(
      state.transcript
        .filter((item) => item.kind === 'thinking')
        .map((item) => ({ status: item.status, durationMs: item.durationMs })),
    ).toEqual([
      { status: 'complete', durationMs: 40 },
      { status: 'complete', durationMs: 50 },
    ]);
    expect(new Set(state.transcript.map((item) => item.id)).size).toBe(
      state.transcript.length,
    );
  });

  it('routes segment deltas past interleaved rows and drops unknown completions', () => {
    let state = createHostTranscriptState('complete');
    state = project(state, {
      type: 'thinking.delta',
      sessionId: 'session-1',
      turnId: 'turn-1',
      delta: 'First',
      truncated: false,
      segmentIndex: 0,
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
    // A late delta for segment 0 keeps appending to its own row even
    // though a tool row landed after it.
    state = project(state, {
      type: 'thinking.delta',
      sessionId: 'session-1',
      turnId: 'turn-1',
      delta: ' thought',
      truncated: false,
      segmentIndex: 0,
    });
    // A completion for a segment that never projected text does not
    // fabricate an empty Thinking row.
    const unknownComplete = project(state, {
      type: 'thinking.complete',
      sessionId: 'session-1',
      turnId: 'turn-1',
      durationMs: 12,
      segmentIndex: 5,
    });

    expect(
      state.transcript.map((item) =>
        item.kind === 'tool' ? item.action : 'text' in item ? item.text : '',
      ),
    ).toEqual(['First thought', 'Read workspace files']);
    expect(unknownComplete).toBe(state);
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
      segmentIndex: 0,
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
      segmentIndex: 0,
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

  it('streams the execute output tail and keeps the final one on completion', () => {
    let state = createHostTranscriptState('complete');
    state = project(state, {
      type: 'tool.activity',
      sessionId: 'session-1',
      turnId: 'turn-1',
      toolUseId: 'tool-1',
      toolName: 'Execute',
      action: 'Ran a local command',
      status: 'running',
      progressCount: 1,
      latestUpdateKind: 'status',
      outputTail: 'line-1\nline-2',
    });
    expect(state.transcript[0]).toMatchObject({
      kind: 'tool',
      outputTail: 'line-1\nline-2',
    });
    // The completion update keeps the last projected tail.
    state = project(state, {
      type: 'tool.activity',
      sessionId: 'session-1',
      turnId: 'turn-1',
      toolUseId: 'tool-1',
      toolName: 'Execute',
      action: 'Ran a local command',
      status: 'completed',
      progressCount: 2,
      latestUpdateKind: 'status',
      durationMs: 40,
      outputTail: 'line-1\nline-2\nline-3',
    });

    expect(state.transcript).toEqual([
      expect.objectContaining({
        kind: 'tool',
        status: 'completed',
        outputTail: 'line-1\nline-2\nline-3',
      }),
    ]);
  });

  it('carries and settles a subagent summary across activity updates', () => {
    let state = createHostTranscriptState('complete');
    state = project(state, {
      type: 'tool.activity',
      sessionId: 'session-1',
      turnId: 'turn-1',
      toolUseId: 'task-1',
      toolName: 'Task',
      action: 'Delegated to a subagent',
      status: 'running',
      progressCount: 0,
      latestUpdateKind: null,
      subagent: {
        type: 'explore',
        description: 'Survey the auth module',
        status: 'running',
      },
    });
    // An update without the field keeps the recorded summary.
    state = project(state, {
      type: 'tool.activity',
      sessionId: 'session-1',
      turnId: 'turn-1',
      toolUseId: 'task-1',
      toolName: 'Task',
      action: 'Delegated to a subagent',
      status: 'completed',
      progressCount: 0,
      latestUpdateKind: null,
    });
    const kept = state.transcript[0];
    // Turn-end reconciliation replaces it with the ledger summary.
    state = project(state, {
      type: 'tool.activity',
      sessionId: 'session-1',
      turnId: 'turn-1',
      toolUseId: 'task-1',
      toolName: 'Task',
      action: 'Delegated to a subagent',
      status: 'completed',
      progressCount: 0,
      latestUpdateKind: null,
      subagent: {
        type: 'explore',
        description: 'Survey the auth module',
        status: 'completed',
        toolUseCount: 7,
        durationMs: 4_200,
      },
    });

    expect(kept).toEqual(
      expect.objectContaining({
        kind: 'tool',
        status: 'completed',
        subagent: {
          type: 'explore',
          description: 'Survey the auth module',
          status: 'running',
        },
      }),
    );
    expect(state.transcript).toEqual([
      expect.objectContaining({
        kind: 'tool',
        status: 'completed',
        subagent: {
          type: 'explore',
          description: 'Survey the auth module',
          status: 'completed',
          toolUseCount: 7,
          durationMs: 4_200,
        },
      }),
    ]);
  });

  it('appends a bounded per-turn changes summary exactly once', () => {
    let state = appendAcceptedUserPrompt(
      createHostTranscriptState('complete'),
      'turn-1',
      'Change files',
    );
    const files = [
      { path: 'src/app.ts', additions: 3, deletions: 1 },
      { path: 'docs/new.md', additions: null, deletions: null },
    ];
    state = appendTurnChanges(state, 'turn-1', files);
    expect(state.transcript.at(-1)).toEqual({
      id: stableTranscriptId('changes', 'turn-1'),
      kind: 'changes',
      turnId: 'turn-1',
      files,
    });

    // Repeated publication and empty lists are no-ops.
    expect(appendTurnChanges(state, 'turn-1', files)).toBe(state);
    expect(appendTurnChanges(state, 'turn-2', [])).toBe(state);

    // Oversized lists are clipped to the bridge bound.
    const oversized = Array.from(
      { length: MAX_CHANGED_FILES_PER_TURN + 5 },
      (_, index) => ({
        path: `src/file-${index}.ts`,
        additions: index,
        deletions: 0,
      }),
    );
    const clipped = appendTurnChanges(state, 'turn-2', oversized);
    const changes = clipped.transcript.at(-1);
    expect(changes?.kind).toBe('changes');
    expect(
      changes?.kind === 'changes' ? changes.files : [],
    ).toHaveLength(MAX_CHANGED_FILES_PER_TURN);
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

  it('carries sent-attachment metadata on the accepted prompt', () => {
    const attachments = [
      { kind: 'text' as const, name: 'notes.md', sizeBytes: 120 },
    ];
    const state = appendAcceptedUserPrompt(
      createHostTranscriptState('complete'),
      'turn-1',
      'With chips',
      attachments,
    );
    expect(state.transcript).toEqual([
      {
        id: stableTranscriptId('user', 'turn-1'),
        kind: 'user',
        text: 'With chips',
        attachments,
      },
    ]);

    // Empty metadata omits the field entirely.
    const bare = appendAcceptedUserPrompt(
      createHostTranscriptState('complete'),
      'turn-2',
      'No chips',
      [],
    );
    expect(bare.transcript[0]).not.toHaveProperty('attachments');
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

  it('appends image items once, capped per turn, and evicts old bytes', () => {
    const imageMessage = (id: string, data: string) =>
      ({
        type: 'transcript.image',
        sessionId: 'session-1',
        turnId: 'turn-1',
        item: {
          id,
          kind: 'image',
          turnId: 'turn-1',
          origin: 'tool-result',
          mediaType: 'image/png',
          data,
          generated: false,
          byteLength: Math.floor((data.length * 3) / 4),
        },
      }) as const;

    let state = appendAcceptedUserPrompt(
      createHostTranscriptState('complete'),
      'turn-1',
      'Take screenshots',
    );
    state = project(state, imageMessage('image-1', 'aGVsbG8='));
    // Same id is idempotent; mismatched turn ids are dropped.
    state = project(state, imageMessage('image-1', 'aGVsbG8='));
    state = project(state, {
      ...imageMessage('image-mismatch', 'aGVsbG8='),
      turnId: 'turn-2',
    });
    expect(
      state.transcript.filter((item) => item.kind === 'image'),
    ).toHaveLength(1);
    expect(state.truncated).toBe(false);

    for (let index = 2; index <= MAX_IMAGES_PER_TURN + 2; index += 1) {
      state = project(state, imageMessage(`image-${index}`, 'aGVsbG8='));
    }
    expect(
      state.transcript.filter((item) => item.kind === 'image'),
    ).toHaveLength(MAX_IMAGES_PER_TURN);
    expect(state.truncated).toBe(true);
    expect(state.historyStatus).toBe('partial');
  });

  it('drops the oldest image bytes when the session image budget overflows', () => {
    const bigData = 'A'.repeat(2_800_000);
    let state = createHostTranscriptState('complete');
    const turns = Math.ceil(MAX_SESSION_IMAGE_DATA_UNITS / bigData.length) + 1;
    for (let turn = 1; turn <= turns; turn += 1) {
      state = appendAcceptedUserPrompt(
        state,
        `turn-${turn}`,
        `Screenshot ${turn}`,
      );
      state = project(state, {
        type: 'transcript.image',
        sessionId: 'session-1',
        turnId: `turn-${turn}`,
        item: {
          id: `image-${turn}`,
          kind: 'image',
          turnId: `turn-${turn}`,
          origin: 'tool-result',
          mediaType: 'image/png',
          data: bigData,
          generated: false,
          byteLength: 2_100_000,
        },
      });
    }

    const images = state.transcript.filter(
      (item): item is Extract<SessionTranscriptItem, { kind: 'image' }> =>
        item.kind === 'image',
    );
    expect(images).toHaveLength(turns);
    expect(images[0]?.data).toBe('');
    expect(images[0]?.byteLength).toBe(2_100_000);
    expect(images.at(-1)?.data).toBe(bigData);
    // Byte eviction alone leaves the history complete: the rows remain.
    expect(state.historyStatus).toBe('complete');
    expect(state.truncated).toBe(false);
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
