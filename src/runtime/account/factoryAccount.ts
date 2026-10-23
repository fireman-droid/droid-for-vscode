import process from 'node:process';
import {
  resolveFactoryAccessCredential,
  type ResolvedFactoryCredentialResult,
} from '../daemon/factoryTokenRefresh';
import type { FactoryIdentity } from '../../shared/protocol/factoryAccountProtocol';

/**
 * Factory account identity and credit limits read from the CLI's own
 * sign-in, so the editor reports the same numbers as `droid /limits`.
 *
 * Identity comes from the access-token payload (no extra request);
 * limits come from the billing endpoint the CLI calls. Both stay in
 * the Extension Host: callers receive bounded projections and never
 * the token itself.
 */

const PRODUCTION_API_BASE_URL = 'https://api.factory.ai';
const EU_API_BASE_URL = 'https://api.eu.factory.ai';
const LIMITS_PATH = '/api/billing/limits';
const LIMITS_TIMEOUT_MS = 8_000;

export const LIMITS_SIGN_IN_MESSAGE =
  'Sign in with the droid CLI to see your Factory usage.';
export const LIMITS_UNREADABLE_MESSAGE =
  'The local droid sign-in could not be read. Run droid to sign in again.';
export const LIMITS_EXPIRED_MESSAGE =
  'The droid sign-in expired. Run droid to sign in again.';
export const LIMITS_REFRESH_FAILED_MESSAGE =
  'The droid sign-in could not be refreshed. Check the network, then retry.';
export const LIMITS_REQUEST_FAILED_MESSAGE =
  'Factory did not return your usage. Check the network, then retry.';
export const LIMITS_REJECTED_MESSAGE =
  'Factory rejected the usage request. Sign in with the droid CLI again.';

export type FactoryAccountResult =
  | {
      readonly status: 'ok';
      readonly identity: FactoryIdentity;
      readonly limits: FactoryLimitsPayload;
    }
  | {
      readonly status: 'identity-only';
      readonly identity: FactoryIdentity;
      readonly limitsError: string;
    }
  | { readonly status: 'unavailable'; readonly message: string };

/** Validated projection of the billing payload. */
export interface FactoryLimitsPayload {
  readonly standard: RawLimitPool;
  readonly core: RawLimitPool;
  readonly extraUsageBalanceCents: number | null;
  readonly extraUsageAllowed: boolean;
  readonly canManageOverage: boolean;
}

export interface RawLimitWindow {
  readonly usedPercent: number;
  readonly windowEnd: string | null;
  readonly secondsRemaining: number | null;
}

export type RawLimitPool = Readonly<Record<'fiveHour' | 'weekly' | 'monthly', RawLimitWindow>>;

export interface FactoryAccountDeps {
  readonly resolveCredential: typeof resolveFactoryAccessCredential;
  readonly fetch: typeof fetch;
  readonly environment: NodeJS.ProcessEnv;
  readonly now: () => Date;
}

/**
 * Reads the signed-in account and its current limits. A failed limits
 * request still returns the identity, so the settings footer keeps
 * working when the network does.
 */
export async function loadFactoryAccount(
  deps: Partial<FactoryAccountDeps> = {},
): Promise<FactoryAccountResult> {
  const d: FactoryAccountDeps = {
    resolveCredential: deps.resolveCredential ?? resolveFactoryAccessCredential,
    fetch: deps.fetch ?? fetch,
    environment: deps.environment ?? process.env,
    now: deps.now ?? (() => new Date()),
  };
  const credential = await d.resolveCredential();
  const unavailable = credentialUnavailable(credential);
  if (unavailable !== null) {
    return { status: 'unavailable', message: unavailable };
  }
  if (credential.status !== 'ok') {
    return { status: 'unavailable', message: LIMITS_UNREADABLE_MESSAGE };
  }
  const identity = readFactoryIdentity(credential.credential.token);
  if (identity === null) {
    return { status: 'unavailable', message: LIMITS_UNREADABLE_MESSAGE };
  }
  try {
    const limits = await fetchFactoryLimits({
      token: credential.credential.token,
      orgId: credential.credential.orgId,
      region: credential.credential.region ?? null,
      fetch: d.fetch,
      environment: d.environment,
    });
    return { status: 'ok', identity, limits };
  } catch (error) {
    return {
      status: 'identity-only',
      identity,
      limitsError:
        error instanceof FactoryLimitsError
          ? error.message
          : LIMITS_REQUEST_FAILED_MESSAGE,
    };
  }
}

function credentialUnavailable(
  credential: ResolvedFactoryCredentialResult,
): string | null {
  switch (credential.status) {
    case 'not-logged-in':
      return LIMITS_SIGN_IN_MESSAGE;
    case 'unreadable':
      return LIMITS_UNREADABLE_MESSAGE;
    case 'refresh-failed':
      return credential.permanent
        ? LIMITS_EXPIRED_MESSAGE
        : LIMITS_REFRESH_FAILED_MESSAGE;
    default:
      return null;
  }
}

/**
 * Decodes the access-token payload for display identity. The payload
 * is untrusted input from a file on disk, so every field is bounded
 * and anything unusable drops to null instead of failing the surface.
 */
export function readFactoryIdentity(token: string): FactoryIdentity | null {
  const payload = readJwtPayload(token);
  if (payload === null) return null;
  const email = readClaim(payload['email'], 254);
  if (email === null || !email.includes('@')) return null;
  const first = readClaim(payload['first_name'], 128);
  const last = readClaim(payload['last_name'], 128);
  const displayName = [first, last].filter((part) => part !== null).join(' ').trim();
  const orgId =
    readClaim(payload['external_org_id'], 128) ?? readClaim(payload['org_id'], 128);
  return { email, displayName: displayName.length > 0 ? displayName : null, orgId };
}

function readJwtPayload(token: string): Record<string, unknown> | null {
  const segment = token.split('.')[1];
  if (segment === undefined || segment.length === 0 || segment.length > 16 * 1024) {
    return null;
  }
  try {
    const decoded = Buffer.from(
      segment.replace(/-/g, '+').replace(/_/g, '/'),
      'base64',
    ).toString('utf8');
    const parsed: unknown = JSON.parse(decoded);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function readClaim(value: unknown, max: number): string | null {
  return typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= max &&
    !/[\u0000-\u001f\u007f]/.test(value)
    ? value.trim()
    : null;
}

/** Failure carrying a message already safe to show in the webview. */
class FactoryLimitsError extends Error {}

export interface FetchFactoryLimitsOptions {
  readonly token: string;
  readonly orgId: string;
  readonly region: string | null;
  readonly fetch: typeof fetch;
  readonly environment: NodeJS.ProcessEnv;
}

/**
 * Calls the same billing endpoint `droid /limits` uses and validates
 * the payload before anything reaches the Bridge. Windows that have
 * not started arrive as null and stay null.
 */
export async function fetchFactoryLimits(
  options: FetchFactoryLimitsOptions,
): Promise<FactoryLimitsPayload> {
  const url = `${factoryApiBaseUrl(options)}${LIMITS_PATH}`;
  let response: Response;
  try {
    response = await options.fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${options.token}`,
        'X-Factory-Org-Id': options.orgId,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(LIMITS_TIMEOUT_MS),
    });
  } catch {
    throw new FactoryLimitsError(LIMITS_REQUEST_FAILED_MESSAGE);
  }
  if (response.status === 401 || response.status === 403) {
    throw new FactoryLimitsError(LIMITS_REJECTED_MESSAGE);
  }
  if (!response.ok) {
    throw new FactoryLimitsError(LIMITS_REQUEST_FAILED_MESSAGE);
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new FactoryLimitsError(LIMITS_REQUEST_FAILED_MESSAGE);
  }
  const limits = parseFactoryLimitsPayload(body);
  if (limits === null) {
    throw new FactoryLimitsError(LIMITS_REQUEST_FAILED_MESSAGE);
  }
  return limits;
}

/** EU accounts and explicit overrides keep their own API host. */
function factoryApiBaseUrl(options: FetchFactoryLimitsOptions): string {
  const override = options.environment['FACTORY_API_BASE_URL']?.trim();
  if (override !== undefined && /^https:\/\/[^\s/]+$/u.test(override)) {
    return override.replace(/\/+$/u, '');
  }
  return options.region === 'eu' ? EU_API_BASE_URL : PRODUCTION_API_BASE_URL;
}

/**
 * Validates the billing response. Unknown extra keys are ignored (the
 * endpoint is expected to grow), but every consumed field must be
 * well formed or the whole payload is rejected.
 */
export function parseFactoryLimitsPayload(value: unknown): FactoryLimitsPayload | null {
  if (!isRecord(value)) return null;
  const limits = value['limits'];
  if (!isRecord(limits)) return null;
  const standard = parseLimitPool(limits['standard']);
  const core = parseLimitPool(limits['core']);
  if (standard === null || core === null) return null;
  const balance = value['extraUsageBalanceCents'];
  return {
    standard,
    core,
    extraUsageBalanceCents:
      typeof balance === 'number' && Number.isSafeInteger(balance) && balance >= 0
        ? balance
        : null,
    extraUsageAllowed: value['extraUsageAllowed'] === true,
    canManageOverage: value['canManageOverage'] === true,
  };
}

function parseLimitPool(value: unknown): RawLimitPool | null {
  if (!isRecord(value)) return null;
  const fiveHour = parseLimitWindow(value['fiveHour']);
  const weekly = parseLimitWindow(value['weekly']);
  const monthly = parseLimitWindow(value['monthly']);
  return fiveHour === null || weekly === null || monthly === null
    ? null
    : { fiveHour, weekly, monthly };
}

function parseLimitWindow(value: unknown): RawLimitWindow | null {
  if (!isRecord(value)) return null;
  const used = value['usedPercent'];
  if (typeof used !== 'number' || !Number.isFinite(used)) return null;
  const windowEnd = readWindowEnd(value['windowEnd']);
  const remaining = value['secondsRemaining'];
  return {
    usedPercent: Math.min(100, Math.max(0, used)),
    windowEnd,
    secondsRemaining:
      typeof remaining === 'number' &&
      Number.isSafeInteger(remaining) &&
      remaining >= 0
        ? remaining
        : null,
  };
}

/** The endpoint reports either an ISO instant or epoch milliseconds. */
function readWindowEnd(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  if (typeof value === 'string' && value.length > 0 && value.length <= 40) {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
