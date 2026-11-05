import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { syncGlobalExtensions } from '../../scripts/syncGlobalExtensions.mjs';

const temporary: string[] = [];
afterEach(() => { for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'droid-sync-')); temporary.push(root);
  const repoRoot = path.join(root, 'repo'), home = path.join(root, 'home');
  const manifest = { publisher: 'droidvisx', name: 'droidvisx', version: '0.8.20' };
  const write = (file: string, value: string) => { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, value); };
  write(path.join(repoRoot, 'package.json'), JSON.stringify(manifest));
  for (const asset of ['webview.js', 'webview.css', 'management.js', 'models.js', 'review.js', 'mission-control.js', 'session-viewer.js'])
    write(path.join(repoRoot, 'dist/webview', asset), 'new page');
  for (const asset of ['extension.cjs', 'sessionCatalogWorker.cjs', 'persistentIdeRelayWorker.cjs', 'btwAnalysisWorker.cjs'])
    write(path.join(repoRoot, 'dist/extension', asset), 'new host');
  const targets = ['.vscode', '.cursor'].map(editor => {
    const extensions = path.join(home, editor, 'extensions');
    const location = 'droidvisx.droidvisx-0.8.20', directory = path.join(extensions, location);
    write(path.join(extensions, 'extensions.json'), JSON.stringify([{ identifier: { id: 'droidvisx.droidvisx' }, relativeLocation: location }]));
    write(path.join(directory, 'package.json'), JSON.stringify({ ...manifest, __metadata: { keep: true } }));
    write(path.join(directory, 'dist/webview/webview.js'), 'old page');
    write(path.join(directory, 'dist/extension/extension.cjs'), 'old host');
    const old = path.join(extensions, 'droidvisx.droidvisx-0.8.19/dist/webview/webview.js');
    write(old, 'retained old install');
    return { directory, old };
  });
  return { repoRoot, home, targets, write, manifest };
}

it.each(['webview', 'extension'] as const)('syncs only %s assets to both registered editor installations', mode => {
  const f = fixture();
  const result = syncGlobalExtensions({ ...f, mode });
  expect(result.map(item => item.editor)).toEqual(['VS Code', 'Cursor']);
  for (const target of f.targets) {
    expect(readFileSync(path.join(target.directory, 'dist/webview/webview.js'), 'utf8')).toBe(mode === 'webview' ? 'new page' : 'old page');
    expect(readFileSync(path.join(target.directory, 'dist/extension/extension.cjs'), 'utf8')).toBe(mode === 'extension' ? 'new host' : 'old host');
    expect(JSON.parse(readFileSync(path.join(target.directory, 'package.json'), 'utf8')).__metadata).toEqual({ keep: true });
    expect(readFileSync(target.old, 'utf8')).toBe('retained old install');
  }
  expect(syncGlobalExtensions({ ...f, mode }).every(item => item.changedFiles === 0)).toBe(true);
});

it('preflights both editors and leaves files unchanged on dry runs, missing builds and version mismatches', () => {
  const f = fixture();
  expect(syncGlobalExtensions({ ...f, dryRun: true }).every(item => item.changedFiles > 0)).toBe(true);
  const unchanged = () => f.targets.forEach(target =>
    expect(readFileSync(path.join(target.directory, 'dist/webview/webview.js'), 'utf8')).toBe('old page'));
  unchanged();
  const asset = path.join(f.repoRoot, 'dist/extension/extension.cjs');
  rmSync(asset);
  expect(() => syncGlobalExtensions(f)).toThrow('Missing');
  unchanged();
  f.write(asset, 'new host');
  f.write(path.join(f.targets[1].directory, 'package.json'), JSON.stringify({ ...f.manifest, version: '0.8.19' }));
  expect(() => syncGlobalExtensions(f)).toThrow('Install a VSIX');
  unchanged();
});
