import { describe, expect, it } from 'vitest';

import { readTokenUsageBreakdown } from './tokenUsage';

const validUsage = {
  inputTokens: 846,
  outputTokens: 5,
  cacheReadTokens: 11776,
  cacheCreationTokens: 0,
  thinkingTokens: 0,
};

describe('readTokenUsageBreakdown', () => {
  it('projects the five token counts without factoryCredits', () => {
    expect(readTokenUsageBreakdown(validUsage)).toEqual(validUsage);
  });

  it('keeps a valid factoryCredits, including fractional values', () => {
    expect(
      readTokenUsageBreakdown({ ...validUsage, factoryCredits: 0.5 }),
    ).toEqual({ ...validUsage, factoryCredits: 0.5 });
    expect(
      readTokenUsageBreakdown({ ...validUsage, factoryCredits: 0 }),
    ).toEqual({ ...validUsage, factoryCredits: 0 });
  });

  it('ignores unknown extra keys from newer SDK payloads', () => {
    expect(
      readTokenUsageBreakdown({ ...validUsage, futureField: 'x' }),
    ).toEqual(validUsage);
  });

  it('drops an invalid factoryCredits without poisoning the counts', () => {
    for (const credits of [-1, Number.NaN, Infinity, '3', null]) {
      expect(
        readTokenUsageBreakdown({ ...validUsage, factoryCredits: credits }),
      ).toEqual(validUsage);
    }
  });

  it('rejects payloads missing a token count', () => {
    const { thinkingTokens: _dropped, ...partial } = validUsage;
    expect(readTokenUsageBreakdown(partial)).toBeUndefined();
  });

  it('rejects invalid token counts', () => {
    for (const bad of [-1, 1.5, Number.NaN, Infinity, '5', null, 2 ** 53]) {
      expect(
        readTokenUsageBreakdown({ ...validUsage, inputTokens: bad }),
      ).toBeUndefined();
    }
  });

  it('rejects non-record payloads', () => {
    for (const bad of [null, undefined, 'usage', 42, [validUsage]]) {
      expect(readTokenUsageBreakdown(bad)).toBeUndefined();
    }
  });
});
