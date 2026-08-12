// Computed-style audit for dist/webview/webview.css. Serves a probe
// page with the built stylesheet, walks every CSSOM declaration, and
// resolves each value (including var() references, against a
// .dvx-shell scope) through a probe element so colors and token
// indirection normalize to computed values.
//
// Output (stdout, JSON):
//   { tokens: { "--dvx-*": rawValue }, decls: [[selector, prop, resolved]] }
//
// Refactor gate usage: capture before and after a token-consolidation
// edit; `decls` must be deep-equal (order-sensitive), `tokens` may
// only differ by an explicitly whitelisted set of additions/removals.
// Follows the repo's headless-Chrome-CDP harness convention
// (artifacts/eval-page.mjs).
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const DEBUG_PORT = 9366;
const HTTP_PORT = 4187;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const auditPage = `<!doctype html>
<html><head><meta charset="utf-8">
<link rel="stylesheet" href="/dist/webview/webview.css">
</head><body>
<div class="dvx-shell"><div id="dvx-audit-probe"></div></div>
</body></html>`;

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
};
const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost');
  if (url.pathname === '/__audit') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(auditPage);
    return;
  }
  const file = path.resolve(root, decodeURIComponent(url.pathname).replace(/^\/+/, ''));
  try {
    const body = await readFile(file);
    response.writeHead(200, {
      'content-type': types[path.extname(file)] ?? 'application/octet-stream',
    });
    response.end(body);
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(HTTP_PORT, '127.0.0.1', resolve));

const profile = mkdtempSync(path.join(tmpdir(), 'dvx-style-audit-'));
const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${DEBUG_PORT}`,
  `--user-data-dir=${profile}`,
  '--no-first-run',
  '--disable-extensions',
  '--window-size=760,860',
  'about:blank',
], { stdio: 'ignore' });

async function endpoint() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
      return (await response.json()).webSocketDebuggerUrl;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  throw new Error('no devtools endpoint');
}

let id = 0;
function rpcFor(socket) {
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id !== undefined && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    }
  });
  return (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      id += 1;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params, sessionId }));
    });
}

const collect = `
  const probe = document.getElementById('dvx-audit-probe');
  const out = { tokens: {}, decls: [] };
  const walk = (rules, ctx) => {
    for (const rule of rules) {
      if (rule.cssRules && rule.cssRules.length) {
        const label = rule.media ? '@media ' + rule.media.mediaText
          : rule.name ? '@keyframes ' + rule.name
          : rule.cssText.split('{')[0].trim();
        walk(rule.cssRules, ctx + label + ' > ');
        continue;
      }
      if (!rule.style) continue;
      const sel = ctx + (rule.selectorText ?? rule.keyText ?? '?');
      // Apply the whole declaration block to the probe, then read each
      // enumerated longhand from the COMPUTED style so var()
      // references (including pending-substitution shorthands, whose
      // longhands enumerate with an empty raw value) resolve against
      // the .dvx-shell token scope.
      probe.style.cssText = rule.style.cssText;
      const computed = getComputedStyle(probe);
      for (let i = 0; i < rule.style.length; i += 1) {
        const prop = rule.style[i];
        if (prop.startsWith('--')) {
          out.tokens[prop] = rule.style.getPropertyValue(prop).trim();
          continue;
        }
        const resolved = computed.getPropertyValue(prop);
        out.decls.push([
          sel,
          prop,
          resolved === '' ? rule.style.getPropertyValue(prop).trim() : resolved,
        ]);
      }
      probe.style.cssText = '';
    }
  };
  for (const sheet of document.styleSheets) walk(sheet.cssRules, '');
  return out;
`;

try {
  const socket = new WebSocket(await endpoint());
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve);
    socket.addEventListener('error', reject);
  });
  const rpc = rpcFor(socket);
  const { targetInfos } = await rpc('Target.getTargets');
  const page = targetInfos.find((target) => target.type === 'page');
  const { sessionId } = await rpc('Target.attachToTarget', {
    targetId: page.targetId,
    flatten: true,
  });
  await rpc('Runtime.enable', {}, sessionId);
  await rpc('Page.navigate', { url: `http://127.0.0.1:${HTTP_PORT}/__audit` }, sessionId);
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const { result } = await rpc('Runtime.evaluate', {
      expression: '!!document.getElementById("dvx-audit-probe") && document.styleSheets.length > 0',
      returnByValue: true,
    }, sessionId);
    if (result.value) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  const { result, exceptionDetails } = await rpc('Runtime.evaluate', {
    expression: `(() => { ${collect} })()`,
    returnByValue: true,
  }, sessionId);
  if (exceptionDetails) {
    throw new Error(exceptionDetails.exception?.description ?? 'audit eval failed');
  }
  console.log(JSON.stringify(result.value, null, 1));
  socket.close();
} finally {
  chrome.kill();
  server.close();
  setTimeout(() => rmSync(profile, { recursive: true, force: true }), 500);
}
