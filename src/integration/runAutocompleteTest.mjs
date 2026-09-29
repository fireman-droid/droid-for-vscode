import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Usage: node src/integration/runAutocompleteTest.mjs <Code.exe> [VSIX]
// The test host belongs to a temporary desktop that is never made visible.
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const executable = path.resolve(process.argv[2] ?? '');
const vsix = path.resolve(process.argv[3] ?? path.join(repository, 'dist/droidvisx.vsix'));
assert.equal(process.platform, 'win32', 'This runner requires an isolated Windows desktop.');
assert.ok(process.argv[2], 'Pass the VS Code executable path explicitly.');
assert.ok(['code.exe','cursor.exe'].includes(path.basename(executable).toLowerCase()), 'Use VS Code or Cursor explicitly.');
const root = mkdtempSync(path.join(tmpdir(), 'droid-autocomplete-native-'));
const extracted = path.join(root, 'package');
const profile = path.join(root, 'user-data');
const extensions = path.join(root, 'extensions');
const resultPath = path.join(root, 'result.json');
for (const directory of [extracted, extensions, path.join(profile, 'User')]) mkdirSync(directory, { recursive: true });
execFileSync('tar', ['-xf', vsix, '-C', extracted, 'extension'], { windowsHide: true });
writeFileSync(path.join(profile, 'User', 'settings.json'), JSON.stringify({
  'update.mode': 'none', 'extensions.autoCheckUpdates': false, 'extensions.autoUpdate': false,
  'telemetry.telemetryLevel': 'off', 'workbench.startupEditor': 'none',
  'workbench.settings.enableNaturalLanguageSearch': false,
  'editor.inlineSuggest.enabled': true,
  'droidvisx.autocomplete.enabled': true, 'droidvisx.autocomplete.relatedFiles': false,
  'droidvisx.autocomplete.debounceMs': 100,
}, null, 2));
const isCursor = path.basename(executable).toLowerCase() === 'cursor.exe';
const workspace = path.join(root, 'workspace');
if (isCursor) mkdirSync(workspace);
const args = [
  '--new-window', ...(isCursor ? [workspace] : ['--disable-extensions']),
  '--disable-updates', '--skip-welcome',
  '--skip-release-notes', '--no-cached-data', '--disable-workspace-trust',
  '--disable-gpu-sandbox', '--no-sandbox',
  `--user-data-dir=${profile}`, `--extensions-dir=${extensions}`,
  `--extensionDevelopmentPath=${path.join(extracted, 'extension')}`,
  `--extensionTestsPath=${path.join(repository, 'src/integration/suite/autocomplete.cjs')}`,
];
function quote(argument) {
  return '"' + argument.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, '$1$1') + '"';
}
const configPath = path.join(root, 'launch.json');
writeFileSync(configPath, JSON.stringify({ executable, commandLine: [executable, ...args].map(quote).join(' '),
  directory: root, resultPath, timeoutMs: 180_000 }));
console.log(`Native autocomplete artifacts: ${root}`);
const exitCode = await new Promise((resolve, reject) => {
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', path.join(repository, 'src/integration/isolatedDesktop.ps1'), '-ConfigPath', configPath],
  { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.pipe(process.stdout); child.stderr.pipe(process.stderr);
  child.once('error', reject); child.once('exit', resolve);
});
let result;
try { result = JSON.parse(readFileSync(resultPath, 'utf8')); }
catch { throw new Error(`Test host did not produce a result (exit ${exitCode}); inspect isolated logs in ${root}.`); }
console.log(JSON.stringify(result, null, 2));
assert.equal(exitCode, 0, `Isolated VS Code test host failed; artifacts: ${root}`);
assert.equal(result.failed, 0, 'Native autocomplete acceptance failed.');
