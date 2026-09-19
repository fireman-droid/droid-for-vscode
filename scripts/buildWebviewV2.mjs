import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createThirdPartyNotices } from '../packages/chat-ui/scripts/thirdPartyNotices.mjs';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(repository, 'dist', process.argv.includes('--production') ? 'webview' : 'webview-v2');
const require = createRequire(import.meta.url);
const notices = createThirdPartyNotices(repository, path.join(repository, 'packages/chat-ui/THIRD_PARTY_LICENSES.txt'));
await notices.addPreprocessedPackage(path.dirname(require.resolve('tailwindcss/package.json')));
const tailwind = path.join(path.dirname(require.resolve('@tailwindcss/cli/package.json')), 'dist/index.mjs');
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
execFileSync(process.execPath, [
  tailwind,
  '-i', path.join(repository, 'src/webview-v2/theme.css'),
  '-o', path.join(output, 'styles.generated.css'),
  '--minify',
], { cwd: repository, stdio: 'inherit' });

const cssResult = await build({
  absWorkingDir: repository,
  entryPoints: [path.join(output, 'styles.generated.css')],
  outfile: path.join(output, 'webview.css'),
  bundle: true,
  minify: true,
  metafile: true,
  legalComments: 'eof',
  loader: { '.woff2': 'file', '.woff': 'file', '.ttf': 'file' },
  assetNames: 'assets/[name]',
  plugins: [{
    name: 'katex-local-fonts',
    setup(cssBuild) {
      cssBuild.onResolve({ filter: /^fonts\/KaTeX_[\w-]+\.(?:woff2?|ttf)$/ }, (args) => ({
        path: path.join(path.dirname(require.resolve('katex/dist/katex.min.css')), args.path),
      }));
    },
  }],
  logLevel: 'info',
});
await notices.add(cssResult.metafile);
await rm(path.join(output, 'styles.generated.css'));

for (const [entryPoint, filename] of [
  ['src/webview-v2/chat/main.tsx', 'webview'],
  ['src/webview-v2/models/main.tsx', 'models'],
  ['src/webview-v2/mission/main.tsx', 'mission-control'],
  ['src/webview-v2/viewer/main.tsx', 'session-viewer'],
  ['src/webview-v2/review/main.tsx', 'review'],
  ['src/webview/mermaidRuntime.ts', 'mermaid'],
]) {
  const result = await build({
    absWorkingDir: repository,
    entryPoints: [entryPoint],
    outfile: path.join(output, `${filename}.js`),
    bundle: true,
    packages: 'bundle',
    platform: 'browser',
    format: 'iife',
    target: 'es2022',
    minify: true,
    define: {
      'process.env.NODE_ENV': '"production"',
      __DVX_BUILD_ID__: JSON.stringify(`v2-${new Date().toISOString()}`),
    },
    metafile: true,
    sourcemap: false,
    legalComments: 'eof',
    logLevel: 'info',
  });
  await notices.add(result.metafile);
  let usesChatUi = false;
  for (const asset of Object.values(result.metafile.outputs)) {
    for (const [input, contribution] of Object.entries(asset.inputs)) {
      if (contribution.bytesInOutput === 0) continue;
      const normalized = input.replaceAll('\\', '/');
      if (normalized.includes('packages/chat-ui/src/')) usesChatUi = true;
      if (/@assistant-ui|assistant-cloud|\/runtimes\/cloud\/|@factory\/droid-sdk|src\/(?:extension|runtime)\//u.test(normalized)) {
        throw new Error(`V2 contains a forbidden runtime dependency: ${input}`);
      }
      if (filename !== 'mermaid' && normalized.includes('node_modules/mermaid/')) {
        throw new Error(`Mermaid must stay in its lazy bundle: ${input}`);
      }
    }
    if (asset.imports.some((entry) => entry.external)) throw new Error('V2 must have no runtime externals.');
  }
  if (filename !== 'mermaid' && !usesChatUi) throw new Error(`Production view does not consume chat-ui: ${filename}`);
}
await notices.write(path.join(output, 'THIRD_PARTY_LICENSES.txt'));
