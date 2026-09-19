import { afterEach, describe, expect, it, vi } from 'vitest';

import { ModelDiscoveryError, createHttpCustomModelDiscovery } from './modelDiscovery';

afterEach(() => vi.useRealTimers());

describe('createHttpCustomModelDiscovery', () => {
  it('fetches an OpenAI-compatible catalog without following redirects', async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({
        data: [
          { id: 'model-b' },
          { id: 'model-a', display_name: 'Model A', owned_by: 'ignored' },
          { id: 'model-a' },
        ],
      }),
    );
    const gateway = createHttpCustomModelDiscovery(fetcher);
    await expect(
      gateway.discover({
        provider: 'openai',
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'credential-for-test',
      }),
    ).resolves.toEqual([
      { model: 'model-b' },
      { model: 'model-a', displayName: 'Model A' },
    ]);
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.example.com/v1/models',
      expect.objectContaining({
        method: 'GET',
        redirect: 'error',
        headers: {
          accept: 'application/json',
          authorization: 'Bearer credential-for-test',
        },
      }),
    );
  });

  it('uses Anthropic model headers and the default v1 path', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ data: [] }));
    const gateway = createHttpCustomModelDiscovery(fetcher);
    await gateway.discover({
      provider: 'anthropic',
      baseUrl: 'https://api.anthropic.example',
      apiKey: 'anthropic-test-key',
    });
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.anthropic.example/v1/models',
      expect.objectContaining({
        headers: {
          accept: 'application/json',
          'anthropic-version': '2023-06-01',
          'x-api-key': 'anthropic-test-key',
        },
        redirect: 'error',
      }),
    );
  });

  it('rejects non-success, oversized, and malformed provider responses', async () => {
    const unauthorized = createHttpCustomModelDiscovery(
      vi.fn<typeof fetch>(async () => new Response('', { status: 401 })),
    );
    await expect(
      unauthorized.discover({
        provider: 'openai',
        baseUrl: 'https://api.example.com/v1',
      }),
    ).rejects.toMatchObject({ kind: 'http', status: 401 });

    const oversized = createHttpCustomModelDiscovery(
      vi.fn<typeof fetch>(
        async () =>
          new Response('{}', {
            headers: { 'content-length': '1048577' },
          }),
      ),
    );
    await expect(
      oversized.discover({
        provider: 'openai',
        baseUrl: 'https://api.example.com/v1',
      }),
    ).rejects.toMatchObject({ kind: 'response-too-large' });

    const malformed = createHttpCustomModelDiscovery(
      vi.fn<typeof fetch>(async () => Response.json({ unexpected: [] })),
    );
    await expect(
      malformed.discover({
        provider: 'openai',
        baseUrl: 'https://api.example.com/v1',
      }),
    ).rejects.toBeInstanceOf(ModelDiscoveryError);
  });

  it('enforces the streamed response cap and request timeout', async () => {
    const streamed = createHttpCustomModelDiscovery(
      vi.fn<typeof fetch>(async () => new Response(new Uint8Array(1_048_577))),
    );
    await expect(
      streamed.discover({
        provider: 'openai',
        baseUrl: 'https://api.example.com/v1',
      }),
    ).rejects.toMatchObject({ kind: 'response-too-large' });

    vi.useFakeTimers();
    const hanging = createHttpCustomModelDiscovery(
      vi.fn<typeof fetch>(
        (_, init) =>
          new Promise((_, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError')),
            );
          }),
      ),
    );
    const timedOut = expect(
      hanging.discover({
        provider: 'openai',
        baseUrl: 'https://api.example.com/v1',
      }),
    ).rejects.toMatchObject({ kind: 'timed-out' });
    await vi.advanceTimersByTimeAsync(10_000);
    await timedOut;
    vi.useRealTimers();
  });

  it('does not project reflected credentials into discovery state', async () => {
    const gateway = createHttpCustomModelDiscovery(
      vi.fn<typeof fetch>(async () =>
        Response.json({ data: [{ id: 'reflected-key-for-test' }] }),
      ),
    );
    await expect(
      gateway.discover({
        provider: 'openai',
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'reflected-key-for-test',
      }),
    ).rejects.toMatchObject({ kind: 'invalid-response' });
  });

  it('aborts a stale Host request without waiting for its timeout', async () => {
    const fetcher = vi.fn<typeof fetch>(
      (_, init) =>
        new Promise((_, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
    );
    const gateway = createHttpCustomModelDiscovery(fetcher);
    const abort = new AbortController();
    const result = expect(
      gateway.discover(
        {
          provider: 'openai',
          baseUrl: 'https://api.example.com/v1',
        },
        abort.signal,
      ),
    ).rejects.toMatchObject({ kind: 'aborted' });
    abort.abort();
    await result;
  });
});
