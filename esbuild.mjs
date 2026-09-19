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

const notices = createThirdPartyNotices(process.cwd());
await notices.add(extensionResult.metafile);
await notices.write('dist/extension/THIRD_PARTY_LICENSES.txt');

execFileSync(process.execPath, ['scripts/buildWebviewV2.mjs', '--production'], { stdio: 'inherit' });

assertExpectedExternals(extensionResult.metafile, {
  required: new Set(['vscode']),
  allowed: (path) =>
    path === 'vscode' ||
    isBuiltin(path) ||
    optionalWsAddons.includes(path),
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
