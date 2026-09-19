import type { SessionContextState } from '../../../shared/protocol/settings';

/** Compact token counts, with at most one decimal and no trailing zero. */
export function formatCompactTokens(value: number): string {
  if (value >= 1_000_000) return `${trimDecimal(value / 1_000_000)}M`;
  if (value >= 1_000) return `${trimDecimal(value / 1_000)}K`;
  return String(value);
}

function trimDecimal(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export function formatCredits(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 3 });
}

export function getContextPercent(context: SessionContextState): number {
  if (context.value === null || !hasUsableContextRatio(context.value)) return 0;
  return Math.min(100, Math.round((context.value.used / context.value.limit) * 100));
}

export function getContextLabel(context: SessionContextState): string {
  if (context.value === null) {
    return context.status === 'loading' ? 'Compaction progress loading' : 'Compaction progress unavailable';
  }
  if (!hasUsableContextRatio(context.value)) {
    return context.value.reason === 'awaiting-usage' ? 'Waiting for model usage' : 'Compaction progress unavailable';
  }
  return `Compaction progress: ${context.value.used.toLocaleString()} of ${context.value.limit.toLocaleString()} adjusted tokens`;
}

export function hasUsableContextRatio(
  stats: NonNullable<SessionContextState['value']>,
): stats is Extract<NonNullable<SessionContextState['value']>, { availability: 'available' }> {
  return stats.availability === 'available';
}
