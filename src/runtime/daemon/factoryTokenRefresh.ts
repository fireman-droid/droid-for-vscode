import {
  closeSync,
  linkSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import {
  defaultFactoryHome,
  readFactoryAccessCredential,
  writeFactoryAccessCredential,
  type FactoryAccessCredential,
  type FactoryCredentialResult,
  type LoadedFactoryCredential,
} from './factoryCredentials';

const TOKEN_REFRESH_SKEW_SECONDS = 60;
const REFRESH_ATTEMPTS = 3;
const REFRESH_BACKOFF_MS = 500;
const AUTH_LOCK_STALE_MS = 30_000;
const AUTH_LOCK_ATTEMPTS = 80;
const AUTH_LOCK_WAIT_MS = 50;
const PRODUCTION_CLIENT_ID = 'client_01HNM792M5G5G1A2THWPXKFMXB';
const DEFAULT_WORKOS_BASE_URL = 'https://api.workos.com/user_management';

export type ResolvedFactoryCredentialResult =
  | FactoryCredentialResult
  | { readonly status: 'refresh-failed'; readonly permanent: boolean };

export interface FactoryTokenRefreshDeps {
  readonly readCredential: typeof readFactoryAccessCredential;
  readonly writeCredential: typeof writeFactoryAccessCredential;
  readonly fetch: typeof fetch;
  readonly now: () => number;
  readonly sleep: (milliseconds: number) => Promise<void>;
  readonly factoryHome: string;
  readonly workosBaseUrl: string;
  readonly acquireLock: (
    file: string,
    operation: () => Promise<ResolvedFactoryCredentialResult>,
  ) => Promise<ResolvedFactoryCredentialResult>;
}

export async function resolveFactoryAccessCredential(
  deps: Partial<FactoryTokenRefreshDeps> = {},
): Promise<ResolvedFactoryCredentialResult> {
  const d = withDefaults(deps);
  const current = await d.readCredential(d.factoryHome);
  if (current.status !== 'ok' || !needsRefresh(current.credential, d.now())) {
    return current;
  }
  return d.acquireLock(
    path.join(d.factoryHome, 'auth.v2.write.lock'),
    async () => {
      // Another window or the CLI may have refreshed while we waited.
      const latest = await d.readCredential(d.factoryHome);
      if (
        latest.status !== 'ok' ||
        !needsRefresh(latest.credential, d.now())
      ) {
        return latest;
      }
      const refreshed = await refreshCredential(latest.credential, d);
      if (!refreshed.ok) {
        return { status: 'refresh-failed', permanent: refreshed.permanent };
      }
      try {
        return {
          status: 'ok',
          credential: d.writeCredential(latest.credential, refreshed.credential),
        };
      } catch {
        return { status: 'refresh-failed', permanent: false };
      }
    },
  );
}

function needsRefresh(
  credential: FactoryAccessCredential,
  nowMilliseconds: number,
): boolean {
  return (
    credential.expiresAt <= 0 ||
    credential.expiresAt - Math.floor(nowMilliseconds / 1000) <=
      TOKEN_REFRESH_SKEW_SECONDS
  );
}

async function refreshCredential(
  current: LoadedFactoryCredential,
  deps: FactoryTokenRefreshDeps,
): Promise<
  | { readonly ok: true; readonly credential: FactoryAccessCredential }
  | { readonly ok: false; readonly permanent: boolean }
> {
  for (let attempt = 1; attempt <= REFRESH_ATTEMPTS; attempt++) {
    try {
      const response = await deps.fetch(
        `${deps.workosBaseUrl.replace(/\/+$/u, '')}/authenticate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: current.refreshToken,
            client_id: PRODUCTION_CLIENT_ID,
          }),
          redirect: 'error',
        },
      );
      if (!response.ok) {
        const permanent =
          response.status >= 400 &&
          response.status < 500 &&
          response.status !== 408 &&
          response.status !== 429;
        if (permanent) {
          return { ok: false, permanent: true };
        }
        throw new Error('transient token refresh failure');
      }
      const raw = await response.text();
      if (raw.length > 64 * 1024) {
        return { ok: false, permanent: true };
      }
      let payload: {
        access_token?: unknown;
        refresh_token?: unknown;
      };
      try {
        payload = JSON.parse(raw) as typeof payload;
      } catch {
        return { ok: false, permanent: true };
      }
      if (
        typeof payload.access_token !== 'string' ||
        payload.access_token.length === 0 ||
        payload.access_token.length > 16 * 1024 ||
        typeof payload.refresh_token !== 'string' ||
        payload.refresh_token.length === 0 ||
        payload.refresh_token.length > 16 * 1024
      ) {
        return { ok: false, permanent: true };
      }
      const expiresAt = jwtExpiresAt(payload.access_token);
      if (expiresAt <= Math.floor(deps.now() / 1000)) {
        return { ok: false, permanent: true };
      }
      return {
        ok: true,
        credential: {
          token: payload.access_token,
          refreshToken: payload.refresh_token,
          orgId: current.orgId,
          expiresAt,
        },
      };
    } catch {
      if (attempt === REFRESH_ATTEMPTS) {
        return { ok: false, permanent: false };
      }
      await deps.sleep(REFRESH_BACKOFF_MS * attempt);
    }
  }
  return { ok: false, permanent: false };
}

function jwtExpiresAt(token: string): number {
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

async function withAuthLock(
  file: string,
  operation: () => Promise<ResolvedFactoryCredentialResult>,
): Promise<ResolvedFactoryCredentialResult> {
  const owner = JSON.stringify({
    pid: process.pid,
    createdAt: Date.now(),
    nonce: Math.random().toString(36).slice(2),
  });
  for (let attempt = 0; attempt < AUTH_LOCK_ATTEMPTS; attempt++) {
    let descriptor: number | null = null;
    try {
      descriptor = openSync(file, 'wx', 0o600);
      writeFileSync(descriptor, owner, 'utf8');
      closeSync(descriptor);
      descriptor = null;
      try {
        return await operation();
      } finally {
        deleteOwnedLock(file, owner);
      }
    } catch (error) {
      if (descriptor !== null) {
        closeSync(descriptor);
      }
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        return { status: 'refresh-failed', permanent: false };
      }
      reclaimStaleLock(file);
      await delay(AUTH_LOCK_WAIT_MS);
    }
  }
  return { status: 'refresh-failed', permanent: false };
}

function reclaimStaleLock(file: string): void {
  try {
    const raw = readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw) as { pid?: unknown; createdAt?: unknown };
    if (
      typeof parsed.pid !== 'number' ||
      typeof parsed.createdAt !== 'number' ||
      Date.now() - parsed.createdAt < AUTH_LOCK_STALE_MS ||
      isPidAlive(parsed.pid)
    ) {
      return;
    }
    deleteFileIfMatches(file, raw);
  } catch {
    // The owner released or replaced the lock while it was inspected.
  }
}

function deleteOwnedLock(file: string, owner: string): void {
  deleteFileIfMatches(file, owner);
}

function deleteFileIfMatches(file: string, expected: string): boolean {
  const moved = `${file}.${String(process.pid)}.${Math.random().toString(36).slice(2)}.inspect`;
  try {
    renameSync(file, moved);
  } catch {
    return false;
  }
  try {
    const actual = readFileSync(moved, 'utf8');
    if (actual === expected) {
      return true;
    }
    try {
      linkSync(moved, file);
    } catch {
      // Another owner already published a new lock.
    }
    return false;
  } finally {
    try {
      unlinkSync(moved);
    } catch {
      // Already removed.
    }
  }
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function withDefaults(
  deps: Partial<FactoryTokenRefreshDeps>,
): FactoryTokenRefreshDeps {
  return {
    readCredential: deps.readCredential ?? readFactoryAccessCredential,
    writeCredential: deps.writeCredential ?? writeFactoryAccessCredential,
    fetch: deps.fetch ?? fetch,
    now: deps.now ?? Date.now,
    sleep: deps.sleep ?? delay,
    factoryHome: deps.factoryHome ?? defaultFactoryHome(),
    workosBaseUrl:
      deps.workosBaseUrl ??
      process.env['FACTORY_WORKOS_BASE_URL'] ??
      DEFAULT_WORKOS_BASE_URL,
    acquireLock: deps.acquireLock ?? withAuthLock,
  };
}
