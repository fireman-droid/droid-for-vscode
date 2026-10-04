import { appendFileSync, readFileSync, mkdirSync, cpSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { isBuiltin } from 'node:module';
import { createThirdPartyNotices } from './packages/chat-ui/scripts/thirdPartyNotices.mjs';

// Optional native WebSocket accelerators referenced by the Droid
// SDK's bundled `ws` (daemon client). They are not installed; `ws`
// requires them inside try/catch and falls back to its JS
// implementation, so leaving them external is safe.
const optionalWsAddons = ['bufferutil', 'utf-8-validate'];

const extensionResult = await build({
  entryPoints: ['src/extension/extension.ts'],
  outfile: 'dist/extension/extension.cjs',
  bundle: true,
  external: ['vscode', ...optionalWsAddons],
  // Its UMD factory hides relative require calls from esbuild's dependency graph.
  alias: { 'jsonc-parser': 'jsonc-parser/lib/esm/main.js' },
  packages: 'bundle',
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  minify: true,
  // The Droid SDK and host code branch on error/class names at runtime;
  // keep identifiers stable while still compressing the bundle.
  keepNames: true,
  sourcemap: false,
  legalComments: 'eof',
  metafile: true,
  logLevel: 'info',
});

const require = createRequire(import.meta.url);
const assetRoot = 'dist/extension/autocomplete';
mkdirSync(assetRoot, { recursive: true });
cpSync(path.join(path.dirname(require.resolve('web-tree-sitter')), 'tree-sitter.wasm'), path.join(assetRoot, 'tree-sitter.wasm'));
const grammarSource = readFileSync('src/extension/autocomplete/kilo/continuedev/core/util/treeSitter.ts', 'utf8');
const grammarNames = [...grammarSource.match(/export enum LanguageName \{([\s\S]*?)\}/)[1].matchAll(/= "([a-z_]+)"/g)].map(match => match[1]);
const grammarPackage = path.dirname(require.resolve('tree-sitter-wasms/package.json'));
mkdirSync(path.join(assetRoot, 'grammars'), { recursive: true });
for (const name of grammarNames) cpSync(path.join(grammarPackage, 'out', 'tree-sitter-' + name + '.wasm'), path.join(assetRoot, 'grammars', 'tree-sitter-' + name + '.wasm'));
cpSync('src/extension/autocomplete/kilo/continuedev/tree-sitter', path.join(assetRoot, 'queries'), { recursive: true });
const notices = createThirdPartyNotices(process.cwd(), undefined, { 'js-tiktoken@1.0.18': new URL('./third-party/JS-TIKTOKEN-LICENSE.txt', import.meta.url) });
await notices.add(extensionResult.metafile);
await notices.addPreprocessedPackage(grammarPackage);
const catalogWorkerResult = await build({
  entryPoints: ['src/runtime/catalog/sessionCatalogWorker.ts'],
  outfile: 'dist/extension/sessionCatalogWorker.cjs',
  bundle: true,
  external: optionalWsAddons,
  packages: 'bundle',
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  minify: true,
  keepNames: true,
  sourcemap: false,
  legalComments: 'eof',
  metafile: true,
  logLevel: 'info',
});
await notices.add(catalogWorkerResult.metafile);
const historyWorkerResult = await build({
  entryPoints: ['src/runtime/history/sessionHistoryWorker.ts'],
  outfile: 'dist/extension/sessionHistoryWorker.cjs',
  bundle: true, external: optionalWsAddons, packages: 'bundle', platform: 'node',
  format: 'cjs', target: 'node20', minify: true, keepNames: true, sourcemap: false,
  legalComments: 'eof', metafile: true, logLevel: 'info',
});
await notices.add(historyWorkerResult.metafile);
const ideRelayWorkerResult = await build({
  entryPoints: ['src/runtime/ide/persistentIdeRelayWorker.ts'],
  outfile: 'dist/extension/persistentIdeRelayWorker.cjs',
  bundle: true, platform: 'node', format: 'cjs', target: 'node20',
  minify: true, keepNames: true, sourcemap: false, legalComments: 'eof',
  metafile: true, logLevel: 'info',
});
await notices.add(ideRelayWorkerResult.metafile);
await notices.write('dist/extension/THIRD_PARTY_LICENSES.txt');
appendFileSync('dist/extension/THIRD_PARTY_LICENSES.txt', '\nKilo Code (vendored autocomplete, 7d977bce994af36f0edf752cb53e3aefc7aeb214)\n' + readFileSync('third-party/KILO-LICENSE.txt', 'utf8'));

appendFileSync('dist/extension/THIRD_PARTY_LICENSES.txt', '\nContinue (Apache-2.0; autocomplete code via Kilo)\n' + readFileSync('third-party/CONTINUE-LICENSE.txt', 'utf8'));
appendFileSync('dist/extension/THIRD_PARTY_LICENSES.txt', '\n' + readFileSync('third-party/TREE-SITTER-GRAMMARS-LICENSES.txt', 'utf8'));

execFileSync(process.execPath, ['scripts/buildWebviewV2.mjs', '--production'], { stdio: 'inherit' });

assertExpectedExternals(extensionResult.metafile, {
  required: new Set(['vscode']),
  allowed: (path) =>
    path === 'vscode' ||
    isBuiltin(path) ||
    optionalWsAddons.includes(path),
});
assertExpectedExternals(historyWorkerResult.metafile, {
  required: new Set(), allowed: (path) => isBuiltin(path) || optionalWsAddons.includes(path),
});
assertExpectedExternals(ideRelayWorkerResult.metafile, {
  required: new Set(), allowed: (path) => isBuiltin(path),
});
assertExpectedExternals(catalogWorkerResult.metafile, {
  required: new Set(),
  allowed: (path) => isBuiltin(path) || optionalWsAddons.includes(path),
});

function assertExpectedExternals(metafile, expectation) {
  const actual = new Set();
  for (const output of Object.values(metafile.outputs)) {
    for (const imported of output.imports) {
      if (imported.external) {
        actual.add(imported.path);
      }
    }
  }

  const unexpected = [...actual].filter(
    (path) => !expectation.allowed(path),
  );
  const missing = [...expectation.required].filter(
    (path) => !actual.has(path),
  );
  if (unexpected.length > 0 || missing.length > 0) {
    throw new Error(
      `Unexpected bundle externals. Actual: ${JSON.stringify([...actual])}`,
    );
  }
}
