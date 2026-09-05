import { describe, expect, it } from 'vitest';

import type { SessionTranscriptItem } from './bridgeMessages';
import {
  THINKING_TEXT_UNIT_DIVISOR,
  transcriptTextUnits,
} from './transcriptLimits';

describe('transcriptTextUnits', () => {
  it('charges input-derived tool targets to the transcript text budget', () => {
    const tool: Extract<SessionTranscriptItem, { kind: 'tool' }> = {
      id: 'tool-1',
      kind: 'tool',
      turnId: 'turn-1',
      toolUseId: 'call-1',
      toolName: 'Read',
      action: 'Read workspace files',
      status: 'completed',
      progressCount: 0,
      latestUpdateKind: null,
    };
    expect(
      transcriptTextUnits([{ ...tool, target: 'src/app.ts' }]) -
        transcriptTextUnits([tool]),
    ).toBe('src/app.ts'.length);
  });

  it('discounts thinking text so it cannot crowd out conversation', () => {
    const thinking: Extract<
      SessionTranscriptItem,
      { kind: 'thinking' }
    > = {
      id: 'th-1',
      kind: 'thinking',
      turnId: 'turn-1',
      text: '',
      status: 'complete',
      truncated: false,
    };
    const grown = 'x'.repeat(80_000);
    expect(
      transcriptTextUnits([{ ...thinking, text: grown }]) -
        transcriptTextUnits([thinking]),
    ).toBe(Math.ceil(grown.length / THINKING_TEXT_UNIT_DIVISOR));

    // Assistant text stays fully charged: the discount is
    // thinking-specific.
    const assistant: Extract<
      SessionTranscriptItem,
      { kind: 'assistant' }
    > = {
      id: 'a-1',
      kind: 'assistant',
      turnId: 'turn-1',
      text: grown,
    };
    expect(
      transcriptTextUnits([assistant]) -
        transcriptTextUnits([{ ...assistant, text: '' }]),
    ).toBe(grown.length);
  });

  it('charges AskUser topics and answers to the text budget', () => {
    const base = {
      id: 'ask-1',
      kind: 'ask-user-result',
      turnId: 'turn-1',
      status: 'answered',
      answers: [{ topic: '', answer: '' }],
    } as const;
    const filled = {
      ...base,
      answers: [{ topic: 'Library', answer: 'React' }],
    } as const;
    expect(
      transcriptTextUnits([filled]) - transcriptTextUnits([base]),
    ).toBe('LibraryReact'.length);
    const withQuestion = {
      ...filled,
      answers: [{ ...filled.answers[0], question: 'Which library?' }],
    };
    expect(
      transcriptTextUnits([withQuestion]) - transcriptTextUnits([filled]),
    ).toBe('Which library?'.length);
  });
});
