import type { CustomModelProvider } from './customModelsProtocol';

/**
 * Persist the domain root exactly as typed. Droid appends the protocol
 * path itself; the Host must not write `/v1` (or `/anthropic`) into
 * `settings.json`.
 */
export function normalizeProviderRoot(value: string): string {
  const url = new URL(value);
  url.hash = '';
  url.search = '';
  url.pathname = url.pathname.replace(/\/+$/u, '') || '/';
  return url.toString().replace(/\/$/u, '');
}

/**
 * HTTP probe/fetch base. Empty paths get the protocol default; an
 * explicit path the user typed is left alone so we never double-join.
 */
export function resolveHttpApiBase(
  protocol: CustomModelProvider,
  rootUrl: string,
): string {
  const url = new URL(normalizeProviderRoot(rootUrl));
  const path = url.pathname.replace(/\/+$/u, '');
  if (path !== '' && path !== '/') {
    return url.toString();
  }
  url.pathname =
    protocol === 'anthropic' && /(^|\.)deepseek\.com$/iu.test(url.hostname)
      ? '/anthropic'
      : '/v1';
  return url.toString();
}

/** Group a daemon row with a connection even if one side still has `/v1`. */
export function sameProviderEndpoint(
  left: string | undefined,
  right: string | undefined,
): boolean {
  if (left === undefined || right === undefined) {
    return false;
  }
  try {
    return canonicalProviderEndpoint(left) === canonicalProviderEndpoint(right);
  } catch {
    return false;
  }
}

export function canonicalProviderEndpoint(value: string): string {
  const url = new URL(normalizeProviderRoot(value));
  url.hostname = url.hostname.toLowerCase();
  const path = url.pathname.replace(/\/+$/u, '');
  url.pathname = path === '/v1' || path === '/anthropic' ? '/' : path || '/';
  return url.toString().replace(/\/$/u, '');
}
