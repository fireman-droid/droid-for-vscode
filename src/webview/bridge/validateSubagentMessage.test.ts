import { describe, expect, it } from 'vitest';

import { readHostMessage } from './validateHostMessage';

describe('inline Subagent activity validation', () => {
  it('accepts only the exact card activity payload', () => {
    const activity = {
      type: 'subagent.activity',
      sequence: 9,
      sessionId: 'session-1',
      turnId: 'turn-1',
      toolUseId: 'use-1',
      activities: [
        { action: 'Searched workspace content', target: 'src' },
      ],
    };
    expect(readHostMessage(activity)).toEqual(activity);
    expect(
      readHostMessage({ ...activity, childSessionId: 'leak' }),
    ).toBeUndefined();
    expect(
      readHostMessage({ ...activity, stoppable: true }),
    ).toBeUndefined();
  });

  it('rejects the removed Subagent transcript route', () => {
    expect(
      readHostMessage({
        type: 'subagent.transcript',
        sequence: 3,
        sessionId: 'session-1',
        toolUseId: 'use-1',
        status: 'available',
        title: 'map the flow',
        items: [],
        truncated: false,
      }),
    ).toBeUndefined();
  });
});
