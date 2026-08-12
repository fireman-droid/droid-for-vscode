import { describe, expect, it } from 'vitest';

import {
  MAX_SUBAGENT_DESCRIPTION_LENGTH,
  MAX_SUBAGENT_TYPE_LENGTH,
} from '../shared/bridgeMessages';
import {
  readSubagentInvocations,
  sanitizeSubagentDescription,
  sanitizeSubagentType,
  subagentIdentityKey,
} from './subagentSummary';

describe('sanitizeSubagentType', () => {
  it('collapses control characters and whitespace runs', () => {
    expect(sanitizeSubagentType('  code\u0000\r\n  reviewer  ')).toBe(
      'code reviewer',
    );
  });

  it('bounds the type name', () => {
    expect(
      sanitizeSubagentType('x'.repeat(MAX_SUBAGENT_TYPE_LENGTH + 20)),
    ).toBe('x'.repeat(MAX_SUBAGENT_TYPE_LENGTH));
  });

  it('rejects unusable values', () => {
    expect(sanitizeSubagentType('')).toBeNull();
    expect(sanitizeSubagentType('\u0000\u001f \t')).toBeNull();
    expect(sanitizeSubagentType(42)).toBeNull();
    expect(sanitizeSubagentType(undefined)).toBeNull();
  });
});

describe('sanitizeSubagentDescription', () => {
  it('collapses control characters and bounds the text', () => {
    expect(
      sanitizeSubagentDescription('Review\u0007 the \n\n bridge'),
    ).toBe('Review the bridge');
    expect(
      sanitizeSubagentDescription(
        'y'.repeat(MAX_SUBAGENT_DESCRIPTION_LENGTH + 5),
      ),
    ).toBe('y'.repeat(MAX_SUBAGENT_DESCRIPTION_LENGTH));
  });

  it('represents missing descriptions as an empty string', () => {
    expect(sanitizeSubagentDescription(undefined)).toBe('');
    expect(sanitizeSubagentDescription(7)).toBe('');
  });
});

describe('subagentIdentityKey', () => {
  it('separates type and description unambiguously', () => {
    expect(subagentIdentityKey('a', 'b c')).not.toBe(
      subagentIdentityKey('a b', 'c'),
    );
  });
});

describe('readSubagentInvocations', () => {
  const envelope = (
    subagentInvocations: unknown,
  ): Record<string, unknown> => ({
    result: { session: { messages: [] }, subagentInvocations },
  });

  it('projects ledger entries in order and drops the child session id', () => {
    const invocations = readSubagentInvocations(
      envelope([
        {
          childSessionId: 'child-1',
          subagentType: 'worker',
          description: '识别第二组账单截图',
          status: 'completed',
          toolUseCount: 12,
          durationMs: 377050,
        },
        {
          childSessionId: 'child-2',
          subagentType: 'explore',
          description: '',
          status: 'running',
        },
      ]),
    );

    expect(invocations).toEqual([
      {
        type: 'worker',
        description: '识别第二组账单截图',
        status: 'completed',
        toolUseCount: 12,
        durationMs: 377050,
      },
      {
        type: 'explore',
        description: '',
        status: 'running',
      },
    ]);
    expect(JSON.stringify(invocations)).not.toContain('child-1');
    expect(JSON.stringify(invocations)).not.toContain('child-2');
  });

  it('sanitizes and bounds externally sourced text fields', () => {
    const invocations = readSubagentInvocations(
      envelope([
        {
          childSessionId: 'child',
          subagentType: '  worker\u0000agent ',
          description: `A\u0000B ${'d'.repeat(
            MAX_SUBAGENT_DESCRIPTION_LENGTH,
          )}`,
          status: 'failed',
        },
      ]),
    );

    expect(invocations).toHaveLength(1);
    expect(invocations[0]?.type).toBe('worker agent');
    expect(invocations[0]?.description.startsWith('A B d')).toBe(true);
    expect(invocations[0]?.description).toHaveLength(
      MAX_SUBAGENT_DESCRIPTION_LENGTH,
    );
  });

  it('skips malformed entries instead of failing the load', () => {
    const invocations = readSubagentInvocations(
      envelope([
        null,
        'not-a-record',
        { childSessionId: 'c', subagentType: '', status: 'completed' },
        { childSessionId: 'c', subagentType: 'ok', status: 'exploded' },
        { childSessionId: 'c', subagentType: 'ok', status: 42 },
        {
          childSessionId: 'c',
          subagentType: 'ok',
          description: 'kept',
          status: 'cancelled',
          toolUseCount: -3,
          durationMs: Number.NaN,
        },
      ]),
    );

    expect(invocations).toEqual([
      { type: 'ok', description: 'kept', status: 'cancelled' },
    ]);
  });

  it('rounds fractional durations to bridge-safe integers', () => {
    const invocations = readSubagentInvocations(
      envelope([
        {
          childSessionId: 'c',
          subagentType: 'worker',
          description: '',
          status: 'completed',
          toolUseCount: 2.7,
          durationMs: 1500.4,
        },
      ]),
    );

    expect(invocations).toEqual([
      {
        type: 'worker',
        description: '',
        status: 'completed',
        toolUseCount: 3,
        durationMs: 1500,
      },
    ]);
  });

  it('returns an empty list for envelopes without a ledger', () => {
    expect(readSubagentInvocations(undefined)).toEqual([]);
    expect(readSubagentInvocations({})).toEqual([]);
    expect(readSubagentInvocations({ result: null })).toEqual([]);
    expect(readSubagentInvocations(envelope(undefined))).toEqual([]);
    expect(readSubagentInvocations(envelope('nope'))).toEqual([]);
  });
});
