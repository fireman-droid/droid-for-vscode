import { describe, expect, it } from 'vitest';

import type { PendingInteraction } from './store';
import { isFooterInteraction } from './interactionPlacement';

describe('isFooterInteraction', () => {
  it('docks AskUser and ExitSpecMode without moving normal permissions', () => {
    expect(isFooterInteraction(interaction('ask-user'))).toBe(true);
    expect(isFooterInteraction(interaction('exit_spec_mode'))).toBe(true);
    expect(isFooterInteraction(interaction('exec'))).toBe(false);
  });
});

function interaction(
  kind: 'ask-user' | 'exit_spec_mode' | 'exec',
): PendingInteraction {
  return {
    sessionId: 'session-1',
    turnId: 'turn-1',
    request:
      kind === 'ask-user'
        ? {
            kind: 'ask-user',
            requestId: 'ask-1',
            toolCallId: 'tool-1',
            questions: [],
          }
        : {
            kind: 'permission',
            requestId: 'permission-1',
            tools: [
              {
                toolUseId: 'tool-1',
                toolName:
                  kind === 'exit_spec_mode' ? 'ExitSpecMode' : 'Execute',
                confirmationKind: kind,
                title: 'Request',
              },
            ],
            options: [],
          },
  };
}
