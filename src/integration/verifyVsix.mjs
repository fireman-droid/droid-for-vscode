import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const vsixPath = path.resolve(process.argv[2] ?? 'dist/droidvisx.vsix');
const expectedEntries = [
  '[Content_Types].xml',
  'extension.vsixmanifest',
  // Shown as the Changelog tab on the extension details page; vsce
  // lowercases the entry name inside the archive.
  'extension/changelog.md',
  'extension/dist/extension/extension.cjs',
  'extension/dist/webview/assets/inter-latin-wght-normal.woff2',
  // Lazily injected mermaid bundle; ships alongside webview.js but is
  // only loaded when a completed ```mermaid block needs rendering.
  'extension/dist/webview/mermaid.js',
  'extension/dist/webview/session-viewer.js',
  'extension/dist/webview/webview.css',
  'extension/dist/webview/webview.js',
  // Shipped so "Export Diagnostics Bundle" can include the AI playbook.
  'extension/docs/product/log-analysis-playbook.md',
  'extension/package.json',
  'extension/resources/droidvisx.svg',
].sort();

const entries = execFileSync('tar', ['-tf', vsixPath], {
  encoding: 'utf8',
})
  .split(/\r?\n/u)
  .filter(Boolean)
  .sort();
assert.deepEqual(
  entries,
  expectedEntries,
  `Unexpected VSIX contents:\n${entries.join('\n')}`,
);

const manifest = JSON.parse(readEntry('extension/package.json'));
assert.equal(manifest.main, './dist/extension/extension.cjs');
assert.ok(
  manifest.contributes.commands.some(
    (entry) => entry.command === 'droidvisx.focusView',
  ),
);
assert.ok(
  manifest.contributes.commands.some(
    (entry) => entry.command === 'droidvisx.openLogs',
  ),
);
assert.ok(
  manifest.contributes.views.droidvisx.some(
    (entry) => entry.id === 'droidvisx.chat' && entry.type === 'webview',
  ),
);

const extensionBundle = readEntry('extension/dist/extension/extension.cjs');
assert.match(
  extensionBundle,
  /\brequire\(["']vscode["']\)/u,
  'Extension bundle must externalize vscode',
);
assert.doesNotMatch(
  extensionBundle,
  /\brequire\(["']@factory\/droid-sdk/u,
  'Factory Droid SDK must be bundled into the extension',
);
assert.doesNotMatch(extensionBundle, /sourceMappingURL/u);

const webviewBundle = readEntry('extension/dist/webview/webview.js');
assert.deepEqual(
  [...staticRequires(webviewBundle)],
  [],
  'Webview bundle must have no runtime externals',
);
assert.doesNotMatch(webviewBundle, /sourceMappingURL/u);
assert.doesNotMatch(webviewBundle, /@factory\/droid-sdk/u);
assert.doesNotMatch(webviewBundle, /assistant-cloud/iu);
assert.doesNotMatch(webviewBundle, /\bAssistantCloud\b/u);
assert.doesNotMatch(webviewBundle, /\bProcessTransport\b/u);
assert.doesNotMatch(webviewBundle, /\bDroidClient\b/u);
assert.doesNotMatch(webviewBundle, /\brequire\(["']vscode["']\)/u);
assert.doesNotMatch(webviewBundle, /\beval\s*\(/u);
assert.doesNotMatch(webviewBundle, /\bnew\s+Function\s*\(/u);

const sessionViewerBundle = readEntry(
  'extension/dist/webview/session-viewer.js',
);
assert.deepEqual(
  [...staticRequires(sessionViewerBundle)],
  [],
  'Session Viewer bundle must have no runtime externals',
);
assert.doesNotMatch(sessionViewerBundle, /sourceMappingURL/u);
assert.doesNotMatch(sessionViewerBundle, /@factory\/droid-sdk/u);
assert.doesNotMatch(sessionViewerBundle, /assistant-cloud/iu);
assert.doesNotMatch(sessionViewerBundle, /\bProcessTransport\b/u);
assert.doesNotMatch(sessionViewerBundle, /\bDroidClient\b/u);
assert.doesNotMatch(
  sessionViewerBundle,
  /\brequire\(["']vscode["']\)/u,
);
assert.doesNotMatch(sessionViewerBundle, /\beval\s*\(/u);
assert.doesNotMatch(sessionViewerBundle, /\bnew\s+Function\s*\(/u);

const icon = readEntry('extension/resources/droidvisx.svg');
assert.doesNotMatch(icon, /<script\b/iu);
assert.doesNotMatch(icon, /\bon\w+\s*=/iu);

console.log(`Verified ${entries.length} VSIX entries and bundled externals.`);

function readEntry(entry) {
  return execFileSync('tar', ['-xOf', vsixPath, entry], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

function staticRequires(source) {
  return new Set(
    [...source.matchAll(/\brequire\(["']([^"']+)["']\)/gu)].map(
      (match) => match[1],
    ),
  );
}
