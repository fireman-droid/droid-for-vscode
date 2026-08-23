import type { RuntimeContextWindow } from './DroidRuntime';
import type { CapturedLastCallTokenUsage } from './modelCatalogCaptureTransport';

export interface FactoryContextWindowSource {
  readonly limit: number;
  readonly lastCallTokenUsage: CapturedLastCallTokenUsage;
}

export interface ConfirmedContextWindow {
  readonly sessionId: string;
  readonly used: number;
  readonly limit: number;
  readonly compactionDetected: boolean;
}

const COMPACTION_HIGH_WATER_FRACTION = 0.9;
const COMPACTION_MIN_DROP_FRACTION = 0.1;
const AUXILIARY_CALL_MAX_TOKENS = 2_000;
const AUXILIARY_CALL_MAX_FRACTION = 0.02;

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
  const compactionDetected = isCompactionDrop(
    reported,
    confirmedUsed,
    limit,
  );
  // Small title/metadata calls still keep the confirmed floor. A
  // substantial provider call that follows a near-full window is the
  // observable same-session signature of automatic compaction, so it
  // is allowed to reset that floor.
  const used = Math.min(
    compactionDetected ? reported : Math.max(reported, confirmedUsed),
    limit,
  );
  return {
    availability: 'available',
    used,
    remaining: limit - used,
    limit,
    ...(compactionDetected ? { compactionDetected: true } : {}),
  };
}

export function resolveContextWindow(
  source: FactoryContextWindowSource,
  sessionId: string,
  confirmed: ConfirmedContextWindow | null,
): {
  readonly window: RuntimeContextWindow;
  readonly confirmed: ConfirmedContextWindow | null;
} {
  const previous =
    confirmed?.sessionId === sessionId ? confirmed : null;
  let projected = projectContextWindow(source);
  if (
    projected.availability === 'available' &&
    previous?.limit === projected.limit
  ) {
    projected = projectContextWindow(source, previous.used);
  }
  if (projected.availability === 'unavailable') {
    return { window: projected, confirmed: previous };
  }
  const compactionDetected =
    projected.compactionDetected === true ||
    previous?.compactionDetected === true;
  const window = compactionDetected
    ? { ...projected, compactionDetected: true as const }
    : projected;
  return {
    window,
    confirmed: {
      sessionId,
      used: window.used,
      limit: window.limit,
      compactionDetected,
    },
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

function isCompactionDrop(
  reported: number,
  confirmedUsed: number,
  limit: number,
): boolean {
  const auxiliaryCeiling = Math.max(
    AUXILIARY_CALL_MAX_TOKENS,
    limit * AUXILIARY_CALL_MAX_FRACTION,
  );
  return (
    confirmedUsed >= limit * COMPACTION_HIGH_WATER_FRACTION &&
    reported > auxiliaryCeiling &&
    confirmedUsed - reported >= limit * COMPACTION_MIN_DROP_FRACTION
  );
}
