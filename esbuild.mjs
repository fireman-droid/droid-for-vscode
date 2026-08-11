import { build } from 'esbuild';
import { rm } from 'node:fs/promises';
import { isBuiltin } from 'node:module';

const extensionResult = await build({
  entryPoints: ['src/extension/extension.ts'],
  outfile: 'dist/extension/extension.cjs',
  bundle: true,
  external: ['vscode'],
  packages: 'bundle',
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  sourcemap: false,
  legalComments: 'none',
  metafile: true,
  logLevel: 'info',
});

await rm('dist/webview', { recursive: true, force: true });

const webviewResult = await build({
  entryPoints: ['src/webview/main.tsx'],
  outfile: 'dist/webview/webview.js',
  bundle: true,
  packages: 'bundle',
  platform: 'browser',
  format: 'iife',
  target: 'es2022',
  loader: {
    '.woff2': 'file',
  },
  assetNames: 'assets/[name]',
  sourcemap: false,
  legalComments: 'none',
  metafile: true,
  logLevel: 'info',
});

assertExpectedExternals(extensionResult.metafile, {
  required: new Set(['vscode']),
  allowed: (path) => path === 'vscode' || isBuiltin(path),
});
assertExpectedExternals(webviewResult.metafile, {
  required: new Set(),
  allowed: () => false,
});
assertNoForbiddenWebviewInputs(webviewResult.metafile);

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

function assertNoForbiddenWebviewInputs(metafile) {
  const forbidden = [];
  for (const output of Object.values(metafile.outputs)) {
    for (const [input, contribution] of Object.entries(output.inputs)) {
      if (
        contribution.bytesInOutput > 0 &&
        isForbiddenWebviewInput(input)
      ) {
        forbidden.push(input);
      }
    }
  }

  if (forbidden.length > 0) {
    throw new Error(
      `Forbidden modules were emitted into the Webview bundle: ${JSON.stringify(forbidden)}`,
    );
  }
}

function isForbiddenWebviewInput(input) {
  const normalized = input.replaceAll('\\', '/');
  return (
    normalized.includes('@factory/droid-sdk') ||
    normalized.includes('assistant-cloud') ||
    normalized.includes('/runtimes/cloud/') ||
    normalized.startsWith('src/extension/') ||
    normalized.startsWith('src/runtime/')
  );
}
