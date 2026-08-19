import { describe, expect, it, vi } from 'vitest';

import { testCustomModel } from './modelTesting';

describe('testCustomModel', () => {
  it('posts Anthropic messages under /v1 when the stored root has no path', async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({ content: [{ type: 'text', text: 'OK' }] }),
    );
    await expect(
      testCustomModel(
        {
          protocol: 'anthropic',
          baseUrl: 'http://38.47.121.18:8080',
          apiKey: 'test-key',
          model: 'claude-sonnet-5',
        },
        fetcher,
      ),
    ).resolves.toMatchObject({ status: 'passed', summary: 'OK' });
    const url = fetcher.mock.calls[0]?.[0];
    expect(String(url)).toBe('http://38.47.121.18:8080/v1/messages');
  });

  it('does not double-join /v1 when the stored URL already has it', async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({
        choices: [{ message: { content: 'OK' } }],
      }),
    );
    await testCustomModel(
      {
        protocol: 'openai',
        baseUrl: 'https://88996api.cloud/v1',
        apiKey: 'test-key',
        model: 'kimi-k3',
      },
      fetcher,
    );
    expect(String(fetcher.mock.calls[0]?.[0])).toBe(
      'https://88996api.cloud/v1/chat/completions',
    );
  });
});
