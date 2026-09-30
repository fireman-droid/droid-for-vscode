import { afterEach, describe, expect, it, vi } from 'vitest';
import { FimCompletionError } from './FimClient';
import { requestCompletion, type CompletionRequest } from './requestCompletion';

const encoder = new TextEncoder();

function request(overrides: Partial<CompletionRequest> = {}): CompletionRequest {
  return {
    protocol: 'ollama', endpoint: 'http://localhost:11434/api/generate', apiKey: '',
    model: 'qwen2.5-coder:7b', prefix: 'private-source-prefix', suffix: 'private-source-suffix',
    maxTokens: 128, signal: new AbortController().signal, ...overrides,
  };
}

function mockResponse(response: Response) {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response);
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}

function ndjson(chunks: Uint8Array[], close = true) {
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      if (close) controller.close();
    },
    cancel,
  });
  return { body, cancel, response: new Response(body, { headers: { 'content-type': 'application/x-ndjson' } }) };
}

function record(response: string, done = false) {
  return JSON.stringify({ response, done }) + '\n';
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('completion protocol adapters', () => {
  it('sends native Ollama FIM parameters without an Authorization header for a local server', async () => {
    const fetcher = mockResponse(Response.json({ response: 'return value;', done: true }));
    await expect(requestCompletion(request())).resolves.toBe('return value;');
    const [endpoint, init] = fetcher.mock.calls[0];
    expect(endpoint).toBe('http://localhost:11434/api/generate');
    expect(new Headers(init?.headers).has('authorization')).toBe(false);
    expect(JSON.parse(String(init?.body))).toEqual({
      model: 'qwen2.5-coder:7b', prompt: 'private-source-prefix', suffix: 'private-source-suffix',
      options: { num_predict: 128, temperature: 0 }, stream: true,
    });
  });

  it('supports native FIM endpoints without a key and sends an EOF suffix unchanged', async () => {
    const fetcher = mockResponse(Response.json({ choices: [{ text: 'return value;' }] }));
    await expect(requestCompletion(request({
      protocol: 'fim', endpoint: 'http://localhost:8000/v1/completions', suffix: '',
    }))).resolves.toBe('return value;');
    const [endpoint, init] = fetcher.mock.calls[0];
    expect(endpoint).toBe('http://localhost:8000/v1/completions');
    expect(new Headers(init?.headers).has('authorization')).toBe(false);
    expect(JSON.parse(String(init?.body))).toMatchObject({ prompt: 'private-source-prefix', suffix: '', max_tokens: 128 });
  });

  it('preserves the DeepSeek beta endpoint and reads completion text events', async () => {
    const fetcher = mockResponse(new Response(
      'data: {"choices":[{"text":"return 1;","finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
      { headers: { 'content-type': 'text/event-stream' } },
    ));
    await expect(requestCompletion(request({
      protocol: 'fim', endpoint: 'https://api.deepseek.com/beta/completions',
      model: 'deepseek-flash', apiKey: 'private-api-key',
    }))).resolves.toBe('return 1;');
    expect(fetcher.mock.calls[0][0]).toBe('https://api.deepseek.com/beta/completions');
    expect(new Headers(fetcher.mock.calls[0][1]?.headers).get('authorization')).toBe('Bearer private-api-key');
  });

  it('decodes split UTF-8 and CRLF records and cancels unread data after the Ollama done record', async () => {
    const source = record('你好').replace('\n', '\r\n') + record(' = 1;', true);
    const chunks = Array.from(encoder.encode(source), (byte) => Uint8Array.of(byte));
    chunks.push(encoder.encode('private-invalid-trailing-data\n'));
    const stream = ndjson(chunks, false);
    mockResponse(stream.response);
    await expect(requestCompletion(request())).resolves.toBe('你好 = 1;');
    expect(stream.cancel).toHaveBeenCalledOnce();
    expect(stream.body.locked).toBe(false);
  });

  it('accepts a final record without a newline and excludes non-code thinking content', async () => {
    const stream = ndjson([encoder.encode(
      JSON.stringify({ response: '', thinking: 'private-thinking', done: false }) + '\n' +
      record('return x;') + JSON.stringify({ response: '', done: true }),
    )]);
    mockResponse(stream.response);
    await expect(requestCompletion(request())).resolves.toBe('return x;');
  });

  it('sends a configured key to authenticated Ollama endpoints', async () => {
    const fetcher = mockResponse(Response.json({ response: '', done: true }));
    await requestCompletion(request({ apiKey: 'private-api-key' }));
    expect(new Headers(fetcher.mock.calls[0][1]?.headers).get('authorization')).toBe('Bearer private-api-key');
  });

  it('rejects an interrupted Ollama stream instead of returning partial code', async () => {
    mockResponse(ndjson([encoder.encode(record('partial'))]).response);
    await expect(requestCompletion(request())).rejects.toMatchObject({
      code: 'protocol', message: 'Completion stream ended before it finished.',
    });
  });

  it.each([
    ['{"response":3,"done":true}\n', 'Completion provider returned an invalid generation response.'],
    ['{"response":"text"}\n', 'Completion provider returned an invalid generation response.'],
    ['private-api-key invalid-json\n', 'Completion provider returned invalid JSON.'],
    ['{"error":"private-api-key provider details"}\n', 'Completion provider reported an error.'],
  ])('rejects malformed or error NDJSON records without exposing provider details (%#)', async (payload, message) => {
    const stream = ndjson([encoder.encode(payload)], false);
    mockResponse(stream.response);
    const failure = await requestCompletion(request()).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(FimCompletionError);
    expect(failure).toMatchObject({ code: 'protocol', message });
    expect(String(failure)).not.toContain('private');
    expect(stream.cancel).toHaveBeenCalledOnce();
  });

  it('limits Ollama completion size and releases its reader', async () => {
    const stream = ndjson([encoder.encode(record('x'.repeat(65_537), true))], false);
    mockResponse(stream.response);
    await expect(requestCompletion(request())).rejects.toMatchObject({
      code: 'protocol', message: 'Completion text exceeded the size limit.',
    });
    expect(stream.cancel).toHaveBeenCalledOnce();
    expect(stream.body.locked).toBe(false);
  });

  it('limits bytes even when Ollama never completes its first JSON record', async () => {
    const stream = ndjson([encoder.encode(' '.repeat(1_048_577))], false);
    mockResponse(stream.response);
    await expect(requestCompletion(request())).rejects.toMatchObject({
      code: 'protocol', message: 'Completion response exceeded the size limit.',
    });
    expect(stream.cancel).toHaveBeenCalledOnce();
  });

  it('aborts Ollama requests when the editor cancels them', async () => {
    const controller = new AbortController();
    let signal: AbortSignal | undefined;
    let body: ReadableStream<Uint8Array> | undefined;
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (_url, init) => {
      signal = init?.signal as AbortSignal;
      body = new ReadableStream<Uint8Array>({
        start(reader) {
          reader.enqueue(encoder.encode(record('partial')));
          signal?.addEventListener('abort', () => reader.error(new Error('private details')), { once: true });
        },
      });
      return new Response(body, { headers: { 'content-type': 'application/x-ndjson' } });
    }));
    const pending = requestCompletion(request({ signal: controller.signal })).catch((error: unknown) => error);
    await Promise.resolve();
    await Promise.resolve();
    controller.abort();
    expect(await pending).toMatchObject({ name: 'AbortError' });
    expect(signal?.aborted).toBe(true);
    expect(body?.locked).toBe(false);
  });

  it('times out stalled Ollama requests after 12 seconds without leaving a timer behind', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn<typeof fetch>((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('private details')), { once: true });
    })));
    const pending = requestCompletion(request()).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(12_000);
    expect(await pending).toMatchObject({ code: 'timeout', message: 'Completion request timed out.' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('sends SiliconFlow FIM fields at the top level and reads a complete JSON answer', async () => {
    const fetcher = mockResponse(Response.json({ choices: [{ message: { content: 'value * 2' } }] }));
    await expect(requestCompletion(request({
      protocol: 'siliconflow-fim', endpoint: 'https://api.siliconflow.cn/v1/chat/completions',
      model: 'Qwen/Qwen3-Coder-30B-A3B-Instruct', apiKey: 'private-api-key', suffix: '',
    }))).resolves.toBe('value * 2');
    const [endpoint, init] = fetcher.mock.calls[0];
    expect(endpoint).toBe('https://api.siliconflow.cn/v1/chat/completions');
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer private-api-key');
    expect(JSON.parse(String(init?.body))).toEqual({
      model: 'Qwen/Qwen3-Coder-30B-A3B-Instruct',
      messages: [{
        role: 'user',
        content: 'Complete the missing code between prefix and suffix. Return only the missing code, without explanations or markdown.',
      }],
      prefix: 'private-source-prefix', suffix: '', max_tokens: 128, temperature: 0, stream: true,
    });
  });

  it('assembles SiliconFlow content deltas without mixing in reasoning text', async () => {
    mockResponse(new Response(
      'data: {"choices":[{"delta":{"role":"assistant","reasoning_content":"private thinking"}}]}\n\n' +
      'data: {"choices":[{"delta":{"content":"value","reasoning_content":"more thinking"}}]}\n\n' +
      'data: {"choices":[{"delta":{"content":" * 2"},"finish_reason":"stop"}]}\n\n' +
      'data: [DONE]\n\n',
      { headers: { 'content-type': 'text/event-stream' } },
    ));
    await expect(requestCompletion(request({
      protocol: 'siliconflow-fim', endpoint: 'https://api.siliconflow.cn/v1/chat/completions',
      model: 'Qwen/Qwen3-Coder-30B-A3B-Instruct', apiKey: 'private-api-key',
    }))).resolves.toBe('value * 2');
  });
});
