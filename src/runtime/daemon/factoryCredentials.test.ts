import { createCipheriv, randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { readFactoryAccessCredential } from './factoryCredentials';

function encodeBase64Url(value: string): string {
  return Buffer.from(value, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function createJwt(payload: Record<string, unknown>): string {
  const header = encodeBase64Url(JSON.stringify({ alg: 'none', typ: 'JWT' }));
  const body = encodeBase64Url(JSON.stringify(payload));
  return `${header}.${body}.signature`;
}

function writeEncryptedFixture(
  home: string,
  payload: Record<string, unknown>,
  key: Buffer = randomBytes(32),
): Buffer {
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, 'auth.v2.key'), key.toString('base64'), 'latin1');
  writeFileSync(
    join(home, 'auth.v2.file'),
    `${iv.toString('base64')}:${tag.toString('base64')}:${ciphertext.toString('base64')}`,
    'latin1',
  );
  return key;
}

describe('readFactoryAccessCredential', () => {
  it('decrypts a valid fixture into token, orgId, and expiresAt', () => {
    const home = mkdtempSync(join(tmpdir(), 'droidvisx-factory-cred-'));
    const token = createJwt({ exp: 1_700_000_000, iss: 'https://api.workos.com' });
    writeEncryptedFixture(home, {
      access_token: token,
      refresh_token: 'refresh',
      active_organization_id: 'org_test_1234567890',
    });

    const result = readFactoryAccessCredential(home);

    expect(result).toEqual({
      status: 'ok',
      credential: {
        token,
        orgId: 'org_test_1234567890',
        expiresAt: 1_700_000_000,
      },
    });
  });

  it('returns not-logged-in when auth files are missing', () => {
    const home = mkdtempSync(join(tmpdir(), 'droidvisx-factory-cred-'));

    expect(readFactoryAccessCredential(home)).toEqual({
      status: 'not-logged-in',
    });
  });

  it('returns unreadable when the GCM auth tag is tampered', () => {
    const home = mkdtempSync(join(tmpdir(), 'droidvisx-factory-cred-'));
    const key = writeEncryptedFixture(home, {
      access_token: createJwt({ exp: 1_700_000_000 }),
      refresh_token: 'refresh',
      active_organization_id: 'org_test_1234567890',
    });

    const encrypted = join(home, 'auth.v2.file');
    const [iv, tag, ciphertext] = readFileSync(encrypted, 'latin1')
      .trim()
      .split(':');
    const tamperedTag = Buffer.from(tag, 'base64');
    tamperedTag[0] ^= 0xff;
    writeFileSync(
      encrypted,
      `${iv}:${tamperedTag.toString('base64')}:${ciphertext}`,
      'latin1',
    );
    writeFileSync(join(home, 'auth.v2.key'), key.toString('base64'), 'latin1');

    expect(readFactoryAccessCredential(home)).toEqual({ status: 'unreadable' });
  });

  it('returns unreadable when the AES key is not 32 bytes', () => {
    const home = mkdtempSync(join(tmpdir(), 'droidvisx-factory-cred-'));
    writeEncryptedFixture(home, {
      access_token: createJwt({ exp: 1_700_000_000 }),
      refresh_token: 'refresh',
      active_organization_id: 'org_test_1234567890',
    });
    writeFileSync(
      join(home, 'auth.v2.key'),
      randomBytes(16).toString('base64'),
      'latin1',
    );

    expect(readFactoryAccessCredential(home)).toEqual({ status: 'unreadable' });
  });

  it('returns ok with expiresAt 0 when the JWT has no exp claim', () => {
    const home = mkdtempSync(join(tmpdir(), 'droidvisx-factory-cred-'));
    const token = createJwt({ iss: 'https://api.workos.com' });
    writeEncryptedFixture(home, {
      access_token: token,
      refresh_token: 'refresh',
      active_organization_id: 'org_test_1234567890',
    });

    const result = readFactoryAccessCredential(home);

    expect(result).toEqual({
      status: 'ok',
      credential: {
        token,
        orgId: 'org_test_1234567890',
        expiresAt: 0,
      },
    });
  });
});
