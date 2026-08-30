import { describe, expect, it } from 'vitest';

import type { SessionTranscriptItem } from '../shared/bridgeMessages';
import type { HostTranscriptState } from '../shared/hostTranscriptState';
import {
  realShapeLoaded,
  realShapeRecovered,
} from './__fixtures__/reconcileRealSession';
import { reconcileSessionHistory } from './reconcileSessionHistory';

describe('reconcileSessionHistory', () => {
  it('deduplicates matching AskUser results across history and recovery IDs', () => {
    const loaded = state([
      user('sdk-user', 'Choose'),
      {
        id: 'sdk-result',
        kind: 'ask-user-result',
        turnId: 'sdk-turn',
        status: 'answered',
        answers: [{ topic: 'Library', answer: 'React' }],
      },
    ]);
    const recovered = state([
      user('cached-user', 'Choose'),
      {
        id: 'cached-result',
        kind: 'ask-user-result',
        turnId: 'cached-turn',
        status: 'answered',
        answers: [{ topic: 'Library', answer: 'React' }],
      },
    ]);

    expect(reconcileSessionHistory(loaded, recovered)).toBe(loaded);
  });

  it('keeps a recovered prefix when public SDK history is a compacted suffix', () => {
    // 'Recent prompt' is a unique-text anchor on both sides, so the
    // anchored path applies: loaded is the authoritative body and the
    // recovered-only prefix is prepended in front of it.
    const recovered = state([
      user('cached-a', 'Old prompt'),
      assistant('cached-b', 'Old answer'),
      user('cached-c', 'Recent prompt'),
      assistant('cached-d', 'Recent answer'),
    ]);
    const loaded = state([
      user('sdk-c', 'Recent prompt'),
      assistant('sdk-d', 'Recent answer'),
    ]);

    expect(reconcileSessionHistory(loaded, recovered)).toEqual({
      transcript: [
        recovered.transcript[0],
        recovered.transcript[1],
        ...loaded.transcript,
      ],
      historyStatus: 'partial',
      truncated: false,
    });
  });

  it('uses complete public history when it extends the recovered prefix', () => {
    const recovered = state([
      user('cached-a', 'Old prompt'),
      assistant('cached-b', 'Old answer'),
    ]);
    const loaded = state([
      user('sdk-a', 'Old prompt'),
      assistant('sdk-b', 'Old answer'),
      user('sdk-c', 'Recent prompt'),
    ]);

    expect(reconcileSessionHistory(loaded, recovered)).toBe(loaded);
  });

  it('uses complete public history when recovery retained only its suffix', () => {
    const loaded = state([
      user('sdk-a', 'Old prompt'),
      assistant('sdk-b', 'Old answer'),
      user('sdk-c', 'Recent prompt'),
    ]);
    const recovered = state([
      assistant('cached-b', 'Old answer'),
      user('cached-c', 'Recent prompt'),
    ]);

    expect(reconcileSessionHistory(loaded, recovered)).toBe(loaded);
  });

  it('adopts recovered sent-attachment chips onto matched loaded anchors', () => {
    const chips = [
      { kind: 'text' as const, name: 'notes.md', sizeBytes: 42 },
    ];
    const recovered = state([
      {
        ...anchored('cached-a', 'Prompt with chips', 'sdk-msg-1'),
        attachments: chips,
      },
      assistant('cached-b', 'Answer'),
    ]);
    // Loaded history cannot reconstruct chip metadata, so the matched
    // anchor adopts it from the recovered checkpoint.
    const loaded = state([
      anchored('sdk-a', 'Prompt with chips', 'sdk-msg-1'),
      assistant('sdk-b', 'Answer'),
      user('sdk-c', 'Later prompt'),
    ]);

    const merged = reconcileSessionHistory(loaded, recovered, {
      authoritativeLoaded: true,
    });
    expect(merged.transcript[0]).toEqual({
      ...loaded.transcript[0],
      attachments: chips,
    });
    expect(merged.transcript.slice(1)).toEqual(
      loaded.transcript.slice(1),
    );
  });

  it('keeps disconnected recovery before authoritative complete history', () => {
    const recovered = state([user('cached', 'Locally observed prompt')]);
    const loaded = state([user('sdk', 'Public SDK prompt')]);

    expect(reconcileSessionHistory(loaded, recovered)).toEqual({
      transcript: [...recovered.transcript, ...loaded.transcript],
      historyStatus: 'partial',
      truncated: false,
    });
  });

  it('uses complete daemon history alone during startup recovery', () => {
    const recovered = state([
      user('cached-u', 'Stale local branch'),
      assistant('cached-a', 'Stale local answer'),
    ]);
    const loaded = state([
      user('sdk-u', 'Durable daemon prompt'),
      assistant('sdk-a', 'Durable daemon answer'),
    ]);

    expect(
      reconcileSessionHistory(loaded, recovered, {
        authoritativeLoaded: true,
      }),
    ).toBe(loaded);
  });

  it('uses an empty complete daemon history over a stale checkpoint', () => {
    const recovered = state([
      user('cached-u', 'Stale checkpoint prompt'),
      assistant('cached-a', 'Stale checkpoint answer'),
    ]);
    const loaded = state([]);

    expect(
      reconcileSessionHistory(loaded, recovered, {
        authoritativeLoaded: true,
      }),
    ).toBe(loaded);
  });

  it('retains recovery evidence when startup daemon history is genuinely partial', () => {
    const recovered = state([
      user('cached-old-u', 'Older prompt'),
      assistant('cached-old-a', 'Older answer'),
      anchored('cached-shared-u', 'Shared prompt', 'shared-mid'),
      assistant('cached-shared-a', 'Shared answer'),
    ]);
    const loaded: HostTranscriptState = {
      ...state([
        anchored('sdk-shared-u', 'Shared prompt', 'shared-mid'),
        assistant('sdk-shared-a', 'Shared answer'),
      ]),
      historyStatus: 'partial',
    };

    expect(
      reconcileSessionHistory(loaded, recovered, {
        authoritativeLoaded: true,
      }),
    ).toEqual({
      transcript: [
        recovered.transcript[0],
        recovered.transcript[1],
        ...loaded.transcript,
      ],
      historyStatus: 'partial',
      truncated: false,
    });
  });

  it('does not append a stale checkpoint tail behind a truncated daemon tail', () => {
    const recovered = state([
      anchored('cached-shared-u', 'Shared prompt', 'shared-mid'),
      assistant('cached-shared-a', 'Shared answer'),
      user('cached-local-u', '你好'),
      assistant('cached-stale-a', 'Old answer from another turn'),
    ]);
    const loaded: HostTranscriptState = {
      ...state([
        anchored('sdk-shared-u', 'Shared prompt', 'shared-mid'),
        assistant('sdk-shared-a', 'Shared answer'),
        user(
          'sdk-current-u',
          '这个版本号问题应该优先看后端有没有修复？',
        ),
      ]),
      historyStatus: 'partial',
      truncated: true,
    };

    expect(
      reconcileSessionHistory(loaded, recovered, {
        authoritativeLoaded: true,
      }),
    ).toBe(loaded);
  });

  it('does not let a stale disconnected checkpoint hide loaded changes', () => {
    const recovered = state([
      user('cached-u', 'Older local prompt'),
      assistant('cached-a', 'Older local answer'),
    ]);
    const loaded = state([
      user('sdk-u', 'Current daemon prompt'),
      changes('sdk-c', 'current-turn', ['src/current.ts']),
      assistant('sdk-a', 'Current daemon answer'),
    ]);

    const result = reconcileSessionHistory(loaded, recovered);
    expect(result.transcript).toEqual([
      ...recovered.transcript,
      ...loaded.transcript,
    ]);
    const kinds = result.transcript.map((item) => item.kind);
    const lastUser = kinds.lastIndexOf('user');
    const lastChanges = kinds.lastIndexOf('changes');
    expect(lastChanges).toBeGreaterThan(lastUser);
  });

  it('uniquifies duplicated toolUseIds when both merge sides kept a copy', () => {
    // A recovered checkpoint persisted from an earlier reconcile carries
    // the same synthesized toolUseIds as a fresh history projection of
    // the same session. When overlap matching fails, both copies survive
    // and duplicate toolCallIds crash the webview renderer.
    const recovered = state([
      user('cached-u', 'Different cached prompt'),
      tool('cached-t', 'turn-x', 'tool-dupe'),
    ]);
    const loaded = state([
      user('sdk-u', 'Different loaded prompt'),
      tool('sdk-t', 'turn-x', 'tool-dupe'),
    ]);

    const result = reconcileSessionHistory(loaded, recovered);
    const toolUseIds = result.transcript
      .filter((item) => item.kind === 'tool')
      .map((item) => (item as { toolUseId: string }).toolUseId);
    expect(toolUseIds).toHaveLength(2);
    expect(new Set(toolUseIds).size).toBe(2);
    expect(toolUseIds).toContain('tool-dupe');
  });

  it('merges a recovered image placeholder with its fully loaded copy', () => {
    // The checkpoint persists images as placeholders (empty data); the
    // loaded history carries the bytes. Their merge keys ignore `data`,
    // so the trailing placeholder is recognized as the same image and
    // only the loaded copy survives.
    const recovered = state([
      anchored('r-u1', 'Take a screenshot', 'mid-1'),
      image('r-i1', 'turn-1', ''),
    ]);
    const loaded = state([
      anchored('l-u1', 'Take a screenshot', 'mid-1'),
      image('l-i1', 'turn-1', 'c2NyZWVu'),
    ]);

    const result = reconcileSessionHistory(loaded, recovered);
    expect(result).toBe(loaded);
    expect(
      result.transcript.filter((item) => item.kind === 'image'),
    ).toHaveLength(1);
    expect(result.transcript[1]).toMatchObject({ data: 'c2NyZWVu' });
  });

  it('preserves an actual source truncation independently from partial history', () => {
    const recovered = {
      ...state([user('cached', 'Locally observed prompt')]),
      historyStatus: 'partial' as const,
      truncated: true,
    };
    const loaded = state([user('sdk', 'Public SDK prompt')]);

    expect(reconcileSessionHistory(loaded, recovered)).toEqual({
      transcript: [...recovered.transcript, ...loaded.transcript],
      historyStatus: 'partial',
      truncated: true,
    });
  });

  describe('user messageId anchor alignment', () => {
    it('returns loaded as-is when all anchors match and loaded has synthesized inserts', () => {
      const recovered = state([
        anchored('r-u1', 'Question one', 'mid-1'),
        thinking('r-t1', 'turn-1', 'Streamed thinking, cut short'),
        assistant('r-a1', 'Answer one'),
        anchored('r-u2', 'Question two', 'mid-2'),
        assistant('r-a2', 'Answer two'),
      ]);
      const loaded = state([
        anchored('l-u1', 'Question one', 'mid-1'),
        thinking('l-t1', 'turn-1', 'Streamed thinking, cut short plus a persisted tail'),
        changes('l-c1', 'turn-1', ['src/app.ts']),
        assistant('l-a1', 'Answer one'),
        anchored('l-u2', 'Question two', 'mid-2'),
        thinking('l-t2', 'turn-2', 'Post-permission follow-up thinking'),
        assistant('l-a2', 'Answer two'),
      ]);

      const result = reconcileSessionHistory(loaded, recovered);
      expect(result).toBe(loaded);
      expect(result.historyStatus).toBe('complete');
    });

    it('drops a stale rewind prefix when loaded has a newer turn', () => {
      const recovered = state([
        anchored('r-u0', 'Original question', 'mid-0'),
        assistant('r-a0', 'Original answer'),
        anchored('r-u1', 'Resent question', 'mid-1'),
        assistant('r-a1', 'Branch answer'),
      ]);
      const loaded = state([
        anchored('l-u1', 'Resent question', 'mid-1'),
        assistant('l-a1', 'Branch answer'),
        anchored('l-u2', 'Follow-up', 'mid-2'),
        assistant('l-a2', 'Follow-up answer'),
      ]);

      expect(reconcileSessionHistory(loaded, recovered)).toBe(loaded);
    });

    it('drops the unmatched resend residue that repeats the first loaded anchor text', () => {
      const recovered = state([
        anchored('r-dup', 'Tell me a story', 'mid-stale'),
        anchored('r-u1', 'Tell me a story', 'mid-1'),
        assistant('r-a1', 'Story answer'),
      ]);
      const loaded = state([
        anchored('l-u1', 'Tell me a story', 'mid-1'),
        assistant('l-a1', 'Story answer'),
      ]);

      expect(reconcileSessionHistory(loaded, recovered)).toBe(loaded);
    });

    it('shows drifted thinking text once, preferring the loaded version', () => {
      const recovered = state([
        anchored('r-u1', 'Question', 'mid-1'),
        thinking('r-t1', 'turn-1', 'T'.repeat(29_534)),
        assistant('r-a1', 'Answer'),
      ]);
      const loaded = state([
        anchored('l-u1', 'Question', 'mid-1'),
        thinking('l-t1', 'turn-1', 'T'.repeat(31_421)),
        assistant('l-a1', 'Answer'),
      ]);

      const result = reconcileSessionHistory(loaded, recovered);
      expect(result).toBe(loaded);
      expect(
        result.transcript.filter((item) => item.kind === 'thinking'),
      ).toHaveLength(1);
    });

    it('appends the recovered turn the CLI never persisted', () => {
      const recovered = state([
        anchored('r-u1', 'Question one', 'mid-1'),
        assistant('r-a1', 'Answer one'),
        anchored('r-u2', 'Question two', 'mid-2'),
        assistant('r-a2', 'Answer streamed before the crash'),
      ]);
      const loaded = state([
        anchored('l-u1', 'Question one', 'mid-1'),
        assistant('l-a1', 'Answer one'),
        anchored('l-u2', 'Question two', 'mid-2'),
      ]);

      expect(
        reconcileSessionHistory(loaded, recovered, {
          authoritativeLoaded: true,
        }),
      ).toEqual({
        transcript: [...loaded.transcript, recovered.transcript[3]],
        historyStatus: 'partial',
        truncated: false,
      });
    });

    it('appends recovered whole turns missing from the persisted history', () => {
      const recovered = state([
        anchored('r-u1', 'Question one', 'mid-1'),
        assistant('r-a1', 'Answer one'),
        anchored('r-u2', 'Question two', 'mid-2'),
        assistant('r-a2', 'Answer two'),
      ]);
      const loaded = state([
        anchored('l-u1', 'Question one', 'mid-1'),
        assistant('l-a1', 'Answer one'),
      ]);

      expect(reconcileSessionHistory(loaded, recovered)).toEqual({
        transcript: [
          ...loaded.transcript,
          recovered.transcript[2],
          recovered.transcript[3],
        ],
        historyStatus: 'partial',
        truncated: false,
      });
    });

    it('drops the stale recovered tail when loaded already has newer turns', () => {
      const recovered = state([
        anchored('r-u1', 'Question one', 'mid-1'),
        assistant('r-a1', 'Answer one'),
        anchored('r-u2', 'Question never persisted', 'mid-stale'),
        assistant('r-a2', 'Stale streamed answer'),
      ]);
      const loaded = state([
        anchored('l-u1', 'Question one', 'mid-1'),
        assistant('l-a1', 'Answer one'),
        anchored('l-u2', 'Newer question', 'mid-2'),
        assistant('l-a2', 'Newer answer'),
      ]);

      expect(reconcileSessionHistory(loaded, recovered)).toBe(loaded);
    });

    it('keeps the live local tail during a background history refresh', () => {
      // Reload/background-sync race: the history read started with Q1,
      // then daemon history returned Q2 while the current window had
      // already accepted Q3. The live Host transcript is authoritative
      // for its unknown tail; replacing it with the older read must not
      // make the just-sent exchange disappear.
      const recovered = state([
        anchored('r-u1', 'Question one', 'mid-1'),
        assistant('r-a1', 'Answer one'),
        user('r-u3', 'Question sent in this window'),
        assistant('r-a3', 'Fresh streamed answer'),
      ]);
      const loaded = state([
        anchored('l-u1', 'Question one', 'mid-1'),
        assistant('l-a1', 'Answer one'),
        anchored('l-u2', 'Daemon history arrived late', 'mid-2'),
        assistant('l-a2', 'Older persisted answer'),
      ]);

      expect(
        reconcileSessionHistory(loaded, recovered, {
          preserveLocalTail: true,
        }),
      ).toEqual({
        transcript: [
          ...loaded.transcript,
          recovered.transcript[2],
          recovered.transcript[3],
        ],
        historyStatus: 'partial',
        truncated: false,
      });
    });

    it('skips stale duplicate trailing turns but keeps the genuinely new one', () => {
      // A checkpoint written while the old concatenating merge was
      // active repeats already-loaded turns after the last anchor; the
      // crash turn that follows them must still be appended.
      const recovered = state([
        anchored('r-u1', 'Question one', 'mid-1'),
        assistant('r-a1', 'Answer one'),
        anchored('r-u2', 'Question two', 'mid-2'),
        assistant('r-a2', 'Answer two'),
        anchored('r-dup-u1', 'Question one', 'mid-1'),
        assistant('r-dup-a1', 'Answer one'),
        anchored('r-u3', 'Question never persisted', 'mid-3'),
        assistant('r-a3', 'Answer streamed before the crash'),
      ]);
      const loaded = state([
        anchored('l-u1', 'Question one', 'mid-1'),
        assistant('l-a1', 'Answer one'),
        anchored('l-u2', 'Question two', 'mid-2'),
        assistant('l-a2', 'Answer two'),
      ]);

      expect(reconcileSessionHistory(loaded, recovered)).toEqual({
        transcript: [
          ...loaded.transcript,
          recovered.transcript[6],
          recovered.transcript[7],
        ],
        historyStatus: 'partial',
        truncated: false,
      });
    });

    it('does not resurrect a checkpoint poisoned by the old concatenating merge', () => {
      // Real recovery shape from the diagnostics log (recovered:151,
      // loaded:75, reconciled:134 before this fix): the checkpoint
      // carries a rewind-branch prefix plus the whole conversation
      // twice because it was persisted from a doubled merge result.
      // Everything after the last matched anchor repeats known
      // anchors, so only the prefix may survive.
      const loadedBody = poisonedShapeTurns('l');
      const loaded = state(loadedBody);
      const recovered = state([
        anchored('r-branch-u', 'Rewound branch question', 'mid-branch'),
        assistant('r-branch-a', 'Rewound branch answer'),
        ...poisonedShapeTurns('r-one'),
        ...poisonedShapeTurns('r-two').slice(0, -1),
      ]);
      expect(loaded.transcript).toHaveLength(75);
      expect(recovered.transcript).toHaveLength(151);

      const result = reconcileSessionHistory(loaded, recovered);

      // Loaded body plus the two-item rewind-branch prefix only.
      expect(result.transcript).toHaveLength(77);
      expect(result.transcript.slice(2)).toEqual(loadedBody);
      expect(result.historyStatus).toBe('partial');

      const messageIds = result.transcript
        .filter((item) => item.kind === 'user')
        .map((item) => (item as { messageId?: string }).messageId)
        .filter((id): id is string => id !== undefined);
      expect(new Set(messageIds).size).toBe(messageIds.length);

      const toolUseIds = result.transcript
        .filter((item) => item.kind === 'tool')
        .map((item) => (item as { toolUseId: string }).toolUseId);
      expect(new Set(toolUseIds).size).toBe(toolUseIds.length);
    });

    it('does not anchor on duplicated text when messageIds are absent', () => {
      // Two identical user texts on the recovered side disqualify the
      // text fallback, so the legacy overlap path applies.
      const recovered = state([
        user('r-u1', 'Same question'),
        user('r-u2', 'Same question'),
      ]);
      const loaded = state([
        user('l-u1', 'Same question'),
        assistant('l-a1', 'Answer'),
      ]);

      expect(reconcileSessionHistory(loaded, recovered)).toEqual({
        transcript: [
          recovered.transcript[0],
          recovered.transcript[1],
          loaded.transcript[1],
        ],
        historyStatus: 'partial',
        truncated: false,
      });
    });

    it('reconciles the real crash-shape fixture without duplicating content', () => {
      // Sanitized 72/78 fixture of session 40ebe83d: the legacy
      // overlap match returned 0 and concatenated both sides into 150
      // items, repeating the whole conversation.
      const recovered = state(realShapeRecovered);
      const loaded = state(realShapeLoaded);

      const result = reconcileSessionHistory(loaded, recovered);

      // Loaded already advanced past the final shared anchor, so the
      // recovered rewind branch is stale UI state, not current daemon
      // history. Keeping it would create phantom dialogue on Reload.
      expect(result).toBe(loaded);
      expect(result.transcript).toHaveLength(realShapeLoaded.length);
      expect(result.historyStatus).toBe('complete');

      const messageIds = result.transcript
        .filter((item) => item.kind === 'user')
        .map((item) => (item as { messageId?: string }).messageId)
        .filter((id): id is string => id !== undefined);
      expect(new Set(messageIds).size).toBe(messageIds.length);

      const toolUseIds = result.transcript
        .filter((item) => item.kind === 'tool')
        .map((item) => (item as { toolUseId: string }).toolUseId);
      expect(new Set(toolUseIds).size).toBe(toolUseIds.length);

      expect(result.transcript).toEqual(realShapeLoaded);
    });

    it('keeps the logged 73/72 startup shape at 72 complete items', () => {
      const daemonBody = realShapeLoaded.slice(0, 72);
      const recovered = state([
        user('cached-stale-u', 'Stale checkpoint-only prompt'),
        ...daemonBody,
      ]);
      const loaded = state(daemonBody);
      expect(recovered.transcript).toHaveLength(73);
      expect(loaded.transcript).toHaveLength(72);

      const result = reconcileSessionHistory(loaded, recovered, {
        authoritativeLoaded: true,
      });

      expect(result).toBe(loaded);
      expect(result.transcript).toHaveLength(72);
      expect(result.historyStatus).toBe('complete');
    });
  });
});

describe('recovered rich-state enrichment (bug #36)', () => {
  function richTool(
    id: string,
    turnId: string,
    toolUseId: string,
    overrides: Partial<
      Extract<SessionTranscriptItem, { kind: 'tool' }>
    > = {},
  ): Extract<SessionTranscriptItem, { kind: 'tool' }> {
    return { ...tool(id, turnId, toolUseId), ...overrides };
  }

  it('merges outputTail and durationMs onto matched loaded tool rows', () => {
    const recovered = state([
      anchored('cached-u', 'Run the build', 'mid-1'),
      richTool('cached-t', 'live-turn', 'live-use', {
        toolName: 'Execute',
        detail: 'pnpm run build',
        outputTail: 'Build OK in 3.2s',
        durationMs: 3200,
        status: 'completed',
      }),
      assistant('cached-a', 'Done'),
    ]);
    const loaded = state([
      anchored('sdk-u', 'Run the build', 'mid-1'),
      richTool('sdk-t', 'history-turn', 'history-use', {
        toolName: 'Execute',
        detail: 'pnpm run build',
        status: 'completed',
      }),
      assistant('sdk-a', 'Done'),
    ]);

    const merged = reconcileSessionHistory(loaded, recovered, {
      authoritativeLoaded: true,
    });
    expect(merged.historyStatus).toBe('complete');
    expect(merged.transcript).toHaveLength(3);
    expect(merged.transcript[1]).toEqual({
      ...loaded.transcript[1],
      outputTail: 'Build OK in 3.2s',
      durationMs: 3200,
    });
  });

  it('pairs repeated same-name tools by detail before falling back', () => {
    const recovered = state([
      anchored('cached-u', 'Run both', 'mid-1'),
      richTool('cached-t1', 'live-turn', 'live-1', {
        toolName: 'Execute',
        detail: 'npm test',
        outputTail: 'tests passed',
      }),
      richTool('cached-t2', 'live-turn', 'live-2', {
        toolName: 'Execute',
        detail: 'npm run lint',
        outputTail: 'lint clean',
      }),
    ]);
    // Loaded persisted the two calls in the opposite order.
    const loaded = state([
      anchored('sdk-u', 'Run both', 'mid-1'),
      richTool('sdk-t1', 'history-turn', 'hist-1', {
        toolName: 'Execute',
        detail: 'npm run lint',
      }),
      richTool('sdk-t2', 'history-turn', 'hist-2', {
        toolName: 'Execute',
        detail: 'npm test',
      }),
    ]);

    const merged = reconcileSessionHistory(loaded, recovered);
    expect(
      merged.transcript.map((item) =>
        item.kind === 'tool' ? item.outputTail : undefined,
      ),
    ).toEqual([undefined, 'lint clean', 'tests passed']);
  });

  it('never overwrites loaded tool fields that already exist', () => {
    const recovered = state([
      anchored('cached-u', 'Prompt', 'mid-1'),
      richTool('cached-t', 'live-turn', 'live-use', {
        outputTail: 'stale tail',
        durationMs: 99,
      }),
    ]);
    const loaded = state([
      anchored('sdk-u', 'Prompt', 'mid-1'),
      richTool('sdk-t', 'history-turn', 'hist-use', {
        outputTail: 'authoritative tail',
        durationMs: 5,
      }),
    ]);

    const merged = reconcileSessionHistory(loaded, recovered);
    expect(merged.transcript[1]).toBe(loaded.transcript[1]);
  });

  it('restores the complete recovered changes list on Reload', () => {
    const recovered = state([
      anchored('cached-u', 'Edit files', 'mid-1'),
      {
        ...changes('cached-c', 'live-turn', ['src/a.ts']),
        files: [
          { path: 'src/a.ts', additions: 12, deletions: 3 },
          { path: 'src/gone.ts', additions: 1, deletions: 1 },
        ],
      },
    ]);
    const loaded = state([
      anchored('sdk-u', 'Edit files', 'mid-1'),
      {
        ...changes('sdk-c', 'history-turn', []),
        files: [
          { path: 'src/a.ts', additions: null, deletions: null },
          { path: 'src/b.ts', additions: null, deletions: null },
        ],
      },
    ]);

    const merged = reconcileSessionHistory(loaded, recovered);
    const row = merged.transcript[1];
    expect(row?.kind).toBe('changes');
    if (row?.kind !== 'changes') {
      return;
    }
    expect(row.files).toEqual([
      { path: 'src/a.ts', additions: 12, deletions: 3 },
      { path: 'src/gone.ts', additions: 1, deletions: 1 },
      { path: 'src/b.ts', additions: null, deletions: null },
    ]);
  });

  it('re-inserts recovered diagnostics at the end of their turn', () => {
    const diagnostic: SessionTranscriptItem = {
      id: 'diagnostic:42',
      kind: 'diagnostic',
      turnId: 'live-turn',
      severity: 'warning',
      code: 'tool-failed',
      message: 'The command exited with code 1.',
    };
    const recovered = state([
      anchored('cached-u1', 'First prompt', 'mid-1'),
      diagnostic,
      anchored('cached-u2', 'Second prompt', 'mid-2'),
      assistant('cached-a2', 'Second answer'),
    ]);
    const loaded = state([
      anchored('sdk-u1', 'First prompt', 'mid-1'),
      assistant('sdk-a1', 'First answer'),
      anchored('sdk-u2', 'Second prompt', 'mid-2'),
      assistant('sdk-a2', 'Second answer'),
    ]);

    const merged = reconcileSessionHistory(loaded, recovered);
    expect(merged.transcript.map((item) => item.kind)).toEqual([
      'user',
      'assistant',
      'diagnostic',
      'user',
      'assistant',
    ]);
    // Re-homed to the loaded turn so grouping stays coherent.
    expect(merged.transcript[2]).toEqual({
      ...diagnostic,
      turnId: (
        loaded.transcript[1] as { turnId: string }
      ).turnId,
    });
    // Carrying a synthetic diagnostic row alone does not demote an
    // otherwise complete history.
    expect(merged.historyStatus).toBe('complete');
  });

  it('does not duplicate diagnostics already present in the segment', () => {
    const diagnostic: SessionTranscriptItem = {
      id: 'diagnostic:7',
      kind: 'diagnostic',
      turnId: 'live-turn',
      severity: 'warning',
      code: 'tool-failed',
      message: 'Duplicate candidate.',
    };
    const recovered = state([
      anchored('cached-u', 'Prompt', 'mid-1'),
      diagnostic,
      { ...diagnostic, id: 'diagnostic:8' },
    ]);
    const loaded = state([
      anchored('sdk-u', 'Prompt', 'mid-1'),
      assistant('sdk-a', 'Answer'),
    ]);

    const merged = reconcileSessionHistory(loaded, recovered);
    expect(
      merged.transcript.filter((item) => item.kind === 'diagnostic'),
    ).toHaveLength(1);
  });

  it('does not enrich across misaligned anchors', () => {
    // The recovered tail turn has no matching loaded anchor: its rich
    // rows must not bleed into the previous matched segment.
    const recovered = state([
      anchored('cached-u1', 'Shared prompt', 'mid-1'),
      richTool('cached-t1', 'live-1', 'live-use-1', {
        toolName: 'Read',
      }),
      user('cached-u2', 'Unshared prompt'),
      richTool('cached-t2', 'live-2', 'live-use-2', {
        toolName: 'Execute',
        outputTail: 'should stay in its own turn',
      }),
    ]);
    const loaded = state([
      anchored('sdk-u1', 'Shared prompt', 'mid-1'),
      richTool('sdk-t1', 'hist-1', 'hist-use-1', {
        toolName: 'Execute',
      }),
      anchored('sdk-u2', 'Loaded-only prompt', 'mid-9'),
    ]);

    const merged = reconcileSessionHistory(loaded, recovered);
    const enrichedTool = merged.transcript.find(
      (item) => item.kind === 'tool' && item.id === 'sdk-t1',
    );
    expect(
      (enrichedTool as { outputTail?: string }).outputTail,
    ).toBeUndefined();
  });
});

/**
 * Fifteen five-item turns (user, thinking, tool, assistant, changes)
 * mirroring the sanitized shape of the poisoned real checkpoint. Ids
 * vary per copy; messageIds and toolUseIds are the session-stable
 * values shared by every copy of the conversation.
 */
function poisonedShapeTurns(
  idPrefix: string,
): readonly SessionTranscriptItem[] {
  const items: SessionTranscriptItem[] = [];
  for (let turn = 1; turn <= 15; turn += 1) {
    items.push(
      anchored(`${idPrefix}-u${turn}`, `Prompt ${turn}`, `mid-${turn}`),
      thinking(`${idPrefix}-th${turn}`, `turn-${turn}`, `Thinking ${turn}`),
      tool(`${idPrefix}-t${turn}`, `turn-${turn}`, `tool-use-${turn}`),
      assistant(`${idPrefix}-a${turn}`, `Answer ${turn}`),
      changes(`${idPrefix}-c${turn}`, `turn-${turn}`, [`src/file${turn}.ts`]),
    );
  }
  return items;
}

function state(
  transcript: readonly SessionTranscriptItem[],
): HostTranscriptState {
  return {
    transcript,
    historyStatus: 'complete',
    truncated: false,
  };
}

function user(
  id: string,
  text: string,
): Extract<SessionTranscriptItem, { kind: 'user' }> {
  return { id, kind: 'user', text };
}

function anchored(
  id: string,
  text: string,
  messageId: string,
): Extract<SessionTranscriptItem, { kind: 'user' }> {
  return { id, kind: 'user', text, messageId };
}

function thinking(
  id: string,
  turnId: string,
  text: string,
): Extract<SessionTranscriptItem, { kind: 'thinking' }> {
  return {
    id,
    kind: 'thinking',
    turnId,
    text,
    status: 'stopped',
    truncated: false,
  };
}

function changes(
  id: string,
  turnId: string,
  paths: readonly string[],
): Extract<SessionTranscriptItem, { kind: 'changes' }> {
  return {
    id,
    kind: 'changes',
    turnId,
    files: paths.map((path) => ({
      path,
      additions: 1,
      deletions: 0,
    })),
  };
}

function assistant(
  id: string,
  text: string,
): Extract<SessionTranscriptItem, { kind: 'assistant' }> {
  return {
    id,
    kind: 'assistant',
    turnId: `${id}-turn`,
    text,
  };
}

function image(
  id: string,
  turnId: string,
  data: string,
): Extract<SessionTranscriptItem, { kind: 'image' }> {
  return {
    id,
    kind: 'image',
    turnId,
    origin: 'tool-result',
    mediaType: 'image/png',
    data,
    generated: false,
    byteLength: 6,
  };
}

function tool(
  id: string,
  turnId: string,
  toolUseId: string,
): Extract<SessionTranscriptItem, { kind: 'tool' }> {
  return {
    id,
    kind: 'tool',
    turnId,
    toolUseId,
    toolName: 'Glob',
    action: 'Inspected workspace structure',
    status: 'stopped',
    progressCount: 0,
    latestUpdateKind: null,
  };
}
