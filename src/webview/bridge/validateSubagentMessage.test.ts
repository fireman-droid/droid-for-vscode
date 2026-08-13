import { describe, expect, it } from 'vitest';

import { readHostMessage } from './validateHostMessage';

const ITEM = {
  id: 'u1',
  kind: 'user',
  text: 'investigate the flow',
};

const AVAILABLE = {
  type: 'subagent.transcript',
  sequence: 3,
  sessionId: 'session-1',
  toolUseId: 'use-1',
  status: 'available',
  title: 'map the flow',
  items: [ITEM],
  truncated: false,
};

describe('subagent.transcript validation', () => {
  it('accepts an available transcript with reused item validation', () => {
    expect(readHostMessage(AVAILABLE)).toEqual(AVAILABLE);
  });

  it('accepts the fail-closed refusal without items', () => {
    const unavailable = {
      type: 'subagent.transcript',
      sequence: 4,
      sessionId: 'session-1',
      toolUseId: 'use-1',
      status: 'unavailable',
      title: 'map the flow',
    };
    expect(readHostMessage(unavailable)).toEqual(unavailable);
  });

  it.each([
    // A smuggled child session id fails exact-key validation.
    { ...AVAILABLE, childSessionId: 'leak' },
    // Items on a refusal are contradictory.
    { ...AVAILABLE, status: 'unavailable' },
    { ...AVAILABLE, status: 'streaming' },
    { ...AVAILABLE, title: 'x'.repeat(513) },
    { ...AVAILABLE, items: 'not-an-array' },
    { ...AVAILABLE, items: [{ ...ITEM, kind: 'exploit' }] },
    (() => {
      const { toolUseId: _dropped, ...rest } = AVAILABLE;
      return rest;
    })(),
  ])('rejects malformed transcripts %#', (payload) => {
    expect(readHostMessage(payload)).toBeUndefined();
  });

  it('rejects a child id smuggled through an item subagent summary', () => {
    expect(
      readHostMessage({
        ...AVAILABLE,
        items: [
          {
            id: 't1',
            kind: 'tool',
            turnId: 'turn-1',
            toolUseId: 'use-9',
            toolName: 'Task',
            action: 'Delegated',
            status: 'completed',
            progressCount: 0,
            latestUpdateKind: null,
            subagent: {
              type: 'explore',
              description: '',
              status: 'completed',
              childSessionId: 'leak',
            },
          },
        ],
      }),
    ).toBeUndefined();
  });
});

describe('subagent.activity validation', () => {
  it('routes through readHostMessage', () => {
    const activity = {
      type: 'subagent.activity',
      sequence: 9,
      sessionId: 'session-1',
      turnId: 'turn-1',
      toolUseId: 'use-1',
      action: 'Grep',
      stoppable: true,
    };
    expect(readHostMessage(activity)).toEqual(activity);
    expect(
      readHostMessage({ ...activity, childSessionId: 'leak' }),
    ).toBeUndefined();
  });
});
