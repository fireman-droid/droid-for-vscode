import { readFimResponse } from '../../runtime/autocomplete/FimClient';

export interface FimStreamTiming {
  headersMs: number;
  firstByteMs?: number;
  firstTextMs?: number;
  firstCompleteLineMs?: number;
  completeMs?: number;
  chunks: number;
  textEvents: number;
  bytes: number;
  format: 'sse' | 'json';
}

/** Observe transport arrival without changing the request, parser or returned code.
 * A complete line is only a timing landmark, not a validated editor suggestion. */
export function observeFimStream(started: number, now: () => number = Date.now) {
  let timing: FimStreamTiming;
  const read = async (response: Response): Promise<string> => {
    const sse = response.headers.get('content-type')?.includes('text/event-stream') === true;
    timing = { headersMs: now() - started, chunks: 0, textEvents: 0, bytes: 0, format: sse ? 'sse' : 'json' };
    let buffer = '', text = '';
    const decoder = new TextDecoder();
    const observe = (chunk: Uint8Array, at: number) => {
      timing.chunks++; timing.bytes += chunk.byteLength; timing.firstByteMs ??= at;
      if (!sse) return;
      buffer += decoder.decode(chunk, { stream: true });
      // This observer extracts timing only; production readFimResponse still
      // validates termination, event errors, limits and the final returned text.
      while (true) {
        const boundary = /\r\n\r\n|\n\n|\r\r/.exec(buffer);
        if (!boundary) break;
        const event = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary[0].length);
        const data = event.split(/\r\n|\n|\r/).filter(line => line.startsWith('data:'))
          .map(line => line.slice(5).replace(/^ /, '')).join('\n');
        if (!data || data.trim() === '[DONE]') continue;
        let payload;
        try { payload = JSON.parse(data); }
        catch (error) { if (error instanceof SyntaxError) continue; throw error; }
        const choice = payload?.choices?.[0];
        const delta = choice?.delta?.content ?? choice?.text;
        if (typeof delta !== 'string' || !delta) continue;
        timing.textEvents++; text += delta;
        if (/\S/.test(delta)) timing.firstTextMs ??= at;
        if (/\S[^\r\n]*(?:\r\n|\n|\r)/.test(text)) timing.firstCompleteLineMs ??= at;
      }
    };
    const body = response.body?.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) { observe(chunk, now() - started); controller.enqueue(chunk); },
    }));
    const raw = await readFimResponse(new Response(body, { status: response.status, headers: response.headers }));
    timing.completeMs = now() - started;
    if (!sse && raw) {
      timing.firstTextMs = timing.completeMs;
      if (/\S[^\r\n]*(?:\r\n|\n|\r)/.test(raw)) timing.firstCompleteLineMs = timing.completeMs;
    }
    return raw;
  };
  return { read, get timing() { return timing; } };
}
