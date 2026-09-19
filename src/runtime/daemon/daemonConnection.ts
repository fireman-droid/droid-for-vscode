import type { DaemonApi } from './api';
import { connectPublicDaemon } from './connectPublicDaemon';

import { resolveFactoryAccessCredential } from './factoryTokenRefresh';

export type DaemonAvailabilityReason =
  | 'not-logged-in'
  | 'credentials-unreadable'
  | 'refresh-failed'
  | 'authentication-failed'
  | 'connect-failed';

/**
 * Structured availability failure so the host can distinguish "user
 * must log in with the droid CLI first" from transport-level errors.
 * Never carries token material.
 */
export class DaemonAvailabilityError extends Error {
  readonly reason: DaemonAvailabilityReason;

  constructor(reason: DaemonAvailabilityReason, message: string) {
    super(message);
    this.name = 'DaemonAvailabilityError';
    this.reason = reason;
  }
}

export type DaemonConnectionStatus = 'connected' | 'auth-error' | 'failed';

export interface DaemonConnection {
  readonly droid: DaemonApi;
  status(): DaemonConnectionStatus;
  dispose(): void;
}

export interface DaemonConnectionDeps {
  readonly resolveCredential: typeof resolveFactoryAccessCredential;
  readonly connect: typeof connectPublicDaemon;
}

/**
 * Connects to and authenticates against a daemon endpoint.
 *
 * The CLI credential is re-read and refreshed on every connection.
 * The SDK facade's `auth.apiKey` field is the daemon token channel,
 * so the current WorkOS JWT goes there.
 */
export async function openDaemonConnection(
  endpoint: { readonly url: string },
  deps: Partial<DaemonConnectionDeps> = {},
): Promise<DaemonConnection> {
  const resolveCredential = deps.resolveCredential ?? resolveFactoryAccessCredential;
  const connect = deps.connect ?? connectPublicDaemon;

  const credential = await resolveCredential();
  if (credential.status === 'not-logged-in') {
    throw new DaemonAvailabilityError(
      'not-logged-in',
      'Sign in with the droid CLI to use daemon features.',
    );
  }
  if (credential.status !== 'ok') {
    if (credential.status === 'refresh-failed') {
      throw new DaemonAvailabilityError(
        'refresh-failed',
        credential.permanent
          ? 'Droid sign-in expired. Sign in again with the droid CLI, then retry.'
          : 'Droid sign-in could not be refreshed. Check the network, then retry.',
      );
    }
    throw new DaemonAvailabilityError(
      'credentials-unreadable',
      'Local droid credentials could not be read.',
    );
  }

  const connectionState: { status: DaemonConnectionStatus } = {
    status: 'connected',
  };
  let droid: DaemonApi;
  try {
    droid = await connect({
      url: endpoint.url,
      auth: { apiKey: credential.credential.token },
      onAuthenticationError: () => {
        connectionState.status = 'auth-error';
      },
      onError: () => {
        if (connectionState.status === 'connected') {
          connectionState.status = 'failed';
        }
      },
    });
  } catch {
    // Deliberately drop the original error: SDK connect errors can
    // embed request payloads and must never reach logs or the Bridge.
    throw new DaemonAvailabilityError(
      connectionState.status === 'auth-error'
        ? 'authentication-failed'
        : 'connect-failed',
      connectionState.status === 'auth-error'
        ? 'The local droid daemon rejected the current sign-in.'
        : 'Could not connect to the local droid daemon.',
    );
  }

  return {
    droid,
    status: () => connectionState.status,
    dispose: () => {
      connectionState.status = 'failed';
      try {
        droid.disconnect();
      } catch {
        // Disconnect after transport loss throws; the socket is gone.
      }
    },
  };
}
