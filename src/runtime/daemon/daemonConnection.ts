import { connectToDaemon, type ConnectedDroid } from '@factory/droid-sdk';

import { readFactoryAccessCredential } from './factoryCredentials';

export type DaemonAvailabilityReason =
  | 'not-logged-in'
  | 'credentials-unreadable'
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
  readonly droid: ConnectedDroid;
  status(): DaemonConnectionStatus;
  dispose(): void;
}

export interface DaemonConnectionDeps {
  readonly readCredential: typeof readFactoryAccessCredential;
  readonly connect: typeof connectToDaemon;
}

/**
 * Connects to and authenticates against a daemon endpoint.
 *
 * The local credential is re-read on every call (never cached; the
 * droid CLI refreshes it in the background) and only ever passed to
 * the SDK in memory. The SDK facade's `auth.apiKey` field is actually
 * the token channel, so the WorkOS JWT goes there.
 */
export async function openDaemonConnection(
  endpoint: { readonly url: string },
  deps: Partial<DaemonConnectionDeps> = {},
): Promise<DaemonConnection> {
  const readCredential = deps.readCredential ?? readFactoryAccessCredential;
  const connect = deps.connect ?? connectToDaemon;

  const credential = readCredential();
  if (credential.status === 'not-logged-in') {
    throw new DaemonAvailabilityError(
      'not-logged-in',
      'Sign in with the droid CLI to use daemon features.',
    );
  }
  if (credential.status !== 'ok') {
    throw new DaemonAvailabilityError(
      'credentials-unreadable',
      'Local droid credentials could not be read.',
    );
  }

  let status: DaemonConnectionStatus = 'connected';
  let droid: ConnectedDroid;
  try {
    droid = await connect({
      url: endpoint.url,
      auth: { apiKey: credential.credential.token },
      onAuthenticationError: () => {
        status = 'auth-error';
      },
      onError: () => {
        if (status === 'connected') {
          status = 'failed';
        }
      },
    });
  } catch {
    // Deliberately drop the original error: SDK connect errors can
    // embed request payloads and must never reach logs or the Bridge.
    throw new DaemonAvailabilityError(
      'connect-failed',
      'Could not connect to the local droid daemon.',
    );
  }

  return {
    droid,
    status: () => status,
    dispose: () => {
      status = 'failed';
      try {
        droid.disconnect();
      } catch {
        // Disconnect after transport loss throws; the socket is gone.
      }
    },
  };
}
