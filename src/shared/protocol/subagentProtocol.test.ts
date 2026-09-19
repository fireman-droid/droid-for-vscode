import { describe, expect, it } from 'vitest';

import {
  parseSubagentActivityMessage,
  parseSubagentWebviewMessage,
} from './subagentProtocol';

describe('inline Subagent activity protocol', () => {
  it('accepts only panel toggles from the webview', () => {
    expect(
      parseSubagentWebviewMessage({
        type: 'subagent.panel',
        sessionId: 'session-1',
        open: true,
      }),
    ).toEqual({
      type: 'subagent.panel',
      sessionId: 'session-1',
      open: true,
    });
    expect(
      parseSubagentWebviewMessage({
        type: 'subagent.openTranscript',
        sessionId: 'session-1',
        toolUseId: 'use-1',
      }),
    ).toBeNull();
    expect(
      parseSubagentWebviewMessage({
        type: 'subagent.stop',
        sessionId: 'session-1',
        turnId: 'turn-1',
        toolUseId: 'use-1',
      }),
    ).toBeNull();
  });

  it('validates the bounded per-card activity push', () => {
    expect(
      parseSubagentActivityMessage({
        type: 'subagent.activity',
        sequence: 2,
        sessionId: 'session-1',
        turnId: 'turn-1',
        toolUseId: 'use-1',
        activities: [
          { action: 'Read workspace files', target: 'src/app.ts' },
          { action: 'Searched workspace content', target: null },
        ],
      }),
    ).toMatchObject({
      activities: [
        { action: 'Read workspace files', target: 'src/app.ts' },
        { action: 'Searched workspace content', target: null },
      ],
    });
    expect(
      parseSubagentActivityMessage({
        type: 'subagent.activity',
        sequence: 2,
        sessionId: 'session-1',
        turnId: 'turn-1',
        toolUseId: 'use-1',
        activities: [{ action: 'Read workspace files', target: 'src/app.ts' }],
        stoppable: true,
      }),
    ).toBeNull();
    expect(
      parseSubagentActivityMessage({
        type: 'subagent.activity',
        sequence: 2,
        sessionId: 'session-1',
        turnId: 'turn-1',
        toolUseId: 'use-1',
        activities: Array.from({ length: 5 }, () => ({
          action: 'Read workspace files',
          target: null,
        })),
      }),
    ).toBeNull();
    expect(
      parseSubagentActivityMessage({
        type: 'subagent.activity',
        sequence: 2,
        sessionId: 'session-1',
        turnId: 'turn-1',
        toolUseId: 'use-1',
        activities: [
          {
            action: 'Read workspace files',
            target: 'src/app.ts',
            rawInput: 'leak',
          },
        ],
      }),
    ).toBeNull();
  });
});
