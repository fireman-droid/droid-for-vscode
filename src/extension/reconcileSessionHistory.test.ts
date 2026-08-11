import { describe, expect, it } from 'vitest';

import type { SessionTranscriptItem } from '../shared/bridgeMessages';
import type { HostTranscriptState } from '../shared/hostTranscriptState';
import {
  realShapeLoaded,
  realShapeRecovered,
} from './__fixtures__/reconcileRealSession';
import { reconcileSessionHistory } from './reconcileSessionHistory';

describe('reconcileSessionHistory', () => {
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

    const merged = reconcileSessionHistory(loaded, recovered);
    expect(merged.transcript[0]).toEqual({
      ...loaded.transcript[0],
      attachments: chips,
    });
    expect(merged.transcript.slice(1)).toEqual(
      loaded.transcript.slice(1),
    );
  });

  it('retains non-overlapping safe content and marks chronology partial', () => {
    const recovered = state([user('cached', 'Locally observed prompt')]);
    const loaded = state([user('sdk', 'Public SDK prompt')]);

    expect(reconcileSessionHistory(loaded, recovered)).toEqual({
      transcript: [...loaded.transcript, ...recovered.transcript],
      historyStatus: 'partial',
      truncated: false,
    });
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
      transcript: [...loaded.transcript, ...recovered.transcript],
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

    it('prepends the recovered rewind-branch prefix ahead of the loaded body', () => {
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

      expect(reconcileSessionHistory(loaded, recovered)).toEqual({
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

      // Loaded body plus the two-item rewind-branch prefix the SDK no
      // longer returns; the duplicate resend residue is dropped.
      expect(result.transcript).toHaveLength(realShapeLoaded.length + 2);
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

      // The body is the loaded history unchanged; only the recovered
      // rewind-branch prefix sits in front of it.
      expect(result.transcript.slice(2)).toEqual(realShapeLoaded);
      expect(result.transcript[0]).toEqual(realShapeRecovered[0]);
      expect(result.transcript[1]).toEqual(realShapeRecovered[1]);
    });
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
