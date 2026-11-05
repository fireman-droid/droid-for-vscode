import { afterEach, expect, it, vi } from 'vitest';
import { Ga4RelayReporter } from './Ga4RelayReporter';
import type { RuntimeDiagnosticEvent } from '../../runtime/runtimeDiagnostics';

const metadata = { machineId: 'private-machine', sessionId: '1700000000', extensionVersion: '0.8.20',
  appName: 'Visual Studio Code', platform: 'win32', arch: 'x64', language: 'en' };
const event = { level: 'info', name: 'extension.activated' } as const;
const reporters: Ga4RelayReporter[] = [];
afterEach(() => { reporters.splice(0).forEach(r => r.dispose()); vi.useRealTimers(); vi.unstubAllGlobals(); });
function reporter(fetchImpl: typeof fetch, onDelivery?: (event: RuntimeDiagnosticEvent) => void) {
  const r = new Ga4RelayReporter({ metadata, endpoint: 'https://relay.example/collect', fetchImpl, onDelivery });
  reporters.push(r);
  return r;
}

it('batches events serially, bounds the queue and records overflow only locally', async () => {
  const health: RuntimeDiagnosticEvent[] = [];
  const batches: number[] = [];
  const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
    batches.push(JSON.parse(String(init?.body)).events.length);
    return new Response(null, { status: 204 });
  });
  const r = reporter(fetcher as typeof fetch, e => health.push(e));
  for (let i = 0; i < 300; i++) r.record(event);
  await r.flush();
  expect(batches).toEqual(Array.from({ length: 10 }, () => 25));
  expect(health.filter(e => e.attributes?.reason === 'queue-full')
    .reduce((sum, e) => sum + Number(e.attributes?.records), 0)).toBe(50);
  expect(JSON.stringify(health)).not.toMatch(/private-machine|relay\.example/);
});

it('retries a transient HTTP rejection, but never retries a permanent rejection', async () => {
  vi.useFakeTimers();
  const health: RuntimeDiagnosticEvent[] = [];
  const fetcher = vi.fn()
    .mockResolvedValueOnce(new Response(null, { status: 503 }))
    .mockResolvedValueOnce(new Response(null, { status: 204 }))
    .mockResolvedValueOnce(new Response(null, { status: 400 }));
  const r = reporter(fetcher as typeof fetch, e => health.push(e));
  r.record(event);
  const flushing = r.flush(5000);
  await vi.advanceTimersByTimeAsync(250);
  await flushing;
  r.record(event);
  await r.flush();
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect(health.map(e => e.attributes?.outcome)).toEqual(['retrying', 'delivered', 'failed']);
  expect(health.at(-1)?.attributes?.status).toBe(400);
});

it('revokes in-flight and queued telemetry on opt-out without replaying it after opt-in', async () => {
  let signal: AbortSignal | undefined;
  const fetcher = vi.fn().mockImplementationOnce((_url: unknown, init: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      signal = init.signal as AbortSignal;
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    })).mockResolvedValue(new Response(null, { status: 204 }));
  const r = reporter(fetcher as typeof fetch);
  for (let i = 0; i < 30; i++) r.record(event);
  const flushing = r.flush();
  r.configure({ enabled: false, endpoint: 'https://relay.example/collect' });
  await flushing;
  expect(signal?.aborted).toBe(true);
  r.record(event);
  await r.flush();
  expect(fetcher).toHaveBeenCalledOnce();
  r.configure({ enabled: true, endpoint: 'https://relay.example/collect' });
  r.record(event);
  await r.flush();
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(JSON.parse(String(fetcher.mock.calls[1]?.[1].body)).events).toHaveLength(1);
});

it('bounds shutdown waiting and reports an aborted request instead of hanging', async () => {
  vi.useFakeTimers();
  let signal: AbortSignal | undefined;
  const r = reporter(vi.fn((_url: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    signal = init?.signal as AbortSignal;
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  })) as typeof fetch);
  r.record(event);
  const flushing = r.flush(50);
  await vi.advanceTimersByTimeAsync(50);
  await flushing;
  expect(signal?.aborted).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});

it.each([['http', 502], ['network', 503]] as const)('does not acknowledge failed Worker forwarding (%s)', async (kind, status) => {
  const worker = (await import(new URL('../../../scripts/ga4-relay-worker.mjs', import.meta.url).href)).default;
  vi.stubGlobal('fetch', kind === 'http'
    ? vi.fn(async () => new Response(null, { status: 500 }))
    : vi.fn(async () => { throw new Error('private upstream detail'); }));
  const response = await worker.fetch(new Request('https://relay.example/collect', {
    method: 'POST', body: JSON.stringify({ client_id: 'anonymous-client',
      events: [{ name: 'extension_activated', params: { stage: 'ready' } }] }),
  }), { GA4_MEASUREMENT_ID: 'G-TEST', GA4_API_SECRET: 'test-only' }, { waitUntil: vi.fn() });
  expect(response.status).toBe(status);
  expect(await response.text()).not.toContain('private');
});
