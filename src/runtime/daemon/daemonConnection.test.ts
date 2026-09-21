import type { DaemonApi } from './api';
import { describe, expect, it, vi } from 'vitest';

import type { connectPublicDaemon } from './connectPublicDaemon';

import { DaemonAvailabilityError, openDaemonConnection } from './daemonConnection';
import type { resolveFactoryAccessCredential } from './factoryTokenRefresh';

type ResolveCredential = typeof resolveFactoryAccessCredential;
type Connect = typeof connectPublicDaemon;

const ENDPOINT = { url: 'ws://127.0.0.1:41000' };

function okCredential(token: string): Awaited<ReturnType<ResolveCredential>> {
  return {
    status: 'ok',
    credential: {
      token,
      refreshToken: 'refresh',
      orgId: 'org-1',
      expiresAt: Date.now() + 60_000,
      source: 'keyfile-v2',
      file: 'auth.v2.file',
      encryptionKey: Buffer.alloc(32),
    },
  };
}

function fakeDroid(): DaemonApi {
  return {
    disconnect: vi.fn(),
  } as unknown as DaemonApi;
}

describe('openDaemonConnection', () => {
  it('classifies a logged-out user as availability', async () => {
    const connect = vi.fn();

    await expect(
      openDaemonConnection(ENDPOINT, {
        resolveCredential: (async () => ({
          status: 'not-logged-in',
        })) as ResolveCredential,
        connect: connect as unknown as Connect,
      }),
    ).rejects.toMatchObject({
      name: 'DaemonAvailabilityError',
      reason: 'not-logged-in',
    });
    expect(connect).not.toHaveBeenCalled();
  });

  it('classifies unreadable credentials as availability', async () => {
    await expect(
      openDaemonConnection(ENDPOINT, {
        resolveCredential: (async () => ({
          status: 'unreadable',
        })) as ResolveCredential,
        connect: vi.fn() as unknown as Connect,
      }),
    ).rejects.toMatchObject({ reason: 'credentials-unreadable' });
  });

  it('passes the token through the auth.apiKey channel', async () => {
    const droid = fakeDroid();
    const connect = vi.fn(async () => droid);

    const connection = await openDaemonConnection(ENDPOINT, {
      resolveCredential: async () => okCredential('jwt-token-value'),
      connect: connect as unknown as Connect,
    });

    expect(connect).toHaveBeenCalledOnce();
    const options = (
      connect.mock.calls[0] as unknown as [{ url: string; auth: { apiKey: string } }]
    )[0];
    expect(options.url).toBe(ENDPOINT.url);
    expect(options.auth).toEqual({ apiKey: 'jwt-token-value' });
    expect(connection.droid).toBe(droid);
    expect(connection.status()).toBe('connected');
  });

  it('sanitizes connect failures into availability errors', async () => {
    const failure = openDaemonConnection(ENDPOINT, {
      resolveCredential: async () => okCredential('jwt-token-value'),
      connect: (async () => {
        throw new Error('handshake with token jwt-token-value failed');
      }) as unknown as Connect,
    });

    await expect(failure).rejects.toBeInstanceOf(DaemonAvailabilityError);
    await expect(failure).rejects.toMatchObject({
      reason: 'connect-failed',
    });
    await failure.catch((error: Error) => {
      expect(error.message).not.toContain('jwt-token-value');
    });
  });

  it('flips status on authentication errors from the SDK', async () => {
    let authCallback: ((error: Error) => void) | undefined;
    const connect = vi.fn(
      async (options: { onAuthenticationError?: (error: Error) => void }) => {
        authCallback = options.onAuthenticationError;
        return fakeDroid();
      },
    );

    const connection = await openDaemonConnection(ENDPOINT, {
      resolveCredential: async () => okCredential('jwt'),
      connect: connect as unknown as Connect,
    });

    expect(connection.status()).toBe('connected');
    authCallback?.(new Error('expired'));
    expect(connection.status()).toBe('auth-error');
  });

  it('re-reads credentials for reconnect and never reuses a token after sign-out', async () => {
    const resolveCredential = vi.fn<ResolveCredential>()
      .mockResolvedValueOnce(okCredential('initial-test-token'))
      .mockResolvedValueOnce(okCredential('refreshed-test-token'))
      .mockResolvedValueOnce({ status: 'not-logged-in' });
    let reconnectToken!: NonNullable<Parameters<Connect>[0]['getAccessToken']>;
    const connection = await openDaemonConnection(ENDPOINT, {
      resolveCredential,
      connect: async (options) => {
        reconnectToken = options.getAccessToken!;
        return fakeDroid();
      },
    });
    await expect(reconnectToken()).resolves.toBe('refreshed-test-token');
    await expect(reconnectToken()).resolves.toBeNull();
    expect(resolveCredential).toHaveBeenCalledTimes(3);
    connection.dispose();
  });

  it('keeps authentication failure until a restored connection is authenticated', async () => {
    let callbacks!: Parameters<Connect>[0];
    const connection = await openDaemonConnection(ENDPOINT, {
      resolveCredential: async () => okCredential('test-only'),
      connect: async (options) => { callbacks = options; return fakeDroid(); },
    });
    callbacks.onConnectionState?.('recovering');
    expect(connection.status()).toBe('recovering');
    callbacks.onAuthenticationError?.(new Error('expired'));
    callbacks.onConnectionState?.('recovering');
    expect(connection.status()).toBe('auth-error');
    callbacks.onConnectionState?.('connected');
    expect(connection.status()).toBe('connected');
    connection.dispose();
  });

  it('disconnects and reports failed after dispose', async () => {
    const droid = fakeDroid();
    const connection = await openDaemonConnection(ENDPOINT, {
      resolveCredential: async () => okCredential('jwt'),
      connect: (async () => droid) as unknown as Connect,
    });

    connection.dispose();

    expect(droid.disconnect).toHaveBeenCalledOnce();
    expect(connection.status()).toBe('failed');
  });
});
