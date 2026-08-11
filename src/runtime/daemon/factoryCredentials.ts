import { createDecipheriv } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface FactoryAccessCredential {
  /** WorkOS JWT for connectToDaemon auth (see daemon plan §2.4). */
  readonly token: string;
  /** active_organization_id from decrypted payload. */
  readonly orgId: string;
  /** JWT exp in epoch seconds; 0 when missing or unparsable. */
  readonly expiresAt: number;
}

export type FactoryCredentialResult =
  | { readonly status: 'ok'; readonly credential: FactoryAccessCredential }
  | { readonly status: 'not-logged-in' }
  | { readonly status: 'unreadable' };

const AES_KEY_BYTES = 32;
const GCM_IV_BYTES = 16;
const GCM_TAG_BYTES = 16;

function defaultFactoryHome(): string {
  return join(homedir(), '.factory');
}

function readTrimmedFile(path: string): string {
  return readFileSync(path, 'latin1').trim();
}

function parseJwtExpiresAt(token: string): number {
  const segments = token.split('.');
  if (segments.length < 2) {
    return 0;
  }

  try {
    const payloadSegment = segments[1];
    const payloadBase64 = payloadSegment.replace(/-/g, '+').replace(/_/g, '/');
    const padding = '='.repeat((4 - (payloadBase64.length % 4)) % 4);
    const payloadJson = Buffer.from(payloadBase64 + padding, 'base64').toString(
      'utf8',
    );
    const payload = JSON.parse(payloadJson) as { exp?: unknown };
    return typeof payload.exp === 'number' ? payload.exp : 0;
  } catch {
    return 0;
  }
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  );
}

/**
 * Decrypt the current Factory login token from ~/.factory/auth.v2.*.
 * Reads disk on every call; never caches. Side-effect free.
 */
export function readFactoryAccessCredential(
  factoryHome?: string,
): FactoryCredentialResult {
  const home = factoryHome ?? defaultFactoryHome();

  try {
    const keyBase64 = readTrimmedFile(join(home, 'auth.v2.key'));
    const key = Buffer.from(keyBase64, 'base64');
    if (key.length !== AES_KEY_BYTES) {
      return { status: 'unreadable' };
    }

    const encrypted = readTrimmedFile(join(home, 'auth.v2.file'));
    const segments = encrypted.split(':');
    if (segments.length !== 3) {
      return { status: 'unreadable' };
    }

    const [ivBase64, tagBase64, ciphertextBase64] = segments;
    const iv = Buffer.from(ivBase64, 'base64');
    const tag = Buffer.from(tagBase64, 'base64');
    const ciphertext = Buffer.from(ciphertextBase64, 'base64');
    if (iv.length !== GCM_IV_BYTES || tag.length !== GCM_TAG_BYTES) {
      return { status: 'unreadable' };
    }

    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);

    const parsed = JSON.parse(plaintext.toString('utf8')) as {
      access_token?: unknown;
      active_organization_id?: unknown;
    };

    if (
      typeof parsed.access_token !== 'string' ||
      parsed.access_token.length === 0 ||
      typeof parsed.active_organization_id !== 'string' ||
      parsed.active_organization_id.length === 0
    ) {
      return { status: 'unreadable' };
    }

    return {
      status: 'ok',
      credential: {
        token: parsed.access_token,
        orgId: parsed.active_organization_id,
        expiresAt: parseJwtExpiresAt(parsed.access_token),
      },
    };
  } catch (error) {
    if (isMissingFileError(error)) {
      return { status: 'not-logged-in' };
    }
    return { status: 'unreadable' };
  }
}
