import { describe, expect, it } from 'vitest';

import {
  normalizeProviderRoot,
  resolveHttpApiBase,
  sameProviderEndpoint,
} from './providerEndpoint';

describe('providerEndpoint', () => {
  it('keeps a domain root free of /v1 so Droid can join the path', () => {
    expect(normalizeProviderRoot('http://38.47.121.18:8080/')).toBe(
      'http://38.47.121.18:8080',
    );
    expect(normalizeProviderRoot('https://api.deepseek.com/anthropic')).toBe(
      'https://api.deepseek.com/anthropic',
    );
  });

  it('only concatenates a probe path when the root has none', () => {
    expect(resolveHttpApiBase('anthropic', 'http://38.47.121.18:8080')).toBe(
      'http://38.47.121.18:8080/v1',
    );
    expect(resolveHttpApiBase('anthropic', 'https://api.deepseek.com')).toBe(
      'https://api.deepseek.com/anthropic',
    );
    expect(resolveHttpApiBase('openai', 'https://88996api.cloud/v1')).toBe(
      'https://88996api.cloud/v1',
    );
  });

  it('treats a stored root and a legacy /v1 write as the same connection', () => {
    expect(
      sameProviderEndpoint('http://38.47.121.18:8080', 'http://38.47.121.18:8080/v1'),
    ).toBe(true);
    expect(
      sameProviderEndpoint(
        'https://api.deepseek.com',
        'https://api.deepseek.com/anthropic',
      ),
    ).toBe(true);
    expect(
      sameProviderEndpoint('https://ai.nbcodex.com', 'https://api.example.com'),
    ).toBe(false);
  });
});
