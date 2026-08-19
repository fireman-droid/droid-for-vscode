import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';
import { execFile } from 'node:child_process';
import {
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

export interface FactoryAccessCredential {
  readonly token: string;
  readonly refreshToken: string;
  readonly orgId: string;
  /** JWT exp in epoch seconds; 0 when missing or unparsable. */
  readonly expiresAt: number;
}

export type FactoryCredentialSource = 'keyring-v2' | 'keyfile-v2';

export interface LoadedFactoryCredential extends FactoryAccessCredential {
  readonly source: FactoryCredentialSource;
  readonly file: string;
  /** Kept in host memory only so refresh rotation can preserve the CLI format. */
  readonly encryptionKey: Buffer;
  readonly region?: string | null;
}

export type FactoryCredentialResult =
  | { readonly status: 'ok'; readonly credential: LoadedFactoryCredential }
  | { readonly status: 'not-logged-in' }
  | { readonly status: 'unreadable' };

export interface FactoryCredentialDeps {
  readonly platform: NodeJS.Platform;
  readonly environment: NodeJS.ProcessEnv;
  readonly readFile: (file: string) => string;
  readonly getSecureKey: (
    service: string,
    account: string,
    factoryHome: string,
  ) => Promise<string | null>;
  readonly randomBytes: (size: number) => Buffer;
  readonly writeFile: (file: string, contents: string) => void;
  readonly renameFile: (from: string, to: string) => void;
}

const AES_KEY_BYTES = 32;
const GCM_IV_BYTES = 16;
const GCM_TAG_BYTES = 16;
const MAX_CREDENTIAL_FILE_CHARS = 64 * 1024;
const KEYRING_SERVICE = 'Factory CLI';
const KEYRING_ACCOUNT = 'auth-encryption-key';
const MAC_KEYCHAIN_ACCOUNT = 'auth-encryption-key-security-cli';

export function defaultFactoryHome(
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const root = environment['FACTORY_HOME_OVERRIDE']?.trim() || homedir();
  return path.join(root, '.factory');
}

export async function readFactoryAccessCredential(
  factoryHome = defaultFactoryHome(),
  deps: Partial<FactoryCredentialDeps> = {},
): Promise<FactoryCredentialResult> {
  const d = withDefaults(deps);
  const secureFile = path.join(
    factoryHome,
    d.platform === 'darwin'
      ? 'auth.v2.loginkeychain'
      : 'auth.v2.keyring',
  );
  const secureAccount =
    d.platform === 'darwin' ? MAC_KEYCHAIN_ACCOUNT : KEYRING_ACCOUNT;
  try {
    const encrypted = d.readFile(secureFile);
    const encodedKey = await d.getSecureKey(
      KEYRING_SERVICE,
      secureAccount,
      factoryHome,
    );
    if (!encodedKey) {
      return { status: 'unreadable' };
    }
    const loaded = decryptCredential(
      encrypted,
      Buffer.from(encodedKey, 'base64'),
      'keyring-v2',
      secureFile,
    );
    return loaded
      ? { status: 'ok', credential: loaded }
      : { status: 'unreadable' };
  } catch (error) {
    if (!isMissingFileError(error)) {
      return { status: 'unreadable' };
    }
  }

  const legacyFile = path.join(factoryHome, 'auth.v2.file');
  try {
    const encrypted = d.readFile(legacyFile);
    const encodedKey = d.readFile(path.join(factoryHome, 'auth.v2.key')).trim();
    const loaded = decryptCredential(
      encrypted,
      Buffer.from(encodedKey, 'base64'),
      'keyfile-v2',
      legacyFile,
    );
    return loaded
      ? { status: 'ok', credential: loaded }
      : { status: 'unreadable' };
  } catch (error) {
    if (!isMissingFileError(error)) {
      return { status: 'unreadable' };
    }
  }
  return { status: 'not-logged-in' };
}

export function writeFactoryAccessCredential(
  current: LoadedFactoryCredential,
  replacement: FactoryAccessCredential,
  deps: Partial<FactoryCredentialDeps> = {},
): LoadedFactoryCredential {
  const d = withDefaults(deps);
  const iv = d.randomBytes(GCM_IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', current.encryptionKey, iv);
  const ciphertext = Buffer.concat([
    cipher.update(
      JSON.stringify({
        access_token: replacement.token,
        refresh_token: replacement.refreshToken,
        active_organization_id: replacement.orgId,
        ...(current.region === undefined ? {} : { region: current.region }),
      }),
      'utf8',
    ),
    cipher.final(),
  ]);
  const encrypted = [
    iv.toString('base64'),
    cipher.getAuthTag().toString('base64'),
    ciphertext.toString('base64'),
  ].join(':');
  const temporary = `${current.file}.${String(process.pid)}.${randomBytes(8).toString('hex')}.tmp`;
  try {
    d.writeFile(temporary, encrypted);
    d.renameFile(temporary, current.file);
  } finally {
    try {
      unlinkSync(temporary);
    } catch {
      // Rename consumed it, or the write never created it.
    }
  }
  return { ...replacement, ...storageFields(current) };
}

function decryptCredential(
  encrypted: string,
  key: Buffer,
  source: FactoryCredentialSource,
  file: string,
): LoadedFactoryCredential | null {
  if (
    key.length !== AES_KEY_BYTES ||
    encrypted.length > MAX_CREDENTIAL_FILE_CHARS
  ) {
    return null;
  }
  const segments = encrypted.trim().split(':');
  if (segments.length !== 3) {
    return null;
  }
  try {
    const iv = Buffer.from(segments[0] ?? '', 'base64');
    const tag = Buffer.from(segments[1] ?? '', 'base64');
    if (iv.length !== GCM_IV_BYTES || tag.length !== GCM_TAG_BYTES) {
      return null;
    }
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(segments[2] ?? '', 'base64')),
      decipher.final(),
    ]);
    const parsed = JSON.parse(plaintext.toString('utf8')) as {
      access_token?: unknown;
      refresh_token?: unknown;
      active_organization_id?: unknown;
      region?: unknown;
    };
    if (
      !isBoundedString(parsed.access_token, 16 * 1024) ||
      !isBoundedString(parsed.refresh_token, 16 * 1024) ||
      !isBoundedString(parsed.active_organization_id, 1024)
    ) {
      return null;
    }
    if (
      parsed.region !== undefined &&
      parsed.region !== null &&
      !isBoundedString(parsed.region, 100)
    ) {
      return null;
    }
    return {
      token: parsed.access_token,
      refreshToken: parsed.refresh_token,
      orgId: parsed.active_organization_id,
      expiresAt: parseJwtExpiresAt(parsed.access_token),
      source,
      file,
      encryptionKey: key,
      ...(parsed.region === undefined ? {} : { region: parsed.region }),
    };
  } catch {
    return null;
  }
}

function parseJwtExpiresAt(token: string): number {
  const payload = token.split('.')[1];
  if (!payload) {
    return 0;
  }
  try {
    const parsed = JSON.parse(
      Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
        .toString('utf8'),
    ) as { exp?: unknown };
    return typeof parsed.exp === 'number' ? parsed.exp : 0;
  } catch {
    return 0;
  }
}

function storageFields(current: LoadedFactoryCredential) {
  return {
    source: current.source,
    file: current.file,
    encryptionKey: current.encryptionKey,
    ...(current.region === undefined ? {} : { region: current.region }),
  } as const;
}

function isBoundedString(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  );
}

function withDefaults(
  deps: Partial<FactoryCredentialDeps>,
): FactoryCredentialDeps {
  return {
    platform: deps.platform ?? process.platform,
    environment: deps.environment ?? process.env,
    readFile:
      deps.readFile ??
      ((file) => readFileSync(file, { encoding: 'utf8', flag: 'r' })),
    getSecureKey: deps.getSecureKey ?? defaultGetSecureKey,
    randomBytes: deps.randomBytes ?? randomBytes,
    writeFile:
      deps.writeFile ??
      ((file, contents) => {
        writeFileSync(file, contents, { encoding: 'utf8', mode: 0o600 });
      }),
    renameFile: deps.renameFile ?? renameSync,
  };
}

async function defaultGetSecureKey(
  service: string,
  account: string,
  factoryHome: string,
): Promise<string | null> {
  if (process.platform === 'darwin') {
    return readMacKeychain(service, account);
  }
  const addon = verifiedKeytarPath(factoryHome);
  const keytar = createRequire(__filename)(addon) as {
    getPassword(serviceName: string, accountName: string): Promise<string | null>;
  };
  return keytar.getPassword(service, account);
}

function verifiedKeytarPath(factoryHome: string): string {
  const bin = realpathSync(path.join(factoryHome, 'bin'));
  const addon = realpathSync(path.join(bin, 'keytar.node'));
  const relative = path.relative(bin, addon);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Factory keytar path escaped the CLI bin directory');
  }
  const expected = readFileSync(path.join(bin, '.keytar-sha256'), 'utf8').trim();
  const actual = createHash('sha256')
    .update(readFileSync(addon))
    .digest('hex');
  if (!/^[a-f0-9]{64}$/iu.test(expected) || actual !== expected.toLowerCase()) {
    throw new Error('Factory keytar checksum mismatch');
  }
  return addon;
}

function readMacKeychain(
  service: string,
  account: string,
): Promise<string | null> {
  return new Promise((resolve, reject) => {
    execFile(
      '/usr/bin/security',
      ['find-generic-password', '-s', service, '-a', account, '-w'],
      { timeout: 10_000 },
      (error, stdout) => {
        if (error) {
          reject(error);
        } else {
          resolve(stdout.trim() || null);
        }
      },
    );
  });
}
