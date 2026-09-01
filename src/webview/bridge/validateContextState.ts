import {
  MAX_TURN_TEXT_LENGTH,
  type SessionContextState,
} from '../../shared/bridgeMessages';
import {
  hasExactKeys,
  isStrictRecord,
  type UnknownRecord,
} from '../../shared/strictValidation';

export function parseSessionContext(
  value: unknown,
): SessionContextState | undefined {
  if (!isStrictRecord(value)) {
    return undefined;
  }
  const status = readStringDataProperty(value, 'status');
  if (status === undefined) {
    return undefined;
  }

  if (status === 'error') {
    if (
      !hasExactKeys(value, ['status', 'value', 'message']) ||
      !isBoundedString(value.message)
    ) {
      return undefined;
    }
    const context =
      value.value === null ? null : parseContextStats(value.value);
    return context === undefined
      ? undefined
      : { status: 'error', value: context, message: value.message };
  }
  if (
    (status !== 'loading' && status !== 'ready') ||
    !hasExactKeys(value, ['status', 'value'])
  ) {
    return undefined;
  }
  const context =
    value.value === null ? null : parseContextStats(value.value);
  if (
    context === undefined ||
    (status === 'ready' && context === null)
  ) {
    return undefined;
  }
  if (status === 'loading') {
    return { status: 'loading', value: context };
  }
  return context === null
    ? undefined
    : { status: 'ready', value: context };
}

function parseContextStats(
  value: unknown,
): Exclude<SessionContextState['value'], null> | undefined {
  if (!isStrictRecord(value)) {
    return undefined;
  }
  const availability = readStringDataProperty(value, 'availability');
  if (availability === 'unavailable') {
    if (
      !hasExactKeys(value, ['availability', 'reason']) ||
      (value.reason !== 'unsupported' &&
        value.reason !== 'invalid-breakdown')
    ) {
      return undefined;
    }
    return {
      availability: 'unavailable',
      reason: value.reason,
    };
  }
  if (
    availability !== 'available' ||
    !hasExactKeys(value, [
      'availability',
      'used',
      'remaining',
      'limit',
    ]) ||
    !isContextNumber(value.used) ||
    !isContextNumber(value.remaining) ||
    !isContextNumber(value.limit) ||
    value.limit === 0 ||
    value.used > value.limit ||
    value.remaining !== value.limit - value.used
  ) {
    return undefined;
  }
  return {
    availability: 'available',
    used: value.used,
    remaining: value.remaining,
    limit: value.limit,
  };
}

function readStringDataProperty(
  value: UnknownRecord,
  key: string,
): string | undefined {
  const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined &&
    'value' in descriptor &&
    typeof descriptor.value === 'string'
    ? descriptor.value
    : undefined;
}

function isContextNumber(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isBoundedString(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= MAX_TURN_TEXT_LENGTH
  );
}
