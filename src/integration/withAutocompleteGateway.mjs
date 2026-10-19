import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { build } from 'esbuild';

// Uses the selected VS Code profile's normal SecretStorage in a temporary Droid
// development Host. It does not install an extension or copy profile credentials.
const [executable, separator, command, ...args] = process.argv.slice(2);
assert.ok(executable && separator === '--' && command,
  'Usage: node src/integration/withAutocompleteGateway.mjs <Code.exe> -- <command> [arguments]');
assert.equal(path.basename(executable).toLowerCase(), 'code.exe', 'Select Microsoft VS Code explicitly');
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const root = mkdtempSync(path.join(tmpdir(), 'droid-model-gateway-'));
const extension = path.join(root, 'extension'), workspace = path.join(root, 'workspace');
mkdirSync(extension); mkdirSync(workspace);
const manifest = JSON.parse(readFileSync(path.join(repository, 'package.json'), 'utf8'));
writeFileSync(path.join(extension, 'package.json'), JSON.stringify({
  name: manifest.name, publisher: manifest.publisher, version: manifest.version, engines: manifest.engines,
  main: './gateway.cjs', activationEvents: ['onStartupFinished'],
}));
writeFileSync(path.join(extension, 'gateway-config.json'), JSON.stringify({ workspace }));
await build({ entryPoints: [path.join(repository, 'src/integration/autocomplete-quality/gateway.ts')],
  outfile: path.join(extension, 'gateway.cjs'), bundle: true, platform: 'node', format: 'cjs',
  external: ['vscode'], logLevel: 'silent' });
const descriptor = path.join(extension, 'gateway.json');
const editorEnv = { ...process.env };
delete editorEnv.ELECTRON_RUN_AS_NODE;
const launcher = spawn(executable, ['--new-window', workspace, '--disable-extensions', '--skip-welcome',
  '--skip-release-notes', `--extensionDevelopmentPath=${extension}`],
{ windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'], env: editorEnv });
let launchError, launcherStderr = '';
launcher.on('error', error => { launchError = error; });
launcher.stderr.on('data', chunk => { if (launcherStderr.length < 2000) launcherStderr += chunk; });
launcher.on('exit', code => { if (code) launchError = new Error(`Editor launcher exited ${code}: ${launcherStderr}`); });
try {
  const deadline = Date.now() + 60_000;
  while (!existsSync(descriptor) && !launchError && Date.now() < deadline) await delay(200);
  if (!existsSync(descriptor)) throw new Error(`Development Host did not start (${launchError?.message ?? 'timeout'}). Artifacts: ${root}`);
  console.log('Temporary VS Code model gateway ready; provider credentials remain in SecretStorage.');
  process.exitCode = await new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: 'inherit',
      env: { ...process.env, DROID_AUTOCOMPLETE_GATEWAY_FILE: descriptor } });
    child.once('error', reject); child.once('exit', code => resolve(code ?? 1));
  });
} finally {
  if (existsSync(descriptor)) {
    const bridge = new URL(JSON.parse(readFileSync(descriptor, 'utf8')).url);
    const parameters = new URLSearchParams(bridge.hash.slice(1));
    await fetch(`http://127.0.0.1:${parameters.get('bridgePort')}/shutdown`, {
      method: 'POST', signal: AbortSignal.timeout(5000),
      headers: { Origin: 'http://127.0.0.1:4173', Authorization: `Bearer ${parameters.get('token')}` },
    }).catch(() => console.error('Temporary gateway did not acknowledge shutdown.'));
    unlinkSync(descriptor);
  }
}
