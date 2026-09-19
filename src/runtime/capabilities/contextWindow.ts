import type { RuntimeContextWindow } from '../DroidRuntime';

export interface FactoryContextBreakdown {
  readonly used: number;
  readonly remaining: number;
  readonly limit: number;
  readonly lastCallCompactionTokens?: number;
}

// Droid CLI 0.212.0 subtracts this from both last-call usage and the
// compaction threshold for its meter; SDK 0.7.0 does not expose the adjustment.
const CLI_COMPACTION_SYSTEM_PROMPT_TOKENS = 11_000;

export function projectContextWindow(
  source: FactoryContextBreakdown,
): RuntimeContextWindow {
  const threshold = contextTokens(source.limit);
  if (threshold === null || threshold === 0) {
    return { availability: 'unavailable', reason: 'invalid-breakdown' };
  }
  const estimatedTokens = contextTokens(source.used);
  const estimate = estimatedTokens === null ? {} : { estimatedTokens };
  if (
    source.lastCallCompactionTokens === undefined ||
    source.lastCallCompactionTokens === 0
  ) {
    return { availability: 'unavailable', reason: 'awaiting-usage', ...estimate };
  }
  const lastCall = contextTokens(source.lastCallCompactionTokens);
  if (lastCall === null) {
    return { availability: 'unavailable', reason: 'invalid-breakdown', ...estimate };
  }
  const used = Math.max(0, lastCall - CLI_COMPACTION_SYSTEM_PROMPT_TOKENS);
  const limit = Math.max(1, threshold - CLI_COMPACTION_SYSTEM_PROMPT_TOKENS);
  return {
    availability: 'available',
    used,
    remaining: Math.max(0, limit - used),
    limit,
    ...estimate,
  };
}

function contextTokens(value: number): number | null {
  return Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER
    ? Math.round(value)
    : null;
}
