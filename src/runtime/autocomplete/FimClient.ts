import {
  asRecord, assertCompletionLength, parsePayload, protocolError, readBody, requestCompletionTransport,
} from './completionTransport';

export { FimCompletionError } from './completionTransport';

export type FimRequest = {
  readonly endpoint: string;
  readonly apiKey: string;
  readonly model: string;
  readonly prefix: string;
  readonly suffix: string;
  readonly maxTokens: number;
  readonly signal: AbortSignal;
};

/** Native FIM transport; no chat session, editor state, or provider credentials are retained. */
export async function requestFimCompletion(request: FimRequest): Promise<string> {
  return requestCompletionTransport(request, {
    model: request.model,
    prompt: request.prefix,
    suffix: request.suffix,
    max_tokens: request.maxTokens,
    temperature: 0,
    stream: true,
  }, 'text/event-stream, application/json', readFimResponse);
}

/** Shared choices-based response format used by native and SiliconFlow FIM. */
export async function readFimResponse(response: Response): Promise<string> {
  const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (contentType === 'text/event-stream') return readEventStream(response);
  if (contentType === 'application/json' || contentType?.endsWith('+json')) {
    return readJsonResponse(response);
  }
  throw protocolError('Completion provider returned an unsupported response format.');
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

function firstChoice(payload: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!Array.isArray(payload.choices)) throw protocolError('Completion provider returned an invalid choices field.');
  if (payload.choices.length === 0) return undefined;
  const choice = asRecord(payload.choices[0]);
  if (!choice) throw protocolError('Completion provider returned an invalid completion choice.');
  return choice;
}
