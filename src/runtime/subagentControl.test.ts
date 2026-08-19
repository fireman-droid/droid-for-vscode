import { describe, expect, it, vi } from 'vitest';

import {
  createDaemonSubagentControl,
  lastToolName,
} from './subagentControl';
import { readSubagentInvocationRecords } from './subagentSummary';

describe('lastToolName', () => {
  it('returns the newest tool_use name across messages', () => {
    expect(
      lastToolName([
        {
          content: [
            { type: 'tool_use', name: 'LS' },
            { type: 'text', text: 'hi' },
          ],
        },
        { content: [{ type: 'tool_use', name: 'Grep' }] },
        { content: [{ type: 'text', text: 'done' }] },
      ]),
    ).toBe('Grep');
  });

  it('bounds and sanitizes hostile names, skipping unusable ones', () => {
    expect(
      lastToolName([
        {
          content: [
            { type: 'tool_use', name: `  Weird${'\u0000'}Tool\n ` },
          ],
        },
      ]),
    ).toBe('Weird Tool');
    expect(
      lastToolName([
        { content: [{ type: 'tool_use', name: '\u0007\u0000' }] },
        'not-a-message',
        { content: 'not-an-array' },
      ]),
    ).toBeNull();
    expect(lastToolName('nope')).toBeNull();
  });
});

describe('createDaemonSubagentControl', () => {
  it('samples activity through sessions.getMessages', async () => {
    const getMessages = vi.fn().mockResolvedValue([
      { content: [{ type: 'tool_use', name: 'Glob' }] },
    ]);
    const gateway = createDaemonSubagentControl(async () =>
      ({ sessions: { getMessages } }) as never,
    );
    await expect(gateway.sampleActivity('child-1')).resolves.toBe('Glob');
    expect(getMessages).toHaveBeenCalledWith('child-1', { limit: 40 });
  });

  it('reports failure without throwing when the daemon path breaks', async () => {
    const gateway = createDaemonSubagentControl(async () => {
      throw new Error('daemon down');
    });
    await expect(gateway.sampleActivity('child-3')).resolves.toBeNull();
  });
});

describe('readSubagentInvocationRecords', () => {
  const envelope = (invocations: unknown) => ({
    result: { subagentInvocations: invocations },
  });

  it('keeps the child session id host-side and strips it bridge-side', () => {
    const records = readSubagentInvocationRecords(
      envelope([
        {
          childSessionId: 'child-1',
          subagentType: 'explore',
          description: 'map the flow',
          status: 'running',
        },
        {
          childSessionId: { hostile: true },
          subagentType: 'explore',
          description: 'no id',
          status: 'completed',
          toolUseCount: 3,
          durationMs: 900,
        },
      ]),
    );
    expect(records).toEqual([
      {
        summary: {
          type: 'explore',
          description: 'map the flow',
          status: 'running',
        },
        childSessionId: 'child-1',
      },
      {
        summary: {
          type: 'explore',
          description: 'no id',
          status: 'completed',
          toolUseCount: 3,
          durationMs: 900,
        },
        childSessionId: null,
      },
    ]);
    // The bridge-safe view never carries an id-shaped key.
    for (const record of records) {
      expect('childSessionId' in record.summary).toBe(false);
    }
  });

  it('rejects unprintable child ids instead of passing them through', () => {
    const [record] = readSubagentInvocationRecords(
      envelope([
        {
          childSessionId: 'evil\u0000id',
          subagentType: 'explore',
          description: '',
          status: 'completed',
        },
      ]),
    );
    expect(record?.childSessionId).toBeNull();
  });
});
