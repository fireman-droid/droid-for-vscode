const REQUEST_TIMEOUT_MS = 12_000;
const MAX_RESPONSE_BYTES = 1_048_576;
const MAX_COMPLETION_LENGTH = 65_536;

export type FimRequest = {
  readonly endpoint: string;
  readonly apiKey: string;
  readonly model: string;
  readonly prefix: string;
  readonly suffix: string;
  readonly maxTokens: number;
  readonly signal: AbortSignal;
};

export class FimCompletionError extends Error {
  constructor(
    readonly code: 'http' | 'network' | 'timeout' | 'protocol',
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'FimCompletionError';
  }
}

/** Native FIM transport; no chat session, editor state, or provider credentials are retained. */
export async function requestFimCompletion(request: FimRequest): Promise<string> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  request.signal.addEventListener('abort', cancel, { once: true });
  if (request.signal.aborted) controller.abort();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(request.endpoint, {
      method: 'POST',
      redirect: 'error',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        accept: 'text/event-stream, application/json',
        authorization: `Bearer ${request.apiKey}`,
      },
      body: JSON.stringify({
        model: request.model,
        prompt: request.prefix,
        suffix: request.suffix,
        max_tokens: request.maxTokens,
        temperature: 0,
        stream: true,
      }),
    });
    if (!response.ok) {
      throw new FimCompletionError('http', `Completion provider returned HTTP ${response.status}.`, response.status);
    }
    const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
    if (contentType === 'text/event-stream') return await readEventStream(response);
    if (contentType === 'application/json' || contentType?.endsWith('+json')) {
      return await readJsonResponse(response);
    }
    throw protocolError('Completion provider returned an unsupported response format.');
  } catch (error) {
    if (request.signal.aborted) throw new DOMException('Completion request cancelled.', 'AbortError');
    if (timedOut) throw new FimCompletionError('timeout', 'Completion request timed out.');
    if (error instanceof FimCompletionError) throw error;
    // Fetch errors and provider payloads can contain URLs or submitted code. Keep them private.
    throw new FimCompletionError('network', 'Could not reach the completion provider.');
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener('abort', cancel);
    controller.abort();
  }
}

async function readJsonResponse(response: Response): Promise<string> {
  let body = '';
  await readBody(response, (chunk) => {
    body += chunk;
    return false;
  });
  const payload = parsePayload(body);
  const choice = firstChoice(payload);
  if (!choice) throw protocolError('Completion provider returned no completion choice.');
  const message = asRecord(choice.message);
  const text = choice.text ?? message?.content;
  if (typeof text !== 'string') throw protocolError('Completion provider returned no completion text.');
  assertCompletionLength(text);
  return text;
}

async function readEventStream(response: Response): Promise<string> {
  let buffer = '';
  let data: string[] = [];
  let eventName = '';
  let completion = '';
  let receivedChoice = false;
  let finished = false;
  let done = false;

  const dispatch = () => {
    if (eventName === 'error') throw protocolError('Completion provider reported a streaming error.');
    eventName = '';
    if (data.length === 0) return;
    const event = data.join('\n');
    data = [];
    if (event.trim() === '[DONE]') {
      done = true;
      return;
    }
    const choice = firstChoice(parsePayload(event));
    if (!choice) return; // Usage-only events have an empty choices array.
    receivedChoice = true;
    const delta = asRecord(choice.delta);
    const text = delta?.content ?? choice.text;
    if (text !== undefined && text !== null && typeof text !== 'string') {
      throw protocolError('Completion provider returned unsupported streaming text.');
    }
    if (typeof text === 'string') completion += text;
    assertCompletionLength(completion);
    if (typeof choice.finish_reason === 'string') finished = true;
  };
  const line = (value: string) => {
    if (value === '') return dispatch();
    if (value.startsWith(':')) return;
    const colon = value.indexOf(':');
    const field = colon < 0 ? value : value.slice(0, colon);
    const content = colon < 0 ? '' : value.slice(colon + 1).replace(/^ /u, '');
    if (field === 'data') data.push(content);
    if (field === 'event') eventName = content;
  };
  const consume = (flush: boolean) => {
    while (!done) {
      const separator = /\r\n|\r|\n/u.exec(buffer);
      if (!separator) break;
      // Keep a trailing CR until the next chunk so a split CRLF is one delimiter.
      if (!flush && separator[0] === '\r' && separator.index === buffer.length - 1) break;
      line(buffer.slice(0, separator.index));
      buffer = buffer.slice(separator.index + separator[0].length);
    }
  };

  await readBody(response, (chunk) => {
    buffer += chunk;
    consume(false);
    return done;
  });
  if (!done) {
    consume(true);
    if (buffer) line(buffer);
    dispatch();
  }
  if (!receivedChoice) throw protocolError('Completion provider returned no completion choice.');
  if (!done && !finished) throw protocolError('Completion stream ended before it finished.');
  return completion;
}

/** Decode incrementally so UTF-8 characters and SSE lines may span network chunks. */
async function readBody(response: Response, consume: (chunk: string) => boolean): Promise<void> {
  if (!response.body) throw protocolError('Completion provider returned an empty response.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) {
        consume(decoder.decode());
        return;
      }
      bytes += result.value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) throw protocolError('Completion response exceeded the size limit.');
      if (consume(decoder.decode(result.value, { stream: true }))) return;
    }
  } finally {
    // Cancel remaining bytes after [DONE], limits, or malformed events; do not mask the original error.
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function parsePayload(text: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw protocolError('Completion provider returned invalid JSON.');
  }
  const payload = asRecord(value);
  if (!payload) throw protocolError('Completion provider returned an invalid response.');
  if (payload.error != null) throw protocolError('Completion provider reported an error.');
  return payload;
}

function firstChoice(payload: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!Array.isArray(payload.choices)) throw protocolError('Completion provider returned an invalid choices field.');
  if (payload.choices.length === 0) return undefined;
  const choice = asRecord(payload.choices[0]);
  if (!choice) throw protocolError('Completion provider returned an invalid completion choice.');
  return choice;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function assertCompletionLength(value: string): void {
  if (value.length > MAX_COMPLETION_LENGTH) throw protocolError('Completion text exceeded the size limit.');
}

function protocolError(message: string): FimCompletionError {
  return new FimCompletionError('protocol', message);
}
