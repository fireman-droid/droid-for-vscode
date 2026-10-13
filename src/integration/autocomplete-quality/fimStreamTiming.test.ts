import { describe, expect, it } from 'vitest';
import { observeFimStream } from './fimStreamTiming';

const encoder = new TextEncoder();
const event = (text: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\r\n\r\n`;
function response(chunks: Uint8Array[], type = 'text/event-stream') {
  return new Response(new ReadableStream({ start(controller) {
    for (const chunk of chunks) controller.enqueue(chunk);
    controller.close();
  } }), { headers: { 'content-type': type } });
}
function observer() {
  let clock = 100;
  return observeFimStream(100, () => (clock += 10));
}

describe('FIM stream arrival observation', () => {
  it('keeps production output intact when UTF-8 and SSE events cross network chunks', async () => {
    const bytes = encoder.encode(event('const 值 = 1;\n')), split = bytes.indexOf(0xe5) + 1;
    const stream = observer();
    expect(await stream.read(response([bytes.slice(0, split), bytes.slice(split), encoder.encode('data: [DONE]\r\n\r\n')]))).toBe('const 值 = 1;\n');
    expect(stream.timing).toMatchObject({ headersMs: 10, firstByteMs: 20, firstTextMs: 30,
      firstCompleteLineMs: 30, completeMs: 50, chunks: 3, textEvents: 1, format: 'sse' });
  });

  it('does not count usage events or leading whitespace as usable text or a completed line', async () => {
    const stream = observer();
    const raw = await stream.read(response(['data: {"choices":[]}\r\n\r\n', event('  \n'), event('answer'),
      'data: [DONE]\r\n\r\n'].map(chunk => encoder.encode(chunk))));
    expect(raw).toBe('  \nanswer');
    expect(stream.timing.firstTextMs).toBe(40);
    expect(stream.timing.firstCompleteLineMs).toBeUndefined();
  });

  it('preserves production protocol rejection instead of accepting an incomplete or malformed stream', async () => {
    await expect(observer().read(response([encoder.encode(event('partial'))]))).rejects.toMatchObject({ code: 'protocol' });
    await expect(observer().read(response([encoder.encode('data: {invalid}\n\n')]))).rejects.toMatchObject({ code: 'protocol' });
  });

  it('labels a JSON response separately and counts its text only after parsing the complete body', async () => {
    const stream = observer();
    expect(await stream.read(response([encoder.encode('{"choices":[{"text":"answer"}]}')], 'application/json'))).toBe('answer');
    expect(stream.timing).toMatchObject({ format: 'json', firstByteMs: 20, firstTextMs: 30, completeMs: 30, textEvents: 0 });
  });
});
