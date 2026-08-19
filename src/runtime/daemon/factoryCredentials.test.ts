import { createCipheriv, randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  readFactoryAccessCredential,
  writeFactoryAccessCredential,
} from './factoryCredentials';

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
  fileName = 'auth.v2.file',
): Buffer {
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  mkdirSync(home, { recursive: true });
  if (fileName === 'auth.v2.file') {
    writeFileSync(join(home, 'auth.v2.key'), key.toString('base64'), 'latin1');
  }
  writeFileSync(
    join(home, fileName),
    `${iv.toString('base64')}:${tag.toString('base64')}:${ciphertext.toString('base64')}`,
    'latin1',
  );
  return key;
}

describe('readFactoryAccessCredential', () => {
  it('decrypts a valid legacy fixture', async () => {
    const home = mkdtempSync(join(tmpdir(), 'droidvisx-factory-cred-'));
    const token = createJwt({ exp: 1_700_000_000, iss: 'https://api.workos.com' });
    writeEncryptedFixture(home, {
      access_token: token,
      refresh_token: 'refresh',
      active_organization_id: 'org_test_1234567890',
    });

    const result = await readFactoryAccessCredential(home);

    expect(result).toMatchObject({
      status: 'ok',
      credential: {
        token,
        refreshToken: 'refresh',
        orgId: 'org_test_1234567890',
        expiresAt: 1_700_000_000,
        source: 'keyfile-v2',
        file: join(home, 'auth.v2.file'),
      },
    });
  });

  it('prefers the current keyring credential over the legacy file', async () => {
    const home = mkdtempSync(join(tmpdir(), 'droidvisx-factory-cred-'));
    const stale = createJwt({ exp: 1_700_000_000 });
    const current = createJwt({ exp: 1_800_000_000 });
    writeEncryptedFixture(home, {
      access_token: stale,
      refresh_token: 'stale-refresh',
      active_organization_id: 'org-old',
    });
    const key = writeEncryptedFixture(
      home,
      {
        access_token: current,
        refresh_token: 'current-refresh',
        active_organization_id: 'org-current',
        region: 'eu',
      },
      randomBytes(32),
      'auth.v2.keyring',
    );

    const result = await readFactoryAccessCredential(home, {
      platform: 'win32',
      getSecureKey: async () => key.toString('base64'),
    });

    expect(result).toMatchObject({
      status: 'ok',
      credential: {
        token: current,
        refreshToken: 'current-refresh',
        orgId: 'org-current',
        source: 'keyring-v2',
        region: 'eu',
      },
    });
  });

  it('does not fall back to stale legacy credentials when keyring is unreadable', async () => {
    const home = mkdtempSync(join(tmpdir(), 'droidvisx-factory-cred-'));
    writeEncryptedFixture(home, {
      access_token: createJwt({ exp: 1_700_000_000 }),
      refresh_token: 'legacy-refresh',
      active_organization_id: 'org-old',
    });
    writeEncryptedFixture(
      home,
      {
        access_token: createJwt({ exp: 1_800_000_000 }),
        refresh_token: 'current-refresh',
        active_organization_id: 'org-current',
      },
      randomBytes(32),
      'auth.v2.keyring',
    );

    await expect(
      readFactoryAccessCredential(home, {
        platform: 'win32',
        getSecureKey: async () => null,
      }),
    ).resolves.toEqual({ status: 'unreadable' });
  });

  it('returns not-logged-in when auth files are missing', async () => {
    const home = mkdtempSync(join(tmpdir(), 'droidvisx-factory-cred-'));

    await expect(readFactoryAccessCredential(home)).resolves.toEqual({
      status: 'not-logged-in',
    });
  });

  it('returns unreadable when the GCM auth tag is tampered', async () => {
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

    await expect(readFactoryAccessCredential(home)).resolves.toEqual({
      status: 'unreadable',
    });
  });

  it('returns unreadable when the AES key is not 32 bytes', async () => {
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

    await expect(readFactoryAccessCredential(home)).resolves.toEqual({
      status: 'unreadable',
    });
  });

  it('returns ok with expiresAt 0 when the JWT has no exp claim', async () => {
    const home = mkdtempSync(join(tmpdir(), 'droidvisx-factory-cred-'));
    const token = createJwt({ iss: 'https://api.workos.com' });
    writeEncryptedFixture(home, {
      access_token: token,
      refresh_token: 'refresh',
      active_organization_id: 'org_test_1234567890',
    });

    const result = await readFactoryAccessCredential(home);

    expect(result).toMatchObject({
      status: 'ok',
      credential: {
        token,
        refreshToken: 'refresh',
        orgId: 'org_test_1234567890',
        expiresAt: 0,
        source: 'keyfile-v2',
      },
    });
  });

  it('atomically writes rotated credentials in the same storage', async () => {
    const home = mkdtempSync(join(tmpdir(), 'droidvisx-factory-cred-'));
    writeEncryptedFixture(home, {
      access_token: createJwt({ exp: 1_700_000_000 }),
      refresh_token: 'refresh-old',
      active_organization_id: 'org_test',
      region: 'eu',
    });
    const current = await readFactoryAccessCredential(home);
    expect(current.status).toBe('ok');
    if (current.status !== 'ok') {
      return;
    }
    const replacement = {
      token: createJwt({ exp: 1_800_000_000 }),
      refreshToken: 'refresh-new',
      orgId: 'org_test',
      expiresAt: 1_800_000_000,
    };

    writeFactoryAccessCredential(current.credential, replacement);

    await expect(readFactoryAccessCredential(home)).resolves.toMatchObject({
      status: 'ok',
      credential: {
        ...replacement,
        source: 'keyfile-v2',
        region: 'eu',
      },
    });
  });
});
