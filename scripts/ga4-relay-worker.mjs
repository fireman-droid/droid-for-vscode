/**
 * Droid for VS Code — Cloudflare Worker GA4 转发脚本
 *
 * 部署用法（无需本地命令行，直接在 Cloudflare 网页后台粘贴）：
 * 1. 登录 https://dash.cloudflare.com -> 左侧「计算 (Workers & Pages)」->「创建」->「创建 Worker」，名字填例如 droid-ga4，点击部署。
 * 2. 点击右上角「编辑代码 (Edit code)」，将本文件全部内容复制粘贴进去，替换原有的 worker.js，点击右上角「部署 (Deploy)」。
 * 3. 回到该 Worker 的「设置 (Settings)」->「变量和机密 (Variables and Secrets)」，添加两个变量：
 *    - GA4_MEASUREMENT_ID : 填你在 Google Analytics 拿到的 G-XXXXXXXXXX
 *    - GA4_API_SECRET     : 填你在 Google Analytics 数据流详情下创建的 Measurement Protocol API 密钥
 * 4. 在浏览器打开你的 Worker 地址（或绑定的自定义域名），若显示 {"ok":true,"service":"droid-ga4-relay","configured":true} 即表示配置成功。
 */

const ALLOWED_EVENTS = new Set([
  'extension_activated',
  'frontend_ready',
  'frontend_error',
  'frontend_longtask',
  'activity_expand',
]);

const ALLOWED_PARAM_KEYS = new Set([
  'session_id',
  'engagement_time_msec',
  'editor',
  'platform',
  'arch',
  'locale',
  'ext_version',
  'surface',
  'category',
  'duration_ms',
  'records',
  'task_count',
  'total_ms',
  'max_ms',
]);

const SAFE_CLIENT_ID = /^[a-zA-Z0-9._-]{8,64}$/u;
const SAFE_STRING_VALUE = /^[a-zA-Z0-9._-]{1,32}$/u;

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
    },
  });
}

export function sanitizeGa4RelayPayload(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const clientId = typeof input.client_id === 'string' ? input.client_id.trim() : '';
  if (!SAFE_CLIENT_ID.test(clientId)) return null;
  if (!Array.isArray(input.events) || input.events.length === 0 || input.events.length > 10) return null;

  const events = [];
  for (const rawEvent of input.events) {
    if (!rawEvent || typeof rawEvent !== 'object' || Array.isArray(rawEvent)) return null;
    if (typeof rawEvent.name !== 'string' || !ALLOWED_EVENTS.has(rawEvent.name)) return null;
    const rawParams = rawEvent.params;
    if (!rawParams || typeof rawParams !== 'object' || Array.isArray(rawParams)) return null;

    const params = {};
    for (const [key, value] of Object.entries(rawParams)) {
      if (!ALLOWED_PARAM_KEYS.has(key)) continue;
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 86_400_000) {
        params[key] = Math.round(value);
      } else if (typeof value === 'string' && SAFE_STRING_VALUE.test(value)) {
        params[key] = value;
      }
    }
    events.push({ name: rawEvent.name, params });
  }

  return { client_id: clientId, events };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'GET, POST, OPTIONS',
          'access-control-allow-headers': 'content-type',
        },
      });
    }

    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {
      return jsonResponse({
        ok: true,
        service: 'droid-ga4-relay',
        configured: Boolean(env?.GA4_MEASUREMENT_ID && env?.GA4_API_SECRET),
      });
    }

    if (request.method !== 'POST' || (url.pathname !== '/' && url.pathname !== '/collect')) {
      return jsonResponse({ ok: false, error: 'not_found' }, 404);
    }

    const measurementId = env?.GA4_MEASUREMENT_ID?.trim();
    const apiSecret = env?.GA4_API_SECRET?.trim();
    if (!measurementId || !apiSecret) {
      return jsonResponse({ ok: false, error: 'missing_ga4_credentials' }, 503);
    }

    let rawBody;
    try {
      rawBody = await request.json();
    } catch {
      return jsonResponse({ ok: false, error: 'invalid_json' }, 400);
    }

    const payload = sanitizeGa4RelayPayload(rawBody);
    if (!payload) {
      return jsonResponse({ ok: false, error: 'invalid_payload' }, 400);
    }

    const debug = url.searchParams.get('debug') === '1';
    const ga4Endpoint = debug
      ? 'https://www.google-analytics.com/debug/mp/collect'
      : 'https://www.google-analytics.com/mp/collect';
    const target = `${ga4Endpoint}?measurement_id=${encodeURIComponent(measurementId)}&api_secret=${encodeURIComponent(apiSecret)}`;

    const forwardPromise = fetch(target, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (debug) {
      const response = await forwardPromise;
      const validation = await response.json().catch(() => null);
      return jsonResponse({ ok: response.ok, status: response.status, validation, forwarded: payload });
    }

    if (ctx && typeof ctx.waitUntil === 'function') {
      ctx.waitUntil(forwardPromise.catch(() => undefined));
      return new Response(null, { status: 204, headers: { 'access-control-allow-origin': '*' } });
    }

    await forwardPromise.catch(() => undefined);
    return new Response(null, { status: 204, headers: { 'access-control-allow-origin': '*' } });
  },
};
