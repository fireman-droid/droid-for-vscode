// Local synthetic acceptance for the production DiffView and Webview styles.
// Uses a separate headless Chrome profile; never connects to an existing window.
// Run: node scripts/benchmarkReview.mjs [--chrome=C:/path/chrome.exe]
import { build } from 'esbuild';
import { execFileSync, spawn } from 'node:child_process';
import { readFile, writeFile, mkdtemp, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire, SourceMap } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const chromePath = process.argv.find((value) => value.startsWith('--chrome='))?.slice(9) ?? path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe');
const temporary = await mkdtemp(path.join(tmpdir(), 'droidvisx-review-benchmark-'));
console.log(JSON.stringify({ temporary }));
const appOnly = process.argv.includes('--app-only');
const profileOnly = process.argv.includes('--profile-only');
const site = path.join(temporary, 'site');
await mkdir(site);
const tailwind = path.join(path.dirname(require.resolve('@tailwindcss/cli/package.json')), 'dist/index.mjs');
execFileSync(process.execPath, [tailwind, '-i', path.join(repository, 'src/webview-v2/theme.css'), '-o', path.join(temporary, 'theme.css'), '--minify'], { cwd: repository, stdio: 'pipe' });
await build({ entryPoints: [path.join(temporary, 'theme.css')], outfile: path.join(site, 'theme.css'), bundle: true, minify: true,
  loader: { '.woff2': 'file', '.woff': 'file', '.ttf': 'file' }, plugins: [{ name: 'local-katex-fonts', setup(builder) {
    builder.onResolve({ filter: /(?:fonts[\\/])?KaTeX_[\w-]+\.(?:woff2?|ttf)$/ }, (args) => ({
      path: path.join(path.dirname(require.resolve('katex/dist/katex.min.css')), 'fonts', path.basename(args.path)),
    }));
  } }], logLevel: 'silent' });
await build({ absWorkingDir: repository, entryPoints: ['src/webview-v2/dev/reviewBenchmark.tsx'], outfile: path.join(site, 'review.js'),
  alias: { '@droidvisx/chat-ui': path.join(repository, 'packages/chat-ui/src') },
  bundle: true, minify: true, sourcemap: 'external', platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' });
const server = createServer(async (request, response) => {
  const filename = path.basename(new URL(request.url, 'http://localhost').pathname);
  response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'none'; img-src 'none'");
  if (!filename) {
    response.setHeader('Content-Type', 'text/html');
    response.end(`<!doctype html><html data-theme="dark"><meta charset="utf-8"><style>code{background:#50515c;color:#60e5ec;padding:2px 4px;border-radius:3px;font-family:monospace}</style><link rel="stylesheet" href="/theme.css"><style>html,body,#root{height:100%;margin:0}</style><div id="root" class="agent-chat-ui" data-theme="dark"></div><script src="/review.js"></script></html>`);
    return;
  }
  try {
    response.setHeader('Content-Type', filename.endsWith('.js') ? 'text/javascript' : filename.endsWith('.css') ? 'text/css' : 'font/woff2');
    response.end(await readFile(path.join(site, filename)));
  } catch { response.writeHead(404).end(); }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const chrome = spawn(chromePath, ['--headless=new', `--user-data-dir=${path.join(temporary, 'profile')}`, '--remote-debugging-port=0',
  '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-extensions',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
  '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1', 'about:blank'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
const endpoint = await new Promise((resolve, reject) => {
  let stderr = '';
  const timer = setTimeout(() => reject(new Error('Dedicated Chrome did not expose CDP')), 15_000);
  chrome.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
    const match = /DevTools listening on (ws:\/\/[^\s]+)/u.exec(stderr);
    if (match) { clearTimeout(timer); resolve(match[1]); }
  });
  chrome.once('error', (error) => { clearTimeout(timer); reject(error); });
  chrome.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Dedicated Chrome exited: ${code}`)); });
});
const socket = new WebSocket(endpoint);
await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
let sequence = 0;
const pending = new Map();
const failures = [];
socket.addEventListener('message', ({ data }) => {
  const message = JSON.parse(data);
  if (message.id) {
    const waiter = pending.get(message.id); pending.delete(message.id);
    if (message.error) waiter?.reject(new Error(message.error.message)); else waiter?.resolve(message.result);
  }
  if (message.method === 'Runtime.exceptionThrown') failures.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
});
function command(method, params = {}, sessionId) {
  const id = ++sequence;
  return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); });
}
socket.addEventListener('close', () => { for (const waiter of pending.values()) waiter.reject(new Error('Dedicated Chrome connection closed')); pending.clear(); });
const results = [], screenshots = [];
try {
  const browser = await command('Browser.getVersion');
  const { targetId } = await command('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await command('Target.attachToTarget', { targetId, flatten: true });
  await command('Runtime.enable', {}, sessionId);
  await command('Page.enable', {}, sessionId);
  await command('Emulation.setDeviceMetricsOverride', { width: 1200, height: 850, deviceScaleFactor: 1, mobile: false }, sessionId);
  await command('Page.navigate', { url: origin }, sessionId);
  async function evaluate(expression) {
    const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  }
  for (let attempt = 0; !(await evaluate('typeof window.reviewBenchmark === "object"')); attempt++) {
    if (attempt > 100) throw new Error('Local Review benchmark did not become ready');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  await command('Runtime.addBinding', { name: '__reviewBenchmarkClick' }, sessionId);
  await evaluate(`(() => {
    let id = 0; const waiting = new Map();
    window.reviewBenchmarkClick = selector => new Promise((resolve, reject) => {
      const next = ++id; waiting.set(next, {resolve, reject});
      window.__reviewBenchmarkClick(JSON.stringify({id:next, selector}));
    });
    window.completeReviewBenchmarkClick = (id, error) => {
      const pending = waiting.get(id); waiting.delete(id);
      if(error) pending.reject(new Error(error)); else pending.resolve();
    };
  })()`);
  socket.addEventListener('message', async ({ data }) => {
    const message = JSON.parse(data);
    if (message.method !== 'Runtime.bindingCalled' || message.params.name !== '__reviewBenchmarkClick' || message.sessionId !== sessionId) return;
    const { id, selector } = JSON.parse(message.params.payload);
    let error;
    try {
      const point = await evaluate(`(() => { const element = document.querySelector(${JSON.stringify(selector)});
        if(!element) throw new Error('Click target missing: ' + ${JSON.stringify(selector)}); element.scrollIntoView({block:'nearest',inline:'nearest'});
        const rect = element.getBoundingClientRect(); return {x:rect.x+rect.width/2,y:rect.y+rect.height/2}; })()`);
      await command('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point }, sessionId);
      await command('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', buttons: 1, clickCount: 1 }, sessionId);
      await command('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', buttons: 0, clickCount: 1 }, sessionId);
    } catch (reason) { error = String(reason); }
    await evaluate(`window.completeReviewBenchmarkClick(${id}, ${JSON.stringify(error ?? null)})`);
  });
  const cases = [20_000, 50_000].flatMap((count) => [false, true].map((split) => ({ count, split, scattered: false })));
  cases.push(...[false, true].map((split) => ({ count: 50_000, split, scattered: true })));
  if (profileOnly) {
    const mount = await evaluate('window.reviewBenchmark.mount(50000, true, "dark", false, true)');
    const staticBaseline = await evaluate('window.reviewBenchmark.idle(false)');
    await command('Profiler.enable', {}, sessionId);
    await command('Profiler.setSamplingInterval', { interval: 1000 }, sessionId);
    await command('Profiler.start', {}, sessionId);
    const scrolling = await evaluate('window.reviewBenchmark.profileSweep()');
    const { profile } = await command('Profiler.stop', {}, sessionId);
    const emptyBaseline = await evaluate('window.reviewBenchmark.idle(true)');
    await evaluate('window.reviewBenchmark.mount(50000, true, "dark", false, true)');
    await command('Profiler.start', {}, sessionId);
    await evaluate('window.reviewBenchmark.startFrameMonitor()');
    for (let step = 0; step < 30; step++) {
      await command('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 350, y: 400, deltaX: 0, deltaY: 387 }, sessionId);
      await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    }
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    const nativeWheel = await evaluate('window.reviewBenchmark.stopFrameMonitor()');
    const { profile: wheelProfile } = await command('Profiler.stop', {}, sessionId);
    const sourceMap = new SourceMap(JSON.parse(await readFile(path.join(site, 'review.js.map'), 'utf8')));
    const summarizeProfile = (recording) => {
      const nodes = new Map(recording.nodes.map((node) => [node.id, node]));
      const times = new Map();
      for (const [index, nodeId] of recording.samples.entries()) times.set(nodeId, (times.get(nodeId) ?? 0) + (recording.timeDeltas[index] ?? 0));
      return [...times].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([id, microseconds]) => {
        const frame = nodes.get(id).callFrame;
        const source = frame.url.endsWith('/review.js') ? sourceMap.findEntry(frame.lineNumber, frame.columnNumber) : undefined;
        return { milliseconds: microseconds / 1000, function: frame.functionName, source: source?.originalSource ?? frame.url,
          line: source?.originalLine === undefined ? undefined : source.originalLine + 1, name: source?.name };
      });
    };
    const report = { mount, staticBaseline, scrolling, emptyBaseline, nativeWheel, hottest: summarizeProfile(profile), wheelHottest: summarizeProfile(wheelProfile) };
    await writeFile(path.join(temporary, 'profile.json'), JSON.stringify(profile));
    await writeFile(path.join(temporary, 'wheel-profile.json'), JSON.stringify(wheelProfile));
    await writeFile(path.join(temporary, 'profile-results.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ report: path.join(temporary, 'profile-results.json'), ...report }));
  }
  for (const { count, split, scattered } of appOnly || profileOnly ? [] : cases) {
    const mount = await evaluate(`window.reviewBenchmark.mount(${count}, ${split}, "dark", false, ${scattered})`);
    let gestures;
    if (split) {
      const offsets = () => evaluate(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(
        [...document.querySelectorAll('.review-split-scrollbar')].map(bar => bar.scrollLeft)))))`);
      await command('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 250, y: 250, deltaX: 180, deltaY: 0 }, sessionId);
      const wheelLeft = await offsets();
      await evaluate(`document.querySelector('.review-split-scrollbar').focus()`);
      await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 }, sessionId);
      await command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 }, sessionId);
      await evaluate('new Promise(resolve => setTimeout(resolve, 150))');
      const keyboard = await offsets();
      await command('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 850, y: 250, deltaX: 180, deltaY: 0 }, sessionId);
      const wheelRight = await offsets();
      await command('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 250, y: 250, deltaX: 0, deltaY: 180 }, sessionId);
      await offsets();
      const vertical = await evaluate('document.querySelector(".review-code-scroll").scrollTop');
      gestures = { wheelLeft, keyboard, wheelRight, vertical,
        passed: wheelLeft[0] > 0 && wheelLeft[1] === 0 && keyboard[0] > wheelLeft[0] && wheelRight[1] > 0 && vertical > 0 };
      await evaluate(`for(const bar of document.querySelectorAll('.review-split-scrollbar'))bar.scrollLeft=0;document.querySelector('.review-code-scroll').scrollTop=0`);
    }
    const sweep = await evaluate('window.reviewBenchmark.sweep()');
    const horizontal = await evaluate('window.reviewBenchmark.horizontal()');
    const result = { count, split, scattered, mount, gestures, sweep, horizontal };
    results.push(result); console.log(JSON.stringify(result));
  }
  for (const theme of appOnly || profileOnly ? [] : ['dark', 'light', 'auto']) for (const split of [false, true]) {
    await evaluate(`window.reviewBenchmark.mount(600, ${split}, ${JSON.stringify(theme)}, true)`);
    const colors = await evaluate('window.reviewBenchmark.colors()');
    const contrast = await evaluate('window.reviewBenchmark.contrast()');
    const { data } = await command('Page.captureScreenshot', { format: 'png' }, sessionId);
    const filename = path.join(temporary, `review-${theme}-${split ? 'split' : 'unified'}.png`);
    await writeFile(filename, Buffer.from(data, 'base64'));
    screenshots.push({ theme, split, filename, colors, contrast });
    console.log(JSON.stringify({ theme, split, minimumContrast: Math.min(...contrast.map((token) => token.ratio)), failingContrast: contrast.filter((token) => token.ratio < 4.5) }));
  }
  let wholeApp;
  try { wholeApp = profileOnly ? { skipped: true } : await evaluate('window.reviewBenchmark.runApp()'); }
  catch (error) { failures.push(String(error)); wholeApp = { passed: false, error: String(error), diagnostics: await evaluate(`({
    buttons:[...document.querySelectorAll('button')].map(button=>({label:button.getAttribute('aria-label')||button.textContent,expanded:button.getAttribute('aria-expanded'),state:button.dataset.state,disabled:button.disabled})),
    menus:[...document.querySelectorAll('[role="menu"]')].map(menu=>({html:menu.outerHTML,rectangle:menu.getBoundingClientRect().toJSON()}))
  })`) }; }
  console.log(JSON.stringify({ wholeApp }));
  const { data: appImage } = await command('Page.captureScreenshot', { format: 'png' }, sessionId);
  await writeFile(path.join(temporary, 'review-whole-app.png'), Buffer.from(appImage, 'base64'));
  const passed = profileOnly ? null : failures.length === 0 && screenshots.every((shot) => shot.contrast.every((token) => token.ratio >= 4.5)) && results.every((result) => (!result.gestures || result.gestures.passed) && result.sweep.stableScrollHeight && result.sweep.headerSticky && result.sweep.maxMountedLines <= 512 &&
    result.sweep.points.every((point) => point.reachable) && result.horizontal.results.every((tail) => tail.reachable));
  const report = { browser, appOnly, profileOnly, results, screenshots, wholeApp, failures, passed };
  await writeFile(path.join(temporary, 'results.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ report: path.join(temporary, 'results.json'), passed, failures, screenshots: screenshots.map((item) => item.filename) }));
  if (passed === false) process.exitCode = 1;
} finally {
  await command('Browser.close').catch(() => {});
  socket.close();
  await new Promise((resolve) => server.close(resolve));
}
