import { hasExactKeys, isStrictRecord } from '../validation/strictValidation';

/**
 * Factory account identity and credit limits as both surfaces need them:
 * the management sidebar footer shows who is signed in, and `/limits`
 * shows the rolling usage windows of the same account.
 *
 * Only projections cross the Bridge. Tokens, refresh tokens and raw
 * billing payloads stay in the Extension Host.
 */

export const FACTORY_LIMIT_WINDOWS = ['fiveHour', 'weekly', 'monthly'] as const;
export type FactoryLimitWindowKey = (typeof FACTORY_LIMIT_WINDOWS)[number];

export const MAX_FACTORY_EMAIL_LENGTH = 254;
export const MAX_FACTORY_NAME_LENGTH = 128;
export const MAX_FACTORY_ORG_ID_LENGTH = 128;
export const MAX_FACTORY_ACCOUNT_MESSAGE_LENGTH = 300;

/** Local view of the signed-in Factory user; never carries credentials. */
export interface FactoryIdentity {
  readonly email: string;
  /** "First Last" when the token names the user; null otherwise. */
  readonly displayName: string | null;
  readonly orgId: string | null;
}

export interface FactoryLimitWindow {
  /** Used share of the window, 0–100 with one decimal. */
  readonly usedPercent: number;
  /** ISO instant the window resets; null before the window starts. */
  readonly windowEnd: string | null;
  /** Whole seconds until reset; null before the window starts. */
  readonly secondsRemaining: number | null;
}

export type FactoryLimitPool = Readonly<Record<FactoryLimitWindowKey, FactoryLimitWindow>>;

export interface FactoryLimits {
  /** Included allowance shared by every rolling window. */
  readonly standard: FactoryLimitPool;
  /** Free Droid Core allowance, spent after the standard pool. */
  readonly core: FactoryLimitPool;
  readonly extraUsageBalanceCents: number | null;
  readonly extraUsageAllowed: boolean;
  readonly canManageOverage: boolean;
}

export type FactoryAccountState =
  | { readonly status: 'loading' }
  | {
      readonly status: 'ready';
      readonly identity: FactoryIdentity | null;
      readonly limits: FactoryLimits | null;
      /** Why limits are missing while the identity is known. */
      readonly limitsError: string | null;
      readonly fetchedAt: string;
    }
  | { readonly status: 'unavailable'; readonly message: string };

/**
 * Requests the current Factory usage. Account and limits belong to the
 * signed-in CLI, not to a session, so the message carries no sessionId
 * and the projection survives session switches. `force` bypasses the
 * host's short cache for an explicit Refresh.
 */
export interface FactoryLimitsRefreshMessage {
  readonly type: 'factory.limits.refresh';
  readonly force?: boolean;
}

export interface FactoryLimitsStateMessage {
  readonly type: 'factory.limits';
  readonly sequence: number;
  readonly account: FactoryAccountState;
}

function isBoundedText(value: unknown, max: number): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= max &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

function isFactoryIdentity(value: unknown): value is FactoryIdentity {
  return (
    isStrictRecord(value) &&
    hasExactKeys(value, ['email', 'displayName', 'orgId']) &&
    isBoundedText(value.email, MAX_FACTORY_EMAIL_LENGTH) &&
    (value.displayName === null ||
      isBoundedText(value.displayName, MAX_FACTORY_NAME_LENGTH)) &&
    (value.orgId === null || isBoundedText(value.orgId, MAX_FACTORY_ORG_ID_LENGTH))
  );
}

function isLimitWindow(value: unknown): value is FactoryLimitWindow {
  return (
    isStrictRecord(value) &&
    hasExactKeys(value, ['usedPercent', 'windowEnd', 'secondsRemaining']) &&
    typeof value.usedPercent === 'number' &&
    Number.isFinite(value.usedPercent) &&
    value.usedPercent >= 0 &&
    value.usedPercent <= 100 &&
    (value.windowEnd === null ||
      (typeof value.windowEnd === 'string' &&
        value.windowEnd.length <= 40 &&
        !Number.isNaN(Date.parse(value.windowEnd)))) &&
    (value.secondsRemaining === null ||
      (typeof value.secondsRemaining === 'number' &&
        Number.isSafeInteger(value.secondsRemaining) &&
        value.secondsRemaining >= 0))
  );
}

function isLimitPool(value: unknown): value is FactoryLimitPool {
  return (
    isStrictRecord(value) &&
    hasExactKeys(value, [...FACTORY_LIMIT_WINDOWS]) &&
    FACTORY_LIMIT_WINDOWS.every((key) => isLimitWindow(value[key]))
  );
}

export function isFactoryLimits(value: unknown): value is FactoryLimits {
  return (
    isStrictRecord(value) &&
    hasExactKeys(value, [
      'standard',
      'core',
      'extraUsageBalanceCents',
      'extraUsageAllowed',
      'canManageOverage',
    ]) &&
    isLimitPool(value.standard) &&
    isLimitPool(value.core) &&
    (value.extraUsageBalanceCents === null ||
      (typeof value.extraUsageBalanceCents === 'number' &&
        Number.isSafeInteger(value.extraUsageBalanceCents) &&
        value.extraUsageBalanceCents >= 0)) &&
    typeof value.extraUsageAllowed === 'boolean' &&
    typeof value.canManageOverage === 'boolean'
  );
}

export function isFactoryAccountState(value: unknown): value is FactoryAccountState {
  if (!isStrictRecord(value)) return false;
  if (value.status === 'loading') return hasExactKeys(value, ['status']);
  if (value.status === 'unavailable') {
    return (
      hasExactKeys(value, ['status', 'message']) &&
      isBoundedText(value.message, MAX_FACTORY_ACCOUNT_MESSAGE_LENGTH)
    );
  }
  return (
    value.status === 'ready' &&
    hasExactKeys(value, ['status', 'identity', 'limits', 'limitsError', 'fetchedAt']) &&
    (value.identity === null || isFactoryIdentity(value.identity)) &&
    (value.limits === null || isFactoryLimits(value.limits)) &&
    (value.limitsError === null ||
      isBoundedText(value.limitsError, MAX_FACTORY_ACCOUNT_MESSAGE_LENGTH)) &&
    isBoundedText(value.fetchedAt, 40) &&
    !Number.isNaN(Date.parse(value.fetchedAt))
  );
}

export function parseFactoryLimitsRefresh(
  value: unknown,
): FactoryLimitsRefreshMessage | undefined {
  if (
    !isStrictRecord(value) ||
    !hasExactKeys(value, ['type'], ['force']) ||
    value.type !== 'factory.limits.refresh'
  ) {
    return undefined;
  }
  if (value.force !== undefined && typeof value.force !== 'boolean') return undefined;
  return value.force === true
    ? { type: 'factory.limits.refresh', force: true }
    : { type: 'factory.limits.refresh' };
}

export function parseFactoryLimitsStateMessage(
  value: unknown,
): FactoryLimitsStateMessage | undefined {
  return isStrictRecord(value) &&
    hasExactKeys(value, ['type', 'sequence', 'account']) &&
    value.type === 'factory.limits' &&
    typeof value.sequence === 'number' &&
    Number.isSafeInteger(value.sequence) &&
    value.sequence >= 0 &&
    isFactoryAccountState(value.account)
    ? (value as unknown as FactoryLimitsStateMessage)
    : undefined;
}
