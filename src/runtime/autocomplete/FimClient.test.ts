import { afterEach, describe, expect, it, vi } from 'vitest';
import { FimCompletionError, requestFimCompletion, type FimRequest } from './FimClient';

const encoder = new TextEncoder();

function request(overrides: Partial<FimRequest> = {}): FimRequest {
  return {
    endpoint: 'https://completion.example/v1/fim/completions',
    apiKey: 'private-api-key',
    model: 'codestral-latest',
    prefix: 'private-source-prefix',
    suffix: 'private-source-suffix',
    maxTokens: 256,
    signal: new AbortController().signal,
    ...overrides,
  };
}

function responseStream(chunks: Uint8Array[], close = true) {
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      if (close) controller.close();
    },
    cancel,
  });
  const response = new Response(body, { headers: { 'content-type': 'text/event-stream' } });
  return { response, body, cancel };
}

function mockResponse(response: Response) {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response);
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}

function event(choice: Record<string, unknown>): string {
  return 'data: ' + JSON.stringify({ choices: [choice] }) + '\n\n';
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('requestFimCompletion', () => {
  it('decodes UTF-8 and CRLF split across network chunks, then cancels unread stream data at DONE', async () => {
    const source = ': keep-alive\r\n\r\n' +
      event({ delta: { content: '你好' } }).replaceAll('\n', '\r\n') +
      event({ text: ' = 1;' }).replaceAll('\n', '\r\n') +
      'data: [DONE]\r\n\r\n';
    const chunks = Array.from(encoder.encode(source), (byte) => Uint8Array.of(byte));
    chunks.push(encoder.encode('data: malformed unread event\n\n'));
    const stream = responseStream(chunks, false);
    const fetcher = mockResponse(stream.response);

    await expect(requestFimCompletion(request())).resolves.toBe('你好 = 1;');
    expect(stream.cancel).toHaveBeenCalledOnce();
    expect(stream.body.locked).toBe(false);
    const [endpoint, init] = fetcher.mock.calls[0];
    expect(endpoint).toBe('https://completion.example/v1/fim/completions');
    expect(init).toMatchObject({
      method: 'POST', redirect: 'error',
      headers: { authorization: 'Bearer private-api-key' },
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      model: 'codestral-latest', prompt: 'private-source-prefix', suffix: 'private-source-suffix',
      max_tokens: 256, temperature: 0, stream: true,
    });
  });

  it('accepts multiline SSE data and a completed choice without a DONE sentinel', async () => {
    const stream = responseStream([encoder.encode(
      'data: {"choices":\n' +
      'data: [{"delta":{"content":"return x;"},"finish_reason":"stop"}]}\n\n' +
      'data: {"choices":[],"usage":{"completion_tokens":3}}\n\n',
    )]);
    mockResponse(stream.response);
    await expect(requestFimCompletion(request())).resolves.toBe('return x;');
    expect(stream.body.locked).toBe(false);
  });

  it.each([
    { text: 'return 1;' },
    { message: { content: 'return 1;' } },
  ])('accepts a non-streaming JSON completion %#', async (choice) => {
    mockResponse(Response.json({ choices: [choice] }));
    await expect(requestFimCompletion(request({ suffix: '' }))).resolves.toBe('return 1;');
  });

  it('propagates user cancellation while waiting for response bytes and releases the reader', async () => {
    const controller = new AbortController();
    let response: Response | undefined;
    let signal: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (_url, init) => {
      signal = init?.signal as AbortSignal;
      const stream = new ReadableStream<Uint8Array>({
        start(reader) {
          reader.enqueue(encoder.encode(event({ delta: { content: 'partial' } })));
          signal?.addEventListener('abort', () => reader.error(new DOMException('aborted', 'AbortError')), { once: true });
        },
      });
      response = new Response(stream, { headers: { 'content-type': 'text/event-stream' } });
      return response;
    }));
    const pending = requestFimCompletion(request({ signal: controller.signal })).catch((error: unknown) => error);
    await Promise.resolve();
    await Promise.resolve();
    controller.abort();

    expect(await pending).toMatchObject({ name: 'AbortError', message: 'Completion request cancelled.' });
    expect(signal?.aborted).toBe(true);
    expect(response?.body?.locked).toBe(false);
  });

  it('reports a network interruption without returning a partial suggestion or raw stream error', async () => {
    let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller;
        controller.enqueue(encoder.encode(event({ delta: { content: 'partial' } })));
      },
    });
    mockResponse(new Response(body, { headers: { 'content-type': 'text/event-stream' } }));
    const pending = requestFimCompletion(request()).catch((error: unknown) => error);
    await Promise.resolve();
    await Promise.resolve();
    streamController?.error(new Error('private-source-prefix private-api-key'));

    expect(await pending).toMatchObject({ code: 'network', message: 'Could not reach the completion provider.' });
    expect(body.locked).toBe(false);
  });

  it('returns HTTP status without including the response body, request, or API key', async () => {
    mockResponse(new Response('private-api-key private-source-prefix provider internals', { status: 401 }));
    const error = await requestFimCompletion(request()).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(FimCompletionError);
    expect(error).toMatchObject({ code: 'http', status: 401, message: 'Completion provider returned HTTP 401.' });
    expect(String(error)).not.toContain('private');
  });

  it('aborts a stalled request after 12 seconds and clears its timeout', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn<typeof fetch>((_url, init) => new Promise((_resolve, reject) => {
      signal = init?.signal as AbortSignal;
      signal.addEventListener('abort', () => reject(new Error('private-api-key')), { once: true });
    })));
    const pending = requestFimCompletion(request()).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(12_000);
    expect(await pending).toMatchObject({ code: 'timeout', message: 'Completion request timed out.' });
    expect(signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects a stream that ends before the completion finishes', async () => {
    mockResponse(responseStream([encoder.encode(event({ delta: { content: 'partial' } }))]).response);
    await expect(requestFimCompletion(request())).rejects.toMatchObject({
      code: 'protocol', message: 'Completion stream ended before it finished.',
    });
  });

  it('rejects malformed JSON and cancels the remaining stream without exposing its contents', async () => {
    const stream = responseStream([encoder.encode('data: private-source-prefix private-api-key\n\n')], false);
    mockResponse(stream.response);
    await expect(requestFimCompletion(request())).rejects.toMatchObject({
      code: 'protocol', message: 'Completion provider returned invalid JSON.',
    });
    expect(stream.cancel).toHaveBeenCalledOnce();
    expect(stream.body.locked).toBe(false);
  });

  it('rejects oversized completion text and releases the response', async () => {
    const stream = responseStream([encoder.encode(event({ delta: { content: 'x'.repeat(65_537) } }))], false);
    mockResponse(stream.response);
    await expect(requestFimCompletion(request())).rejects.toMatchObject({
      code: 'protocol', message: 'Completion text exceeded the size limit.',
    });
    expect(stream.cancel).toHaveBeenCalledOnce();
    expect(stream.body.locked).toBe(false);
  });
});
