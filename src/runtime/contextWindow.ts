import type { RuntimeContextWindow } from './DroidRuntime';
import type { CapturedLastCallTokenUsage } from './modelCatalogCaptureTransport';

export interface FactoryContextWindowSource {
  readonly limit: number;
  readonly lastCallTokenUsage: CapturedLastCallTokenUsage;
}

export function projectContextWindow(
  source: FactoryContextWindowSource,
  /**
   * Highest numerator already confirmed for this session. Droid bills
   * small auxiliary calls (session titles) through the same last-call
   * channel, and landing on one of those must not shrink the meter to
   * 0% while the conversation is still in context. Session
   * replacement (rewind/compact/fork) drops the floor with the id.
   */
  confirmedUsed = 0,
): RuntimeContextWindow {
  const limit = contextTokens(source.limit);
  if (limit === null || limit === 0) {
    return {
      availability: 'unavailable',
      reason: 'invalid-budget',
    };
  }
  const lastCall = source.lastCallTokenUsage;
  if (lastCall.status === 'missing') {
    return {
      availability: 'unavailable',
      reason: 'no-last-call',
    };
  }
  const reported =
    lastCall.status === 'invalid' ? null : contextTokens(lastCall.used);
  if (reported === null) {
    return {
      availability: 'unavailable',
      reason: 'invalid-last-call',
    };
  }
  // A conversation sitting at the compaction threshold legitimately
  // exceeds the budget, as does one whose model was switched to a
  // smaller window: report a full meter, not no meter.
  const used = Math.min(Math.max(reported, confirmedUsed), limit);
  return {
    availability: 'available',
    used,
    remaining: limit - used,
    limit,
  };
}

export function classifyInvalidContextWindowSource(
  source: FactoryContextWindowSource,
): string {
  if (!Number.isFinite(source.limit)) {
    return 'non-finite-budget';
  }
  if (source.limit <= 0) {
    return 'non-positive-budget';
  }
  return 'projection-error';
}

/**
 * Daemon context numbers are estimates and arrive fractional (the
 * SDK-facing `getContextStats` rounds them for the same reason), so a
 * fraction is rounded rather than rejected.
 */
function contextTokens(value: number): number | null {
  return Number.isFinite(value) &&
    value >= 0 &&
    value <= Number.MAX_SAFE_INTEGER
    ? Math.round(value)
    : null;
}
