import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalDiagnostics } from '../diagnostics/LocalDiagnostics';
import { Ga4RelayReporter } from './Ga4RelayReporter';
import { LocalFrontendAnalytics } from './LocalFrontendAnalytics';
import { projectFrontendEvent } from './projectFrontendEvent';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))); });
const output = () => ({ appendLine: vi.fn(), show: vi.fn(), dispose: vi.fn() });

describe('local frontend statistics', () => {
  it('writes standalone structured events through the real diagnostic path without retaining private detail', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'droid-local-analytics-'));
    directories.push(directory);
    const analytics = new LocalFrontendAnalytics({ directory: join(directory, 'local-analytics'), output: output() });
    const diagnostics = new LocalDiagnostics({ directory, output: output(), onHostRecord: event => analytics.record(event) });
    diagnostics.record({ level: 'error', name: 'webview.error', detail: 'private error with C:/workspace/private.ts',
      attributes: { sessionId: 'private-session', prompt: 'private-chat' } });
    diagnostics.record({ level: 'info', name: 'webview.perf-batch', detail: JSON.stringify({ source: 'activity.expand',
      surface: 'history', durationMs: 18.2, records: 35, code: 'private-code', sessionId: 'private-session' }) });
    diagnostics.record({ level: 'info', name: 'webview.perf-longtask', detail: JSON.stringify({ source: 'chat.longtask',
      count: 2, totalMs: 410, maxMs: 210, startMs: 500 }) });
    await Promise.all([diagnostics.flush(), analytics.flush()]);
    const contents = await readFile(analytics.filePath, 'utf8');
    const events = contents.trim().split('\n').map(line => JSON.parse(line));
    expect(events.map(event => ({ name: event.name, attributes: event.attributes }))).toEqual([
      { name: 'frontend.error', attributes: { surface: 'chat', category: 'error' } },
      { name: 'activity.expand', attributes: { surface: 'history', durationMs: 18, records: 35 } },
      { name: 'frontend.longtask', attributes: { surface: 'chat', count: 2, totalMs: 410, maxMs: 210 } },
    ]);
    expect(contents).not.toMatch(/private|workspace|sessionId|prompt|code|startMs/u);
    expect(await readFile(diagnostics.filePath, 'utf8')).toContain('private error');
    diagnostics.dispose(); analytics.dispose();
  });

  it('stops new statistics immediately when disabled while retaining the main diagnostic log', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'droid-local-analytics-'));
    directories.push(directory);
    const analytics = new LocalFrontendAnalytics({ directory: join(directory, 'local-analytics'), output: output() });
    const diagnostics = new LocalDiagnostics({ directory, output: output(), onHostRecord: event => analytics.record(event) });
    const event = { level: 'info' as const, name: 'webview.boot-ok', detail: 'build dev bootMs 120' };
    diagnostics.record(event);
    await analytics.flush();
    analytics.configure(false);
    diagnostics.record(event);
    await Promise.all([diagnostics.flush(), analytics.flush()]);
    expect((await readFile(analytics.filePath, 'utf8')).trim().split('\n')).toHaveLength(1);
    expect((await readFile(diagnostics.filePath, 'utf8')).trim().split('\n')).toHaveLength(2);
    analytics.configure(true);
    diagnostics.record(event);
    await Promise.all([diagnostics.flush(), analytics.flush()]);
    expect((await readFile(analytics.filePath, 'utf8')).trim().split('\n')).toHaveLength(2);
    diagnostics.dispose(); analytics.dispose();
  });

  it('ignores unknown diagnostics and malformed or identifying measurement values', () => {
    const base = { level: 'info' as const, name: 'webview.perf-batch' };
    for (const detail of ['not json', JSON.stringify({ source: 'transcript.commit', sessionId: 'private' }),
      JSON.stringify({ source: 'activity.expand', surface: 'history', durationMs: 'private', records: 1 }),
      JSON.stringify({ source: 'activity.expand', surface: ['history'], durationMs: 1, records: 1 })]) {
      expect(projectFrontendEvent({ ...base, detail })).toBeUndefined();
    }
    expect(projectFrontendEvent({ ...base, name: 'runtime.error', detail: 'private' })).toBeUndefined();
  });

  it('forwards sanitized GA4 events through the Cloudflare Worker relay without leaking private fields', async () => {
    const workerModule = (await import(new URL('../../../scripts/ga4-relay-worker.mjs', import.meta.url).href)) as {
      default: { fetch(request: Request, env: Record<string, string>, ctx?: unknown): Promise<Response> };
    };
    const forwarded: Array<{ url: string; body: unknown }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      forwarded.push({ url: String(input), body: JSON.parse(String(init?.body ?? '{}')) });
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;

    try {
      const relayFetch: typeof fetch = async (input, init) =>
        workerModule.default.fetch(
          new Request(String(input), init),
          { GA4_MEASUREMENT_ID: 'G-TEST123456', GA4_API_SECRET: 'secret-xyz' },
          undefined,
        );

      const relay = new Ga4RelayReporter({
        metadata: {
          machineId: 'raw-machine-id-never-sent',
          sessionId: '1700000000',
          extensionVersion: '0.8.16',
          appName: 'Cursor',
          platform: 'win32',
          arch: 'x64',
          language: 'zh-CN',
        },
        enabled: true,
        endpoint: 'https://droid-ga4.example.workers.dev/collect',
        fetchImpl: relayFetch,
      });

      const directory = await mkdtemp(join(tmpdir(), 'droid-local-analytics-'));
      directories.push(directory);
      const analytics = new LocalFrontendAnalytics({
        directory: join(directory, 'local-analytics'),
        output: output(),
        relay,
      });

      analytics.record({
        level: 'info',
        name: 'extension.activated',
        attributes: { workspace: 'C:/secret-project' },
      });
      analytics.record({
        level: 'info',
        name: 'webview.perf-batch',
        detail: JSON.stringify({
          source: 'activity.expand',
          surface: 'history',
          durationMs: 24.4,
          records: 18,
          prompt: 'secret-prompt',
        }),
      });
      analytics.record({
        level: 'error',
        name: 'runtime.initialize.finished',
        attributes: {
          durationMs: 30446,
          outcome: 'initialization-failed',
          reason: 'Request timeout after 30000ms: daemon.load_session (5822ceb1-db75-4d77-a12f-781f0831a27f)',
        },
      });
      analytics.record({
        level: 'info',
        name: 'runtime.history.daemon',
        attributes: {
          durationMs: 8477,
          outcome: 'ok',
          sessionId: 'secret-session-uuid',
          messages: 10001,
          source: 'persisted-snapshot',
          bytes: 111999019,
          readMs: 2970,
          projectMs: 4836,
          items: 2000,
        },
      });
      relay.configure({ enabled: false, endpoint: 'https://droid-ga4.example.workers.dev/collect' });
      analytics.record({ level: 'error', name: 'webview.error', detail: 'should not be sent when disabled' });

      await analytics.flush();
      expect(forwarded).toHaveLength(4);
      expect(forwarded[0]?.url).toBe(
        'https://www.google-analytics.com/mp/collect?measurement_id=G-TEST123456&api_secret=secret-xyz',
      );
      expect(forwarded[0]?.body).toEqual({
        client_id: expect.stringMatching(/^[0-9a-f]{32}$/u),
        events: [
          {
            name: 'extension_activated',
            params: {
              session_id: '1700000000',
              editor: 'cursor',
              platform: 'win32',
              arch: 'x64',
              locale: 'zh-cn',
              ext_version: '0.8.16',
              engagement_time_msec: 100,
            },
          },
        ],
      });
      expect(forwarded[1]?.body).toEqual({
        client_id: expect.stringMatching(/^[0-9a-f]{32}$/u),
        events: [
          {
            name: 'activity_expand',
            params: {
              session_id: '1700000000',
              editor: 'cursor',
              platform: 'win32',
              arch: 'x64',
              locale: 'zh-cn',
              ext_version: '0.8.16',
              surface: 'history',
              duration_ms: 24,
              records: 18,
              engagement_time_msec: 100,
            },
          },
        ],
      });
      expect(forwarded[2]?.body).toEqual({
        client_id: expect.stringMatching(/^[0-9a-f]{32}$/u),
        events: [
          {
            name: 'runtime_init',
            params: {
              session_id: '1700000000',
              editor: 'cursor',
              platform: 'win32',
              arch: 'x64',
              locale: 'zh-cn',
              ext_version: '0.8.16',
              outcome: 'initialization-failed',
              failure_kind: 'timeout_load_session',
              duration_ms: 30446,
              engagement_time_msec: 30446,
            },
          },
        ],
      });
      expect(forwarded[3]?.body).toEqual({
        client_id: expect.stringMatching(/^[0-9a-f]{32}$/u),
        events: [
          {
            name: 'session_history',
            params: {
              session_id: '1700000000',
              editor: 'cursor',
              platform: 'win32',
              arch: 'x64',
              locale: 'zh-cn',
              ext_version: '0.8.16',
              source: 'persisted-snapshot',
              outcome: 'ok',
              duration_ms: 8477,
              read_ms: 2970,
              project_ms: 4836,
              file_kb: 109374,
              messages: 10001,
              records: 2000,
              engagement_time_msec: 8477,
            },
          },
        ],
      });
      expect(JSON.stringify(forwarded)).not.toMatch(/raw-machine-id|secret-project|secret-prompt|secret-session-uuid|5822ceb1/u);
      analytics.dispose();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
