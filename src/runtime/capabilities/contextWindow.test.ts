import { describe, expect, it } from 'vitest';
import { projectContextWindow } from './contextWindow';
import { projectContextWindow as projectHostContext } from '../../extension/chat/capabilities/capabilityPanels';
import { parseSessionContext } from '../../webview/bridge/validateContextState';

const source = {
  used: 400_000,
  remaining: 0,
  limit: 300_000,
  lastCallCompactionTokens: 85_000,
};

describe('compaction progress projection', () => {
  it('uses last-call usage even when the character estimate exceeds the budget across all boundaries', () => {
    const runtime = projectContextWindow(source);
    expect(runtime).toEqual({
      availability: 'available',
      used: 74_000,
      remaining: 215_000,
      limit: 289_000,
      estimatedTokens: 400_000,
    });
    const host = projectHostContext(runtime);
    expect(parseSessionContext({ status: 'ready', value: host })).toEqual({
      status: 'ready',
      value: runtime,
    });
  });

  it.each([undefined, 0])(
    'never substitutes estimates when last-call usage is %s',
    (lastCallCompactionTokens) => {
      const runtime = projectContextWindow({ ...source, lastCallCompactionTokens });
      expect(runtime).toEqual({
        availability: 'unavailable',
        reason: 'awaiting-usage',
        estimatedTokens: 400_000,
      });
      expect(
        parseSessionContext({ status: 'ready', value: projectHostContext(runtime) })
          ?.value,
      ).toEqual(runtime);
    },
  );

  it('preserves genuine over-threshold usage and clamps remaining space, not the reported usage', () => {
    const runtime = projectContextWindow({
      ...source,
      lastCallCompactionTokens: 350_000,
    });
    expect(runtime).toMatchObject({
      availability: 'available',
      used: 339_000,
      remaining: 0,
      limit: 289_000,
    });
    expect(
      parseSessionContext({ status: 'ready', value: projectHostContext(runtime) })?.value,
    ).toEqual(runtime);
  });

  it.each([
    { limit: 0 },
    { limit: Number.NaN },
    { lastCallCompactionTokens: -1 },
    { lastCallCompactionTokens: Number.POSITIVE_INFINITY },
  ])('still rejects invalid compaction counters: %j', (invalid) => {
    expect(projectContextWindow({ ...source, ...invalid })).toMatchObject({
      availability: 'unavailable',
      reason: 'invalid-breakdown',
    });
  });
});
