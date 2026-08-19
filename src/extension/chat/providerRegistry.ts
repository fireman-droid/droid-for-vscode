import { randomUUID } from 'node:crypto';

import {
  CUSTOM_MODEL_PROVIDERS,
  MAX_CUSTOM_MODEL_KEY_LENGTH,
  isCustomModelBaseUrl,
  isSafeText,
  type CustomModelProvider,
} from '../../shared/customModelsProtocol';

const STORAGE_KEY = 'droidvisx.customModelProviders.v1';
const SECRET_PREFIX = 'droidvisx.customModelProvider.';
const MAX_PROVIDER_NAME_LENGTH = 80;

export interface ProviderConnection {
  readonly id: string;
  readonly displayName: string;
  readonly protocol: CustomModelProvider;
  readonly rootUrl: string;
  readonly apiBaseUrl: string;
}

interface ProviderStore {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): Thenable<void>;
}

interface ProviderSecrets {
  get(key: string): Thenable<string | undefined>;
  store(key: string, value: string): Thenable<void>;
  delete(key: string): Thenable<void>;
}

/**
 * Host-owned connection metadata. Credentials are deliberately kept in
 * SecretStorage and are only read at the final daemon or HTTP hand-off.
 * The webview sees the safe connection projection made by customModels.ts.
 */
export class ProviderRegistry {
  constructor(
    private readonly store: ProviderStore,
    private readonly secrets: ProviderSecrets,
  ) {}

  list(): readonly ProviderConnection[] {
    const raw = this.store.get<unknown>(STORAGE_KEY);
    if (!Array.isArray(raw)) {
      return [];
    }
    const seen = new Set<string>();
    const providers: ProviderConnection[] = [];
    for (const item of raw) {
      const provider = parseStoredProvider(item);
      if (provider !== null && !seen.has(provider.id)) {
        seen.add(provider.id);
        providers.push(provider);
      }
    }
    return providers;
  }

  get(id: string): ProviderConnection | null {
    return this.list().find((provider) => provider.id === id) ?? null;
  }

  async save(input: {
    readonly id?: string;
    readonly displayName: string;
    readonly protocol: CustomModelProvider;
    readonly rootUrl: string;
    readonly apiKey?: string;
  }): Promise<ProviderConnection> {
    if (
      !isSafeText(input.displayName, MAX_PROVIDER_NAME_LENGTH) ||
      !(CUSTOM_MODEL_PROVIDERS as readonly string[]).includes(input.protocol) ||
      !isCustomModelBaseUrl(input.rootUrl) ||
      (input.apiKey !== undefined && !isProviderKey(input.apiKey))
    ) {
      throw new Error('invalid-provider-connection');
    }
    const existing = input.id === undefined ? null : this.get(input.id);
    if (input.id !== undefined && existing === null) {
      throw new Error('unknown-provider-connection');
    }
    const provider: ProviderConnection = {
      id: existing?.id ?? randomUUID(),
      displayName: input.displayName,
      protocol: input.protocol,
      rootUrl: normalizeRootUrl(input.rootUrl),
      apiBaseUrl: resolveProviderApiBase(input.protocol, input.rootUrl),
    };
    if (
      this.list().some(
        (item) =>
          item.id !== provider.id &&
          item.protocol === provider.protocol &&
          item.apiBaseUrl === provider.apiBaseUrl,
      )
    ) {
      throw new Error('duplicate-provider-connection');
    }
    const next = [
      ...this.list().filter((item) => item.id !== provider.id),
      provider,
    ];
    await this.store.update(STORAGE_KEY, next);
    if (input.apiKey !== undefined) {
      await this.secrets.store(secretKey(provider.id), input.apiKey);
    }
    return provider;
  }

  async delete(id: string): Promise<void> {
    const provider = this.get(id);
    if (provider === null) {
      return;
    }
    await this.store.update(
      STORAGE_KEY,
      this.list().filter((item) => item.id !== id),
    );
    await this.secrets.delete(secretKey(id));
  }

  async apiKey(id: string): Promise<string | undefined> {
    return this.get(id) === null ? undefined : this.secrets.get(secretKey(id));
  }

  async hasApiKey(id: string): Promise<boolean> {
    return (await this.apiKey(id)) !== undefined;
  }
}

export function resolveProviderApiBase(
  protocol: CustomModelProvider,
  rootUrl: string,
): string {
  const url = new URL(normalizeRootUrl(rootUrl));
  const path = url.pathname.replace(/\/+$/u, '');
  if (path !== '' && path !== '/') {
    return url.toString();
  }
  // These are the only default path conventions accepted by the existing
  // host discovery client. Explicit compatible paths remain untouched.
  url.pathname =
    protocol === 'anthropic' && /(^|\.)deepseek\.com$/iu.test(url.hostname)
      ? '/anthropic'
      : '/v1';
  return url.toString();
}

function normalizeRootUrl(value: string): string {
  const url = new URL(value);
  url.hash = '';
  url.search = '';
  url.pathname = url.pathname.replace(/\/+$/u, '') || '/';
  return url.toString().replace(/\/$/u, '');
}

function secretKey(id: string): string {
  return `${SECRET_PREFIX}${id}`;
}

function isProviderKey(value: string): boolean {
  return (
    isSafeText(value, MAX_CUSTOM_MODEL_KEY_LENGTH) &&
    value.trim() === value
  );
}

function parseStoredProvider(value: unknown): ProviderConnection | null {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value)
  ) {
    return null;
  }
  const row = value as Record<string, unknown>;
  if (
    !isSafeText(row.id, 64) ||
    !isSafeText(row.displayName, MAX_PROVIDER_NAME_LENGTH) ||
    !(CUSTOM_MODEL_PROVIDERS as readonly string[]).includes(
      row.protocol as string,
    ) ||
    !isCustomModelBaseUrl(row.rootUrl) ||
    !isCustomModelBaseUrl(row.apiBaseUrl)
  ) {
    return null;
  }
  return {
    id: row.id as string,
    displayName: row.displayName as string,
    protocol: row.protocol as CustomModelProvider,
    rootUrl: row.rootUrl as string,
    apiBaseUrl: row.apiBaseUrl as string,
  };
}
