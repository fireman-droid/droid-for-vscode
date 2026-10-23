import { describe, expect, it, vi } from 'vitest';
import {
  loadFactoryAccount,
  parseFactoryLimitsPayload,
  readFactoryIdentity,
  LIMITS_SIGN_IN_MESSAGE,
  LIMITS_REJECTED_MESSAGE,
} from './factoryAccount';
import type { ResolvedFactoryCredentialResult } from '../daemon/factoryTokenRefresh';

const payload = {
  usesTokenRateLimitsBilling: true,
  limits: {
    standard: {
      fiveHour: { usedPercent: 4, windowEnd: '2026-10-23T06:49:11.819Z', secondsRemaining: 3100 },
      weekly: { usedPercent: 58, windowEnd: '2026-10-26T03:30:46.541Z', secondsRemaining: 250394 },
      monthly: { usedPercent: 29, windowEnd: '2026-11-18T03:30:46.541Z', secondsRemaining: 2237594 },
    },
    core: {
      fiveHour: { usedPercent: 0, windowEnd: null, secondsRemaining: null },
      weekly: { usedPercent: 0, windowEnd: null, secondsRemaining: null },
      monthly: { usedPercent: 0, windowEnd: null, secondsRemaining: null },
    },
  },
  overagePreference: 'droidCore',
  canManageOverage: true,
  extraUsageBalanceCents: 250,
  extraUsageAllowed: true,
};

/** A token whose payload is the given object; the signature is irrelevant here. */
function tokenWith(claims: Record<string, unknown>): string {
  return `header.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`;
}

function credential(overrides: Record<string, unknown> = {}): ResolvedFactoryCredentialResult {
  return {
    status: 'ok',
    credential: {
      token: tokenWith({ email: 'user@example.com', first_name: 'Kai', last_name: 'Ge',
        external_org_id: 'org_1', profile_picture_url: 'https://example.invalid/a.png' }),
      refreshToken: 'refresh',
      orgId: 'org_1',
      expiresAt: 0,
      source: 'keyring-v2',
      file: 'auth.v2.keyring',
      encryptionKey: Buffer.alloc(32),
      ...overrides,
    },
  };
}

describe('readFactoryIdentity', () => {
  it('reads the display identity from the token payload without a request', () => {
    expect(readFactoryIdentity(credentialToken())).toEqual({
      email: 'user@example.com', displayName: 'Kai Ge', orgId: 'org_1',
    });
  });

  it('drops a token without a usable email instead of showing a blank footer', () => {
    expect(readFactoryIdentity(tokenWith({ first_name: 'Kai' }))).toBeNull();
    expect(readFactoryIdentity(tokenWith({ email: 'not-an-email' }))).toBeNull();
    expect(readFactoryIdentity('not-a-jwt')).toBeNull();
  });
});

describe('parseFactoryLimitsPayload', () => {
  it('keeps unstarted windows empty and preserves the reported percentages', () => {
    const limits = parseFactoryLimitsPayload(payload);
    expect(limits?.standard.fiveHour).toEqual({
      usedPercent: 4, windowEnd: '2026-10-23T06:49:11.819Z', secondsRemaining: 3100,
    });
    expect(limits?.core.monthly).toEqual({ usedPercent: 0, windowEnd: null, secondsRemaining: null });
    expect(limits?.extraUsageBalanceCents).toBe(250);
    expect(limits?.canManageOverage).toBe(true);
  });

  it('accepts epoch milliseconds for the window end', () => {
    const limits = parseFactoryLimitsPayload({
      ...payload,
      limits: {
        ...payload.limits,
        standard: { ...payload.limits.standard, weekly: { usedPercent: 1, windowEnd: 1_790_000_000_000, secondsRemaining: 60 } },
      },
    });
    expect(limits?.standard.weekly.windowEnd).toBe(new Date(1_790_000_000_000).toISOString());
  });

  it('rejects a payload with a missing pool or a non-numeric percentage', () => {
    expect(parseFactoryLimitsPayload({ ...payload, limits: { standard: payload.limits.standard } })).toBeNull();
    expect(parseFactoryLimitsPayload({
      ...payload,
      limits: { ...payload.limits, core: { ...payload.limits.core, weekly: { usedPercent: 'half' } } },
    })).toBeNull();
    expect(parseFactoryLimitsPayload(null)).toBeNull();
  });
});

describe('loadFactoryAccount', () => {
  it('reports the CLI sign-in requirement without calling billing', async () => {
    const fetch = vi.fn();
    const result = await loadFactoryAccount({
      resolveCredential: async () => ({ status: 'not-logged-in' }),
      fetch: fetch as unknown as typeof globalThis.fetch,
    });
    expect(result).toEqual({ status: 'unavailable', message: LIMITS_SIGN_IN_MESSAGE });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps the identity when billing is rejected so the footer still works', async () => {
    const result = await loadFactoryAccount({
      resolveCredential: async () => credential(),
      fetch: (async () => new Response('', { status: 401 })) as unknown as typeof globalThis.fetch,
    });
    expect(result.status).toBe('identity-only');
    expect(result.status === 'identity-only' ? result.limitsError : null).toBe(LIMITS_REJECTED_MESSAGE);
  });

  it('requests the documented endpoint with the CLI bearer token and org header', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify(payload), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }));
    const result = await loadFactoryAccount({
      resolveCredential: async () => credential(),
      fetch: fetch as unknown as typeof globalThis.fetch,
      environment: {},
    });
    expect(result.status).toBe('ok');
    expect(fetch).toHaveBeenCalledWith(
      'https://api.factory.ai/api/billing/limits',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ Authorization: `Bearer ${credentialToken()}`, 'X-Factory-Org-Id': 'org_1' }),
      }),
    );
  });

  it('uses the EU host for an EU account', async () => {
    const fetch = vi.fn(async (_url: string) => new Response(JSON.stringify(payload), { status: 200 }));
    await loadFactoryAccount({
      resolveCredential: async () => credential({ region: 'eu' }),
      fetch: fetch as unknown as typeof globalThis.fetch,
      environment: {},
    });
    expect(fetch.mock.calls[0]?.[0]).toBe('https://api.eu.factory.ai/api/billing/limits');
  });
});

function credentialToken(): string {
  const result = credential();
  return result.status === 'ok' ? result.credential.token : '';
}
