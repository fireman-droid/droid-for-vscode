import { describe, expect, it } from 'vitest';
import { parseTranscriptItem } from './sessionRecoveryItems';

const summary = { type: 'scout', description: 'Inspect handlers', status: 'running' };
const tool = (startedAt?: unknown) => ({ kind: 'tool', id: 'task-row', turnId: 'turn',
  toolUseId: 'task-call', toolName: 'Task', action: 'Delegate task', status: 'completed',
  progressCount: 0, latestUpdateKind: null,
  subagent: { ...summary, ...(startedAt === undefined ? {} : { startedAt }) } });

describe('subagent checkpoint timestamps', () => {
  it('preserves a recorded start across decoding and leaves legacy unknown times absent', () => {
    expect(parseTranscriptItem(tool(1_789_976_666_681)))
      .toMatchObject({ subagent: { ...summary, startedAt: 1_789_976_666_681 } });
    expect(parseTranscriptItem(tool())).toMatchObject({ subagent: summary });
    expect(parseTranscriptItem(tool())).not.toHaveProperty('subagent.startedAt');
  });

  it.each([0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1, '1789976666681'])
    ('rejects an invalid recorded start %s', startedAt => {
      expect(parseTranscriptItem(tool(startedAt))).toBeUndefined();
    });
});
