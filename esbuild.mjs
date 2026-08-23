import { build } from 'esbuild';
import { rm } from 'node:fs/promises';
import { isBuiltin } from 'node:module';

// Stamped into the webview bundle so boot beacons in the diagnostics log
// prove which build actually ran (stale webview caches are invisible
// otherwise).
const buildId = new Date()
  .toISOString()
  .replace(/[-:]/gu, '')
  .slice(0, 15);

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
  minify: true,
  define: {
    'process.env.NODE_ENV': '"production"',
    __DVX_BUILD_ID__: JSON.stringify(buildId),
  },
  loader: {
    '.woff2': 'file',
    '.woff': 'file',
    '.ttf': 'file',
  },
  assetNames: 'assets/[name]',
  sourcemap: false,
  legalComments: 'none',
  metafile: true,
  logLevel: 'info',
});

const sessionViewerResult = await build({
  entryPoints: ['src/webview/sessionViewer/main.tsx'],
  outfile: 'dist/webview/session-viewer.js',
  bundle: true,
  packages: 'bundle',
  platform: 'browser',
  format: 'iife',
  target: 'es2022',
  minify: true,
  define: {
    'process.env.NODE_ENV': '"production"',
    __DVX_BUILD_ID__: JSON.stringify(buildId),
  },
  sourcemap: false,
  legalComments: 'none',
  metafile: true,
  logLevel: 'info',
});

const missionControlResult = await build({
  entryPoints: ['src/webview/missionControl/main.ts'],
  outfile: 'dist/webview/mission-control.js',
  bundle: true,
  packages: 'bundle',
  platform: 'browser',
  format: 'iife',
  target: 'es2022',
  minify: true,
  define: {
    'process.env.NODE_ENV': '"production"',
    __DVX_BUILD_ID__: JSON.stringify(buildId),
  },
  sourcemap: false,
  legalComments: 'none',
  metafile: true,
  logLevel: 'info',
});

const missionControlCssResult = await build({
  entryPoints: ['src/webview/missionControl/missionControl.css'],
  outfile: 'dist/webview/mission-control.css',
  bundle: true,
  platform: 'browser',
  minify: true,
  sourcemap: false,
  legalComments: 'none',
  metafile: true,
  logLevel: 'info',
});

// Separate lazily loaded bundle: the webview injects it on demand the
// first time a completed ```mermaid block needs rendering (script tag
// carrying the page nonce), keeping mermaid out of the first-screen
// bundle. iife because the nonce-only CSP rules out module chunks.
const mermaidResult = await build({
  entryPoints: ['src/webview/mermaidRuntime.ts'],
  outfile: 'dist/webview/mermaid.js',
  bundle: true,
  packages: 'bundle',
  platform: 'browser',
  format: 'iife',
  target: 'es2022',
  minify: true,
  define: {
    'process.env.NODE_ENV': '"production"',
  },
  sourcemap: false,
  legalComments: 'none',
  metafile: true,
  logLevel: 'info',
});

assertExpectedExternals(extensionResult.metafile, {
  required: new Set(['vscode']),
  allowed: (path) =>
    path === 'vscode' ||
    isBuiltin(path) ||
    optionalWsAddons.includes(path),
});
assertExpectedExternals(webviewResult.metafile, {
  required: new Set(),
  allowed: () => false,
});
assertExpectedExternals(sessionViewerResult.metafile, {
  required: new Set(),
  allowed: () => false,
});
assertExpectedExternals(missionControlResult.metafile, {
  required: new Set(),
  allowed: () => false,
});
assertExpectedExternals(missionControlCssResult.metafile, {
  required: new Set(),
  allowed: () => false,
});
assertExpectedExternals(mermaidResult.metafile, {
  required: new Set(),
  allowed: () => false,
});
assertNoForbiddenWebviewInputs(webviewResult.metafile);
assertNoForbiddenWebviewInputs(sessionViewerResult.metafile);
assertNoForbiddenWebviewInputs(missionControlResult.metafile);
assertNoForbiddenWebviewInputs(mermaidResult.metafile);
assertMermaidStaysLazy(webviewResult.metafile);
assertMermaidStaysLazy(sessionViewerResult.metafile);

// The whole point of the separate bundle is boot performance; fail the
// build if a future refactor statically imports mermaid into the
// first-screen bundle.
function assertMermaidStaysLazy(metafile) {
  for (const output of Object.values(metafile.outputs)) {
    for (const [input, contribution] of Object.entries(output.inputs)) {
      if (
        contribution.bytesInOutput > 0 &&
        input.replaceAll('\\', '/').includes('node_modules/mermaid/')
      ) {
        throw new Error(
          'mermaid was bundled into the main webview bundle; it must stay in dist/webview/mermaid.js.',
        );
      }
    }
  }
}

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
