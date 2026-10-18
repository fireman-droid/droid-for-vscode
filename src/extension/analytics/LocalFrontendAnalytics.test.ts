import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalDiagnostics } from '../diagnostics/LocalDiagnostics';
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
});
