import { describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type {
  FactoryAccessCredential,
  LoadedFactoryCredential,
} from './factoryCredentials';
import { resolveFactoryAccessCredential } from './factoryTokenRefresh';

const NOW_SECONDS = 1_800_000_000;

function jwt(expiresAt: number): string {
  const encode = (value: object) =>
    Buffer.from(JSON.stringify(value), 'utf8')
      .toString('base64url');
  return `${encode({ alg: 'none' })}.${encode({ exp: expiresAt })}.signature`;
}

function loaded(expiresAt: number): LoadedFactoryCredential {
  return {
    token: jwt(expiresAt),
    refreshToken: 'refresh-old',
    orgId: 'org-1',
    expiresAt,
    source: 'keyring-v2',
    file: 'C:\\home\\.factory\\auth.v2.keyring',
    encryptionKey: Buffer.alloc(32, 1),
  };
}

function response(
  status: number,
  payload: Record<string, unknown>,
): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload),
  } as Response;
}

describe('resolveFactoryAccessCredential', () => {
  it('returns a current credential without refreshing', async () => {
    const fetch = vi.fn();
    const credential = loaded(NOW_SECONDS + 600);

    await expect(
      resolveFactoryAccessCredential({
        readCredential: async () => ({ status: 'ok', credential }),
        fetch: fetch as typeof globalThis.fetch,
        now: () => NOW_SECONDS * 1000,
        factoryHome: 'C:\\home\\.factory',
      }),
    ).resolves.toEqual({ status: 'ok', credential });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('re-reads under the lock and uses another window refresh', async () => {
    const expired = loaded(NOW_SECONDS - 1);
    const current = loaded(NOW_SECONDS + 600);
    const reads = [expired, current];
    const fetch = vi.fn();

    const result = await resolveFactoryAccessCredential({
      readCredential: async () => ({
        status: 'ok',
        credential: reads.shift() ?? current,
      }),
      acquireLock: async (_file, operation) => operation(),
      fetch: fetch as typeof globalThis.fetch,
      now: () => NOW_SECONDS * 1000,
      factoryHome: 'C:\\home\\.factory',
    });

    expect(result).toEqual({ status: 'ok', credential: current });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('refreshes and persists both rotated tokens', async () => {
    const expired = loaded(NOW_SECONDS - 1);
    const newToken = jwt(NOW_SECONDS + 3600);
    const writeCredential = vi.fn(
      (
        current: LoadedFactoryCredential,
        replacement: FactoryAccessCredential,
      ) => ({ ...current, ...replacement }),
    );
    const fetch = vi.fn(async () =>
      response(200, {
        access_token: newToken,
        refresh_token: 'refresh-new',
      }),
    );

    const result = await resolveFactoryAccessCredential({
      readCredential: async () => ({ status: 'ok', credential: expired }),
      writeCredential,
      fetch: fetch as typeof globalThis.fetch,
      acquireLock: async (_file, operation) => operation(),
      sleep: async () => undefined,
      now: () => NOW_SECONDS * 1000,
      factoryHome: 'C:\\home\\.factory',
    });

    expect(result).toMatchObject({
      status: 'ok',
      credential: {
        token: newToken,
        refreshToken: 'refresh-new',
        orgId: 'org-1',
      },
    });
    expect(writeCredential).toHaveBeenCalledWith(
      expired,
      expect.objectContaining({
        token: newToken,
        refreshToken: 'refresh-new',
      }),
    );
    const request = (fetch.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ])[1];
    expect(String(request?.body)).toContain('grant_type=refresh_token');
  });

  it('classifies a rejected refresh token as permanent', async () => {
    const credential = loaded(NOW_SECONDS - 1);

    await expect(
      resolveFactoryAccessCredential({
        readCredential: async () => ({ status: 'ok', credential }),
        fetch: vi.fn(async () => response(401, {})),
        acquireLock: async (_file, operation) => operation(),
        sleep: async () => undefined,
        now: () => NOW_SECONDS * 1000,
        factoryHome: 'C:\\home\\.factory',
      }),
    ).resolves.toEqual({ status: 'refresh-failed', permanent: true });
  });

  it('retries transient failures three times', async () => {
    const credential = loaded(NOW_SECONDS - 1);
    const fetch = vi.fn(async () => response(500, {}));
    const sleep = vi.fn(async () => undefined);

    await expect(
      resolveFactoryAccessCredential({
        readCredential: async () => ({ status: 'ok', credential }),
        fetch: fetch as typeof globalThis.fetch,
        acquireLock: async (_file, operation) => operation(),
        sleep,
        now: () => NOW_SECONDS * 1000,
        factoryHome: 'C:\\home\\.factory',
      }),
    ).resolves.toEqual({ status: 'refresh-failed', permanent: false });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('reclaims a stale dead-owner refresh lock and releases its own', async () => {
    const home = mkdtempSync(join(tmpdir(), 'droidvisx-auth-lock-'));
    const lock = join(home, 'auth.v2.write.lock');
    writeFileSync(
      lock,
      JSON.stringify({
        pid: 99_999_999,
        createdAt: Date.now() - 60_000,
        nonce: 'stale',
      }),
    );
    const expired = loaded(NOW_SECONDS - 1);
    const newToken = jwt(NOW_SECONDS + 3600);

    const result = await resolveFactoryAccessCredential({
      readCredential: async () => ({ status: 'ok', credential: expired }),
      writeCredential: (current, replacement) => ({
        ...current,
        ...replacement,
      }),
      fetch: async () =>
        response(200, {
          access_token: newToken,
          refresh_token: 'refresh-new',
        }),
      sleep: async () => undefined,
      now: () => NOW_SECONDS * 1000,
      factoryHome: home,
    });

    expect(result.status).toBe('ok');
    expect(existsSync(lock)).toBe(false);
  });
});
