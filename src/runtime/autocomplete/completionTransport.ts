const REQUEST_TIMEOUT_MS = 12_000;
const MAX_RESPONSE_BYTES = 1_048_576;
const MAX_COMPLETION_LENGTH = 65_536;

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

type TransportRequest = {
  readonly endpoint: string;
  readonly apiKey: string;
  readonly signal: AbortSignal;
};

/** Owns cancellation, response limits and safe failures for each completion protocol. */
export async function requestCompletionTransport(
  request: TransportRequest,
  body: Record<string, unknown>,
  accept: string,
  readResponse: (response: Response) => Promise<string>,
): Promise<string> {
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
        accept,
        ...(request.apiKey ? { authorization: `Bearer ${request.apiKey}` } : {}),
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new FimCompletionError('http', `Completion provider returned HTTP ${response.status}.`, response.status);
    }
    return await readResponse(response);
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

/** Decode incrementally so UTF-8 characters and SSE lines may span network chunks. */
export async function readBody(response: Response, consume: (chunk: string) => boolean): Promise<void> {
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

export function parsePayload(text: string): Record<string, unknown> {
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

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export function assertCompletionLength(value: string): void {
  if (value.length > MAX_COMPLETION_LENGTH) throw protocolError('Completion text exceeded the size limit.');
}

export function protocolError(message: string): FimCompletionError {
  return new FimCompletionError('protocol', message);
}
