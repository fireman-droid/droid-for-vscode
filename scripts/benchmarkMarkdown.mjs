// Local-only production-renderer benchmark. No Host, Runtime, model, or remote content.
// Run: node scripts/benchmarkMarkdown.mjs --baseline=eb60919 [--runs=3] [--chrome=C:/path/chrome.exe]
import { build } from 'esbuild';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdtemp, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const argument = (name) => process.argv.find((value) => value.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const runs = Number(argument('runs') ?? 3);
const sizes = argument('bytes') ? [Number(argument('bytes'))] : [32768, 131072];
const baselineRef = argument('baseline') ?? 'eb60919';
const chromePath = argument('chrome') ?? path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe');
const temporary = await mkdtemp(path.join(tmpdir(), 'droidvisx-markdown-benchmark-'));
const sourcePath = path.join(repository, 'packages/chat-ui/src/content/Markdown.tsx');
const baseline = execFileSync('git', ['show', `${baselineRef}:packages/chat-ui/src/content/Markdown.tsx`], { cwd: repository, encoding: 'utf8' });
const current = await readFile(sourcePath, 'utf8');
const sourceHash = (text) => createHash('sha256').update(text).digest('hex');
await writeFile(path.join(temporary, 'Markdown.HEAD.tsx'), baseline);
await writeFile(path.join(temporary, 'Markdown.current.tsx'), current);
await mkdir(path.join(temporary, 'site'));
const site = path.join(temporary, 'site');
const metadata = {
  head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim(),
  baselineRef, baselineCommit: execFileSync('git', ['rev-parse', baselineRef], { cwd: repository, encoding: 'utf8' }).trim(),
  baselineHash: sourceHash(baseline), currentHash: sourceHash(current),
  node: process.version, chromePath, viewport: { width: 1000, height: 800 },
  fixture: 'ASCII mixed Markdown; 1024 bytes per 50ms; final streaming=false after one further 50ms; 640px content width',
  runs, temporary,
};
const tailwind = path.join(path.dirname(require.resolve('@tailwindcss/cli/package.json')), 'dist/index.mjs');
execFileSync(process.execPath, [tailwind, '-i', path.join(repository, 'packages/chat-ui/src/theme.css'), '-o', path.join(temporary, 'theme.css'), '--minify'], { cwd: repository, stdio: 'pipe' });
await build({ entryPoints: [path.join(temporary, 'theme.css')], outfile: path.join(site, 'theme.css'), bundle: true,
  minify: true, loader: { '.woff2': 'file', '.woff': 'file', '.ttf': 'file' },
  plugins: [{ name: 'local-katex-fonts', setup(builder) {
    builder.onResolve({ filter: /(?:fonts[\\/])?KaTeX_[\w-]+\.(?:woff2?|ttf)$/ }, (args) => ({
      path: path.join(path.dirname(require.resolve('katex/dist/katex.min.css')), 'fonts', path.basename(args.path)),
    }));
  } }], logLevel: 'silent' });
for (const variant of ['baseline', 'current']) {
  await build({ absWorkingDir: repository, entryPoints: ['src/webview-v2/dev/markdownBenchmark.tsx'],
    outfile: path.join(site, `${variant}.js`), bundle: true, minify: true, platform: 'browser', format: 'iife',
    jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent',
    plugins: [{ name: 'isolated-markdown-source', setup(builder) {
      builder.onLoad({ filter: /packages[\\/]chat-ui[\\/]src[\\/]content[\\/]Markdown\.tsx$/ }, async () => ({
        contents: await readFile(path.join(temporary, variant === 'baseline' ? 'Markdown.HEAD.tsx' : 'Markdown.current.tsx'), 'utf8'),
        loader: 'tsx', resolveDir: path.dirname(sourcePath),
      }));
    } }],
  });
}
const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');
  const filename = path.basename(url.pathname);
  response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'none'; img-src 'none'");
  if (filename === 'baseline' || filename === 'current') {
    response.setHeader('Content-Type', 'text/html');
    response.end(`<!doctype html><html data-theme="dark"><meta charset="utf-8"><link rel="stylesheet" href="/theme.css"><style>body{margin:0;background:var(--surface)}#root{width:640px;margin:0 auto;padding:16px}</style><div id="root" class="agent-chat-ui" data-theme="dark"></div><script src="/${filename}.js"></script></html>`);
    return;
  }
  try {
    response.setHeader('Content-Type', filename.endsWith('.js') ? 'text/javascript' : filename.endsWith('.css') ? 'text/css' : 'font/woff2');
    response.end(await readFile(path.join(site, filename)));
  } catch { response.writeHead(404).end(); }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const chrome = spawn(chromePath, ['--headless=new', `--user-data-dir=${path.join(temporary, 'profile')}`,
  '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
  '--disable-component-update', '--disable-sync', '--disable-extensions', '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
  '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1', 'about:blank'],
{ windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
const endpoint = await new Promise((resolve, reject) => {
  let stderr = '';
  chrome.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
    const match = /DevTools listening on (ws:\/\/[^\s]+)/u.exec(stderr);
    if (match) resolve(match[1]);
  });
  chrome.once('error', reject);
  chrome.once('exit', (code) => reject(new Error(`Dedicated Chrome exited: ${code}`)));
});
const socket = new WebSocket(endpoint);
await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
let sequence = 0;
const pending = new Map();
const failures = [];
socket.addEventListener('message', ({ data }) => {
  const message = JSON.parse(data);
  if (message.id) {
    const waiter = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) waiter?.reject(new Error(message.error.message));
    else waiter?.resolve(message.result);
  }
  if (message.method === 'Runtime.exceptionThrown') failures.push(message.params.exceptionDetails.text);
});
function command(method, params = {}, sessionId) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
}
const results = [];
try {
  metadata.browser = await command('Browser.getVersion');
  console.log(JSON.stringify({ metadata }));
  async function measure(variant, bytes, mode, repetition) {
    const { targetId } = await command('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await command('Target.attachToTarget', { targetId, flatten: true });
    await command('Runtime.enable', {}, sessionId);
    await command('Emulation.setDeviceMetricsOverride', { ...metadata.viewport, deviceScaleFactor: 1, mobile: false }, sessionId);
    await command('Page.navigate', { url: `${origin}/${variant}` }, sessionId);
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const check = await command('Runtime.evaluate', { expression: 'typeof window.runMarkdownBenchmark === "function"', returnByValue: true }, sessionId);
      if (check.result.value) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
      if (attempt === 99) throw new Error('Local benchmark page failed to become ready');
    }
    const evaluated = await command('Runtime.evaluate', { expression: `window.runMarkdownBenchmark(${bytes}, ${JSON.stringify(mode)})`, awaitPromise: true, returnByValue: true }, sessionId);
    if (evaluated.exceptionDetails) throw new Error(evaluated.exceptionDetails.text);
    const { rawHtml, ...measurement } = evaluated.result.value;
    await writeFile(path.join(temporary, `${variant}-${bytes}-${mode}-${repetition}.html`), rawHtml);
    const result = { variant, repetition, ...measurement };
    results.push(result);
    console.log(JSON.stringify(result));
    await command('Target.closeTarget', { targetId });
  }
  for (const bytes of sizes) {
    for (const variant of ['baseline', 'current']) await measure(variant, bytes, 'static', 0);
    for (let repetition = 1; repetition <= runs; repetition += 1) {
      const variants = repetition % 2 === 1 ? ['baseline', 'current'] : ['current', 'baseline'];
      for (const variant of variants) await measure(variant, bytes, 'stream', repetition);
    }
  }
  for (const result of results) {
    const reference = results.find((candidate) => candidate.variant === 'baseline' && candidate.bytes === result.bytes && candidate.mode === 'static');
    result.matchesStatic = result.complete && result.content.textHash === reference.content.textHash &&
      result.content.comparisonHtmlHash === reference.content.comparisonHtmlHash && result.content.nodes === reference.content.nodes;
  }
  const report = { metadata, results, failures, allComplete: results.every((result) => result.matchesStatic) };
  await writeFile(path.join(temporary, 'results.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ report: path.join(temporary, 'results.json'), allComplete: report.allComplete, failures }));
  if (!report.allComplete || failures.length > 0) process.exitCode = 1;
} finally {
  await command('Browser.close').catch(() => {});
  socket.close();
  await new Promise((resolve) => server.close(resolve));
}
