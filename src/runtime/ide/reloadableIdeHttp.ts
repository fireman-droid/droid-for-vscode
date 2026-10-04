import { request } from 'node:http';
import type { ClientRequest, IncomingHttpHeaders, IncomingMessage, OutgoingHttpHeaders, ServerResponse } from 'node:http';

export interface IdeHandshake {
  readonly body: Buffer;
  readonly headers: IncomingHttpHeaders;
  readonly id: string | number;
}

export function singleHeader(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export function requestHeaders(headers: IncomingHttpHeaders, port: number, sessionId?: string): OutgoingHttpHeaders {
  const result: OutgoingHttpHeaders = { ...headers, host: `127.0.0.1:${port}` };
  delete result.connection;
  delete result['transfer-encoding'];
  delete result['mcp-session-id'];
  if (sessionId) result['mcp-session-id'] = sessionId;
  return result;
}

export function responseHeaders(headers: IncomingHttpHeaders, sessionId?: string): OutgoingHttpHeaders {
  const result: OutgoingHttpHeaders = { ...headers };
  delete result.connection;
  delete result['transfer-encoding'];
  delete result['mcp-session-id'];
  if (sessionId) result['mcp-session-id'] = sessionId;
  return result;
}

export function failResponse(response: ServerResponse, status: number): void {
  if (response.destroyed) return;
  if (response.headersSent) { response.destroy(); return; }
  response.writeHead(status, { 'content-type': 'text/plain' });
  response.end(status === 404 ? 'Unknown IDE session' : 'IDE service unavailable');
}

/** Only handshake/control payloads are retained. Large tools/call bodies still stream. */
export async function captureControl(stream: IncomingMessage): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const parts: Buffer[] = [];
    let bytes = 0;
    let complete = false;
    const finish = (result: Buffer | null) => {
      if (complete) return;
      complete = true;
      stream.off('data', data);
      stream.off('end', end);
      stream.off('aborted', aborted);
      stream.off('error', aborted);
      resolve(result);
    };
    const data = (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 512 * 1024) finish(null);
      else parts.push(chunk);
    };
    const end = () => finish(Buffer.concat(parts));
    const aborted = () => finish(null);
    stream.on('data', data);
    stream.once('end', end);
    stream.once('aborted', aborted);
    stream.once('error', aborted);
  });
}

export function envelope(body: Buffer | null): Record<string, unknown> | null {
  if (!body) return null;
  try {
    const value: unknown = JSON.parse(body.toString('utf8'));
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown> : null;
  } catch { return null; }
}

export function initializeResult(body: Buffer | null, id: string | number): boolean {
  return typeof controlResult(body, id)?.protocolVersion === 'string';
}

export function controlResult(body: Buffer | null, id: string | number): Record<string, unknown> | null {
  if (!body) return null;
  const candidates = [envelope(body), ...body.toString('utf8').split(/\r?\n\r?\n/u).map((frame) => {
    const data = frame.split(/\r?\n/u).filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart()).join('\n');
    return envelope(Buffer.from(data));
  })];
  const response = candidates.find((value) => value?.jsonrpc === '2.0' && value.id === id &&
    value.error === undefined && value.result !== null && typeof value.result === 'object' &&
    !Array.isArray(value.result));
  return response?.result as Record<string, unknown> | undefined ?? null;
}

export async function sendControl(port: number, handshake: IdeHandshake, signal: AbortSignal, sessionId?: string): Promise<{
  readonly status: number; readonly headers: IncomingHttpHeaders; readonly body: Buffer | null;
}> {
  return new Promise((resolve, reject) => {
    const headers = requestHeaders(handshake.headers, port, sessionId);
    headers['content-length'] = handshake.body.length;
    const upstream = request({ hostname: '127.0.0.1', port, path: '/mcp', method: 'POST', headers, signal }, (response) => {
      void captureControl(response).then((body) => resolve({ status: response.statusCode ?? 502, headers: response.headers, body }));
    });
    upstream.once('error', reject);
    upstream.end(handshake.body);
  });
}

export function openEvents(port: number, headers: IncomingHttpHeaders, sessionId: string): ClientRequest {
  const outgoing = requestHeaders(headers, port, sessionId);
  // A replacement MCP server has a new event log; old cursors do not belong to it.
  delete outgoing['last-event-id'];
  return request({ hostname: '127.0.0.1', port, path: '/mcp', method: 'GET', headers: outgoing });
}
