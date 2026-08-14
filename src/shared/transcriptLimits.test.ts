import { describe, expect, it } from 'vitest';

import type { SessionTranscriptItem } from './bridgeMessages';
import { transcriptTextUnits } from './transcriptLimits';

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
});
