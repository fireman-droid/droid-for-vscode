import { isStrictRecord } from './strictValidation';

/**
 * One token-usage breakdown mirroring the SDK's `TokenUsage` shape. The same
 * shape carries two scopes: cumulative session totals (live
 * `token_usage_update` events, `loadSession` envelope) and one turn's
 * consumption (`result.tokenUsage`).
 *
 * `factoryCredits` is Factory-credit consumption for the same scope.
 * The SDK's stream conversion drops it, so it only arrives on per-turn
 * results and history loads. The SDK exposes no USD cost anywhere, so
 * no money amount exists on this contract by design.
 */
export interface TokenUsageBreakdown {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheCreationTokens: number;
  readonly thinkingTokens: number;
  readonly factoryCredits?: number;
}

/**
 * Session-scoped usage state shared between Host and Webview.
 * `cumulative` is seeded from history for resumed sessions and then
 * tracks the newest live update; `lastTurn` only exists after a turn
 * completed in the current window (history carries no per-turn usage).
 */
export interface SessionTokenUsageState {
  readonly cumulative: TokenUsageBreakdown | null;
  readonly lastTurn: TokenUsageBreakdown | null;
}

export const EMPTY_SESSION_TOKEN_USAGE: SessionTokenUsageState = {
  cumulative: null,
  lastTurn: null,
};

const TOKEN_COUNT_FIELDS = [
  'inputTokens',
  'outputTokens',
  'cacheReadTokens',
  'cacheCreationTokens',
  'thinkingTokens',
] as const;

/**
 * Projects an SDK token-usage payload into the bridge shape. Lenient
 * on unknown extra keys (SDK payloads may grow), strict on the five
 * token counts (non-negative safe integers). An invalid
 * `factoryCredits` is treated as absent rather than poisoning the
 * five real counts; credits may be fractional.
 */
export function readTokenUsageBreakdown(
  value: unknown,
): TokenUsageBreakdown | undefined {
  if (!isStrictRecord(value)) {
    return undefined;
  }
  for (const field of TOKEN_COUNT_FIELDS) {
    if (!isTokenCount(value[field])) {
      return undefined;
    }
  }
  const credits = value.factoryCredits;
  return {
    inputTokens: value.inputTokens as number,
    outputTokens: value.outputTokens as number,
    cacheReadTokens: value.cacheReadTokens as number,
    cacheCreationTokens: value.cacheCreationTokens as number,
    thinkingTokens: value.thinkingTokens as number,
    ...(typeof credits === 'number' &&
    Number.isFinite(credits) &&
    credits >= 0
      ? { factoryCredits: credits }
      : {}),
  };
}

function isTokenCount(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0
  );
}
