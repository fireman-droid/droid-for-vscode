import { describe, expect, it } from 'vitest';

import {
  projectContextWindow,
  resolveContextWindow,
} from './contextWindow';

const source = (
  limit: number,
  lastCallTokenUsage: Parameters<
    typeof projectContextWindow
  >[0]['lastCallTokenUsage'],
) => ({ limit, lastCallTokenUsage });

describe('projectContextWindow', () => {
  it('projects a last-call numerator against the model budget', () => {
    expect(
      projectContextWindow(
        source(250_000, { status: 'available', used: 129_465 }),
      ),
    ).toEqual({
      availability: 'available',
      used: 129_465,
      remaining: 120_535,
      limit: 250_000,
    });
  });

  it('rounds fractional daemon estimates instead of rejecting them', () => {
    expect(
      projectContextWindow(
        source(250_000.4, { status: 'available', used: 1234.6 }),
      ),
    ).toEqual({
      availability: 'available',
      used: 1235,
      remaining: 248_765,
      limit: 250_000,
    });
  });

  it('clamps a last call that exceeds the current budget', () => {
    expect(
      projectContextWindow(
        source(196_608, { status: 'available', used: 240_000 }),
      ),
    ).toEqual({
      availability: 'available',
      used: 196_608,
      remaining: 0,
      limit: 196_608,
    });
  });

  it('keeps the confirmed floor when a small auxiliary call reports', () => {
    expect(
      projectContextWindow(
        source(250_000, { status: 'available', used: 304 }),
        126_387,
      ),
    ).toMatchObject({ used: 126_387, remaining: 123_613 });
  });

  it('resets a near-full floor after an automatic compaction drop', () => {
    expect(
      projectContextWindow(
        source(250_000, { status: 'available', used: 212_067 }),
        250_000,
      ),
    ).toEqual({
      availability: 'available',
      used: 212_067,
      remaining: 37_933,
      limit: 250_000,
      compactionDetected: true,
    });
  });

  it('does not mistake a tiny post-threshold call for compaction', () => {
    expect(
      projectContextWindow(
        source(250_000, { status: 'available', used: 304 }),
        250_000,
      ),
    ).toMatchObject({
      used: 250_000,
      remaining: 0,
    });
  });

  it('keeps automatic compaction evidence for later session reads', () => {
    const first = resolveContextWindow(
      source(250_000, { status: 'available', used: 212_067 }),
      'session-1',
      {
        sessionId: 'session-1',
        used: 250_000,
        limit: 250_000,
        compactionDetected: false,
      },
    );
    const next = resolveContextWindow(
      source(250_000, { status: 'available', used: 220_000 }),
      'session-1',
      first.confirmed,
    );

    expect(first.window).toMatchObject({
      used: 212_067,
      compactionDetected: true,
    });
    expect(next.window).toMatchObject({
      used: 220_000,
      compactionDetected: true,
    });
  });

  it('does not report compaction when the model budget changed', () => {
    const changed = resolveContextWindow(
      source(100_000, { status: 'available', used: 80_000 }),
      'session-1',
      {
        sessionId: 'session-1',
        used: 250_000,
        limit: 250_000,
        compactionDetected: false,
      },
    );

    expect(changed.window).toEqual({
      availability: 'available',
      used: 80_000,
      remaining: 20_000,
      limit: 100_000,
    });
  });

  it('never lets the floor exceed the budget', () => {
    expect(
      projectContextWindow(
        source(1000, { status: 'available', used: 10 }),
        5000,
      ),
    ).toMatchObject({ used: 1000, remaining: 0 });
  });

  it.each([
    { limit: 0, reason: 'invalid-budget' },
    { limit: -1, reason: 'invalid-budget' },
    { limit: Number.NaN, reason: 'invalid-budget' },
    { limit: Number.POSITIVE_INFINITY, reason: 'invalid-budget' },
  ])('fails closed for an unusable budget', ({ limit, reason }) => {
    expect(
      projectContextWindow(source(limit, { status: 'available', used: 1 })),
    ).toEqual({ availability: 'unavailable', reason });
  });

  it.each([
    { lastCall: { status: 'missing' as const }, reason: 'no-last-call' },
    { lastCall: { status: 'invalid' as const }, reason: 'invalid-last-call' },
    {
      lastCall: { status: 'available' as const, used: -1 },
      reason: 'invalid-last-call',
    },
    {
      lastCall: { status: 'available' as const, used: Number.NaN },
      reason: 'invalid-last-call',
    },
  ])('fails closed for unusable last-call data', ({ lastCall, reason }) => {
    expect(projectContextWindow(source(250_000, lastCall))).toEqual({
      availability: 'unavailable',
      reason,
    });
  });
});
