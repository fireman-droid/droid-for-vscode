import type { RuntimeContextWindow } from './DroidRuntime';
import type { CapturedLastCallTokenUsage } from './modelCatalogCaptureTransport';

export interface FactoryContextWindowSource {
  readonly limit: number;
  readonly lastCallTokenUsage: CapturedLastCallTokenUsage;
}

export function projectContextWindow(
  source: FactoryContextWindowSource,
): RuntimeContextWindow {
  if (!isContextNumber(source.limit) || source.limit === 0) {
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
  if (
    lastCall.status === 'invalid' ||
    !isContextNumber(lastCall.used) ||
    lastCall.used > source.limit
  ) {
    return {
      availability: 'unavailable',
      reason: 'invalid-last-call',
    };
  }
  return {
    availability: 'available',
    used: lastCall.used,
    remaining: source.limit - lastCall.used,
    limit: source.limit,
  };
}

export function classifyInvalidContextWindowSource(
  source: FactoryContextWindowSource,
): string {
  if (!Number.isSafeInteger(source.limit)) {
    return 'non-integer-budget';
  }
  if (source.limit <= 0) {
    return 'non-positive-budget';
  }
  return 'projection-error';
}

function isContextNumber(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}
