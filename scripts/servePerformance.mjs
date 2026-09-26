// Production-component benchmark served locally; drive it through the browser UI.
// node scripts/servePerformance.mjs [--baseline-directory=C:/path] [--port=4188]
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createMarkdownWorkerBuild } from '../packages/chat-ui/scripts/markdownWorkerBuild.mjs';

const root = process.cwd(), require = createRequire(import.meta.url);
const argument = (name) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const baseline = argument('baseline-directory');
const site = await mkdtemp(path.join(tmpdir(), 'droid-perf-site-'));
const variants = baseline ? ['baseline', 'current'] : ['current'];
for (const variant of variants) {
  await build({ absWorkingDir: root, entryPoints: ['src/webview-v2/dev/performanceBenchmark.tsx'],
    outfile: path.join(site, `${variant}.js`), bundle: true, minify: true, platform: 'browser', format: 'iife', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"', __DVX_BUILD_ID__: '"performance"', __DVX_VERSION__: '"benchmark"' },
    alias: { '@droidvisx/chat-ui': path.join(root, 'packages/chat-ui/src'), 'react-dom/client': require.resolve('react-dom/profiling') },
    plugins: [{ name: 'task-baseline', setup(builder) {
      if (variant !== 'baseline') return;
      builder.onLoad({ filter: /(?:src|packages)[\\/].*\.(?:ts|tsx)$/ }, async (args) => {
        if (args.path.includes('node_modules')) return;
        const file = path.join(baseline, path.relative(root, args.path));
        try { await stat(file); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
        return { contents: await readFile(file, 'utf8'), loader: args.path.endsWith('tsx') ? 'tsx' : 'ts', resolveDir: path.dirname(args.path) };
      });
    } }, createMarkdownWorkerBuild().esbuild], logLevel: 'warning' });
}
const tailwind = path.join(path.dirname(require.resolve('@tailwindcss/cli/package.json')), 'dist/index.mjs');
execFileSync(process.execPath, [tailwind, '-i', 'src/webview-v2/theme.css', '-o', path.join(site, 'theme-input.css'), '--minify'], { stdio: 'pipe' });
await build({ entryPoints: [path.join(site, 'theme-input.css')], outfile: path.join(site, 'theme.css'), bundle: true, minify: true,
  loader: { '.woff2': 'file', '.woff': 'file', '.ttf': 'file' }, logLevel: 'warning',
  plugins: [{ name: 'local-fonts', setup(builder) { builder.onResolve({ filter: /(?:fonts[\\/])?KaTeX_[\w-]+\.(?:woff2?|ttf)$/ }, (args) => ({
    path: path.join(path.dirname(require.resolve('katex/dist/katex.min.css')), 'fonts', path.basename(args.path)),
  })); } }] });
const server = createServer(async (request, response) => {
  const name = path.basename(new URL(request.url, 'http://localhost').pathname);
  response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; worker-src blob:; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'none'; img-src 'self' data:");
  if (variants.includes(name)) {
    response.setHeader('Content-Type', 'text/html');
    response.end(`<!doctype html><html data-dvx-theme="dark"><meta charset="utf-8"><title>Droid performance ${name}</title><link rel="stylesheet" href="/theme.css"><style>body{margin:0;background:#232638;color:#bbc4e8}#root{height:100vh;max-width:900px;margin:auto}</style><div id="root" class="agent-chat-ui" data-theme="dark"></div><script src="/${name}.js"></script></html>`);
    return;
  }
  try {
    response.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'font/woff2');
    response.end(await readFile(path.join(site, name)));
  } catch { response.writeHead(404).end(); }
});
await new Promise((resolve) => server.listen(Number(argument('port') ?? 4188), '127.0.0.1', resolve));
console.log(JSON.stringify({ origin: `http://127.0.0.1:${server.address().port}`, variants, site }));
