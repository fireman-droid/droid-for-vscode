import { cpSync, existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const includeExtension = !process.argv.includes('--webview-only');
const repoRoot = process.cwd();
const webviewSrc = path.join(repoRoot, 'dist', 'webview');
const extensionSrc = path.join(repoRoot, 'dist', 'extension');

if (!existsSync(webviewSrc)) {
  throw new Error(`Missing dist/webview directory at ${webviewSrc}. Run build:webview first.`);
}

const roots = [
  path.join(homedir(), '.vscode', 'extensions'),
  path.join(homedir(), '.cursor', 'extensions'),
];

let syncedCount = 0;
for (const root of roots) {
  if (!existsSync(root)) continue;
  const entries = readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name.startsWith('droidvisx.droidvisx-'))
    .map(entry => path.join(root, entry.name));

  for (const targetDir of entries) {
    cpSync(webviewSrc, path.join(targetDir, 'dist', 'webview'), { recursive: true, force: true });
    if (includeExtension && existsSync(extensionSrc)) {
      cpSync(extensionSrc, path.join(targetDir, 'dist', 'extension'), { recursive: true, force: true });
    }
    syncedCount += 1;
    console.log(`Synced webview bundle -> ${targetDir}`);
  }
}

if (syncedCount === 0) {
  console.warn('No installed droidvisx.droidvisx-* extension directories found under ~/.vscode or ~/.cursor.');
}
