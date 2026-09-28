import { requestFimCompletion, type FimRequest } from './FimClient';
import {
  assertCompletionLength, parsePayload, protocolError, readBody, requestCompletionTransport,
} from './completionTransport';

export type CompletionProtocol = 'fim' | 'ollama';
export type CompletionRequest = FimRequest & { readonly protocol: CompletionProtocol };

/** Both protocols use native prefix/suffix completion; the selected model must support FIM. */
export async function requestCompletion(request: CompletionRequest): Promise<string> {
  if (request.protocol === 'fim') return requestFimCompletion(request);
  return requestCompletionTransport(request, {
    model: request.model,
    prompt: request.prefix,
    suffix: request.suffix,
    options: { num_predict: request.maxTokens, temperature: 0 },
    stream: true,
  }, 'application/x-ndjson, application/json', readOllamaResponse);
}

async function readOllamaResponse(response: Response): Promise<string> {
  const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (contentType !== 'application/x-ndjson' && contentType !== 'application/json') {
    throw protocolError('Completion provider returned an unsupported response format.');
  }
  let buffer = '';
  let completion = '';
  let done = false;
  const consumeRecord = (text: string) => {
    if (!text.trim()) return;
    const payload = parsePayload(text);
    if (typeof payload.done !== 'boolean' || typeof payload.response !== 'string') {
      throw protocolError('Completion provider returned an invalid generation response.');
    }
    completion += payload.response;
    assertCompletionLength(completion);
    done = payload.done;
  };
  await readBody(response, (chunk) => {
    buffer += chunk;
    // JSON responses are whole objects; NDJSON records may span multiple network chunks.
    if (contentType === 'application/json') return false;
    while (!done) {
      const newline = buffer.indexOf('\n');
      if (newline < 0) break;
      consumeRecord(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
    }
    return done;
  });
  if (!done && buffer.trim()) consumeRecord(buffer);
  if (!done) throw protocolError('Completion stream ended before it finished.');
  return completion;
}
