import { describe, expect, it } from 'vitest';
import { readHostMessage } from './validateHostMessage';

const summary = { type: 'scout', description: 'Inspect handlers', status: 'running' };
const envelope = { sequence: 1, sessionId: 'parent', turnId: 'turn', toolUseId: 'task' };
const messages = (startedAt?: unknown) => {
  const subagent = { ...summary, ...(startedAt === undefined ? {} : { startedAt }) };
  return [{ ...envelope, type: 'subagent.update', subagent },
    { ...envelope, type: 'tool.activity', toolName: 'Task', action: 'Delegate task',
      status: 'completed', progressCount: 0, latestUpdateKind: null, subagent }];
};

describe('subagent timestamp delivery', () => {
  it('delivers the original dispatch time through live activity and background updates', () => {
    for (const item of [...messages(1_789_976_666_681), ...messages()])
      expect(readHostMessage(item)).toEqual(item);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1, '1789976666681'])
    ('rejects malformed time %s without accepting a partial update', startedAt => {
      for (const item of messages(startedAt)) expect(readHostMessage(item)).toBeUndefined();
    });
});
