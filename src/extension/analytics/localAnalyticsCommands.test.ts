import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import type * as vscode from 'vscode';
import { afterEach, expect, it, vi } from 'vitest';
import { registerLocalFrontendAnalytics } from './registerLocalFrontendAnalytics';
import { exportDiagnosticsBundle } from '../diagnostics/exportDiagnostics';

const host = vi.hoisted(() => ({ enabled: true, target: '', show: vi.fn(),
  commands: new Map<string, () => void>(),
  listeners: new Set<(event: { affectsConfiguration(key: string): boolean }) => void>(),
}));
vi.mock('vscode', () => ({
  version: 'test', env: { appName: 'test', isTelemetryEnabled: false },
  Uri: { file: (fsPath: string) => ({ fsPath }), joinPath: (base: { fsPath: string }, ...parts: string[]) => ({ fsPath: [base.fsPath, ...parts].join('/') }) },
  commands: {
    registerCommand: (name: string, callback: () => void) => { host.commands.set(name, callback); return { dispose: () => host.commands.delete(name) }; },
    executeCommand: vi.fn(),
  },
  window: {
    createOutputChannel: () => ({ appendLine: vi.fn(), show: host.show, dispose: vi.fn() }),
    showSaveDialog: async () => ({ fsPath: host.target }), showInformationMessage: vi.fn(),
  },
  workspace: {
    getConfiguration: () => ({ get: () => host.enabled }),
    fs: { readFile: async () => Buffer.from('Local diagnostic guide') },
    onDidChangeConfiguration: (listener: (event: { affectsConfiguration(key: string): boolean }) => void) => {
      host.listeners.add(listener); return { dispose: () => host.listeners.delete(listener) };
    },
  },
}));
const directories: string[] = [];
afterEach(async () => { host.enabled = true; host.show.mockClear(); await Promise.all(directories.splice(0)
  .map(directory => rm(directory, { recursive: true, force: true }))); });

/** Read ZIP central-directory entries to verify the actual archive, not a mocked exporter call. */
function zipEntries(zip: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>();
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  let offset = zip.readUInt32LE(end + 16);
  const count = zip.readUInt16LE(end + 10);
  for (let index = 0; index < count; index++) {
    const method = zip.readUInt16LE(offset + 10);
    const size = zip.readUInt32LE(offset + 20);
    const nameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    const local = zip.readUInt32LE(offset + 42);
    const name = zip.toString('utf8', offset + 46, offset + 46 + nameLength);
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const compressed = zip.subarray(start, start + size);
    entries.set(name, method === 8 ? inflateRawSync(compressed) : compressed);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

it('registers local viewing, honors its own switch, and exports real statistics in the existing diagnostics ZIP', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'droid-analytics-export-'));
  directories.push(directory);
  host.target = join(directory, 'diagnostics.zip');
  const subscriptions: vscode.Disposable[] = [];
  const context = { subscriptions, globalStorageUri: { fsPath: directory }, extensionUri: { fsPath: directory },
    extension: { packageJSON: { version: '0.8.15' } } } as unknown as vscode.ExtensionContext;
  const analytics = registerLocalFrontendAnalytics(context, directory);
  host.commands.get('droidvisx.openLocalAnalytics')?.();
  expect(host.show).toHaveBeenCalledOnce();
  analytics.record({ level: 'info', name: 'webview.perf-batch', detail: JSON.stringify({
    source: 'activity.expand', surface: 'history', durationMs: 26, records: 35,
  }) });
  host.enabled = false;
  host.listeners.forEach(listener => listener({ affectsConfiguration: key => key === 'droidvisx.localAnalytics.enabled' }));
  analytics.record({ level: 'error', name: 'webview.error', detail: 'must-not-be-logged' });
  await analytics.flush();
  await exportDiagnosticsBundle(context, directory);
  const entries = zipEntries(await readFile(host.target));
  const logName = [...entries.keys()].find(name => /^logs\/local-analytics\/droidvisx-\d{8}\.jsonl$/u.test(name));
  expect(logName).toBeDefined();
  const contents = entries.get(logName!)!.toString('utf8');
  expect(contents).toContain('activity.expand');
  expect(contents).not.toContain('frontend.error');
  expect(JSON.parse(entries.get('metadata.json')!.toString('utf8')).logFileCount).toBe(1);
  subscriptions.forEach(disposable => disposable.dispose());
  expect(host.commands.size).toBe(0);
  expect(host.listeners.size).toBe(0);
});
