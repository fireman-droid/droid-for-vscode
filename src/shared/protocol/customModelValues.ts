/** Shared values for custom-model and provider-management bridge contracts. */
export const MAX_CUSTOM_MODEL_URL_LENGTH = 2048;
export const MAX_CUSTOM_MODEL_KEY_LENGTH = 512;
export const MAX_CUSTOM_MODEL_MASK_LENGTH = 32;
export const MAX_CUSTOM_MODEL_PROVIDER_LENGTH = 64;
export const MAX_CUSTOM_MODEL_OUTPUT_TOKENS = 100_000_000;
export const MAX_CUSTOM_MODELS_MESSAGE_LENGTH = 512;
export const MAX_CUSTOM_MODEL_IMPORT_ITEMS = 32;

/**
 * Providers the save form offers. The upsert RPC accepts an open
 * string, but the GUI only writes the three documented BYOK values
 * (docs.factory.ai/cli/byok); Bedrock and other providers stay
 * settings.json-managed. List items keep provider as an open string
 * so existing entries with other providers still display.
 */
export const CUSTOM_MODEL_PROVIDERS = [
  'anthropic',
  'openai',
  'generic-chat-completion-api',
] as const;
export type CustomModelProvider = (typeof CUSTOM_MODEL_PROVIDERS)[number];

/** One provider-returned model projected without arbitrary metadata. */
export interface DiscoveredCustomModel {
  readonly model: string;
  readonly displayName?: string;
}

/** Non-empty, trimmed, bounded, control-character-free text. */
export function isSafeText(value: unknown, maximumLength: number): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maximumLength &&
    value.trim() === value &&
    // eslint-disable-next-line no-control-regex
    !/[\u0000-\u001f\u007f-\u009f]/.test(value)
  );
}

export function isCustomModelBaseUrl(value: unknown): boolean {
  if (!isSafeText(value, MAX_CUSTOM_MODEL_URL_LENGTH) || /\s/u.test(value)) {
    return false;
  }
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.hostname.length > 0 &&
      url.username.length === 0 &&
      url.password.length === 0 &&
      url.search.length === 0 &&
      url.hash.length === 0
    );
  } catch {
    return false;
  }
}
