import type { RuntimeContextWindow } from './DroidRuntime';

export interface FactoryContextBreakdown {
  readonly used: number;
  readonly remaining: number;
  readonly limit: number;
}

export function projectContextWindow(
  source: FactoryContextBreakdown,
): RuntimeContextWindow {
  const used = contextTokens(source.used);
  const remaining = contextTokens(source.remaining);
  const limit = contextTokens(source.limit);
  if (
    used === null ||
    remaining === null ||
    limit === null ||
    limit === 0 ||
    used > limit ||
    Math.abs(remaining - (limit - used)) > 1
  ) {
    return {
      availability: 'unavailable',
      reason: 'invalid-breakdown',
    };
  }
  return {
    availability: 'available',
    used,
    remaining: limit - used,
    limit,
  };
}

/**
 * The daemon's official Context Breakdown values arrive fractional,
 * so the same rounding used by the Droid SDK facade is applied here.
 */
function contextTokens(value: number): number | null {
  return Number.isFinite(value) &&
    value >= 0 &&
    value <= Number.MAX_SAFE_INTEGER
    ? Math.round(value)
    : null;
}
