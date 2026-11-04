import { cpSync, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repository = fileURLToPath(new URL('../', import.meta.url));
const requiredAssets = {
  webview: ['webview.js', 'webview.css', 'management.js', 'models.js', 'review.js', 'mission-control.js', 'session-viewer.js'],
  extension: ['extension.cjs', 'sessionCatalogWorker.cjs', 'persistentIdeRelayWorker.cjs', 'btwAnalysisWorker.cjs'],
};
const json = file => JSON.parse(readFileSync(file, 'utf8'));

function changedFiles(source, destination) {
  return readdirSync(source, { withFileTypes: true }).flatMap(entry => {
    const from = path.join(source, entry.name), to = path.join(destination, entry.name);
    if (entry.isDirectory()) return changedFiles(from, to);
    if (existsSync(to) && readFileSync(from).equals(readFileSync(to))) return [];
    return [{ from, to }];
  });
}

/** Sync only registered installations; hot updates never rewrite extension manifests. */
export function syncGlobalExtensions({ repoRoot = repository, home = homedir(), mode = 'all', dryRun = false } = {}) {
  if (!['all', 'webview', 'extension'].includes(mode)) throw new Error(`Unknown sync mode: ${mode}`);
  const groups = mode === 'all' ? ['webview', 'extension'] : [mode];
  const manifest = json(path.join(repoRoot, 'package.json'));
  const id = `${manifest.publisher}.${manifest.name}`;
  for (const group of groups) {
    for (const asset of requiredAssets[group]) {
      const file = path.join(repoRoot, 'dist', group, asset);
      if (!existsSync(file) || !statSync(file).isFile() || statSync(file).size === 0) {
        throw new Error(`Missing ${file}. Build the selected ${group} assets before syncing.`);
      }
    }
  }

  const targets = [];
  for (const [editor, folder] of [['VS Code', '.vscode'], ['Cursor', '.cursor']]) {
    const root = path.join(home, folder, 'extensions');
    const registry = path.join(root, 'extensions.json');
    if (!existsSync(registry)) continue;
    const obsoletePath = path.join(root, '.obsolete');
    const obsolete = existsSync(obsoletePath) ? json(obsoletePath) : {};
    const locations = new Set(json(registry).filter(entry => entry.identifier?.id === id)
      .map(entry => entry.relativeLocation));
    for (const location of locations) {
      if (typeof location !== 'string' || !location.startsWith(`${id}-`) || /[/\\]/.test(location)) {
        throw new Error(`Invalid ${editor} extension location.`);
      }
      if (obsolete[location]) continue;
      const directory = path.join(root, location);
      const installed = json(path.join(directory, 'package.json'));
      if (installed.version !== manifest.version || installed.publisher !== manifest.publisher || installed.name !== manifest.name) {
        throw new Error(`${editor}: installed extension differs from this version. Install a VSIX before using hot updates.`);
      }
      const files = groups.flatMap(group => changedFiles(
        path.join(repoRoot, 'dist', group), path.join(directory, 'dist', group)));
      targets.push({ editor, directory, files });
    }
  }
  if (!targets.length) throw new Error('No registered Droid installation found in VS Code or Cursor. Install a VSIX first.');
  // Finish preflight for both editors before writing to either installation.
  if (!dryRun) for (const target of targets) {
    for (const file of target.files) cpSync(file.from, file.to, { force: true });
  }
  return targets.map(({ editor, directory, files }) => ({ editor, directory, changedFiles: files.length }));
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const args = process.argv.slice(2);
    if (args.some(arg => !['--webview-only', '--extension-only', '--dry-run'].includes(arg)) ||
      args.includes('--webview-only') && args.includes('--extension-only')) throw new Error('Choose one sync mode: --webview-only or --extension-only.');
    const mode = args.includes('--webview-only') ? 'webview' : args.includes('--extension-only') ? 'extension' : 'all';
    const dryRun = args.includes('--dry-run');
    for (const result of syncGlobalExtensions({ mode, dryRun })) {
      console.log(`${dryRun ? 'Would sync' : 'Synced'} ${mode}: ${result.editor}, ${result.changedFiles} changed files -> ${result.directory}`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
