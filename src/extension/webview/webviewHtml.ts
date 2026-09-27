import { randomBytes } from 'node:crypto';

import { type ThemePreference } from '../../shared/protocol/shell';

export interface WebviewSecurityContext {
  readonly cspSource: string;
  asWebviewUri(uri: WebviewResourceUri): WebviewResourceUri;
}

export interface WebviewResourceUri {
  toString(): string;
}

export interface WebviewAssets {
  readonly script: WebviewResourceUri;
  readonly style: WebviewResourceUri;
}

/**
 * Painted by an inline nonce'd style before the external stylesheet
 * and React load, so the panel never flashes white. Explicit themes
 * use the fixed Droid grounds; Auto uses the editor's injected
 * CSS variable from the first frame.
 */
const INITIAL_BACKGROUNDS = {
  light: '#f8f8f8',
  dark: '#181818',
} as const;

const AUTO_INITIAL_BACKGROUND =
  'var(--vscode-sideBar-background,var(--vscode-editor-background,#f8f8f8))';

export type WebviewInitialTheme = keyof typeof INITIAL_BACKGROUNDS;

/**
 * Theme the HTML boots with: `resolved` paints the first frame (the
 * host already mapped 'auto' to the editor's theme kind), while
 * `preference` seeds the shell's own theme state so it does not
 * misresolve before the first `ui.theme` push arrives. Both values
 * are closed enums, so interpolating them into attributes is safe.
 */
export interface WebviewBootTheme {
  readonly preference: ThemePreference;
  readonly resolved: WebviewInitialTheme;
}

const DEFAULT_BOOT_THEME: WebviewBootTheme = {
  preference: 'auto',
  resolved: 'light',
};

export function getWebviewHtml(
  webview: WebviewSecurityContext,
  assets: WebviewAssets,
  nonce = createNonce(),
  theme: WebviewBootTheme = DEFAULT_BOOT_THEME,
): string {
  if (!/^[A-Za-z0-9_-]+$/.test(nonce)) {
    throw new Error('Webview nonce contains unsupported characters.');
  }

  const scriptUri = escapeHtmlAttribute(webview.asWebviewUri(assets.script).toString());
  const styleUri = escapeHtmlAttribute(webview.asWebviewUri(assets.style).toString());
  const initialBackground =
    theme.preference === 'auto'
      ? AUTO_INITIAL_BACKGROUND
      : INITIAL_BACKGROUNDS[theme.resolved];

  // The data-dvx-theme attribute lets the stylesheet's page-ground
  // rules apply from the first styled frame (before React mounts and
  // takes over the attribute); the inline style covers the window
  // between HTML parse and stylesheet load.
  return /* html */ `<!doctype html>
<html lang="en" data-dvx-theme="${theme.resolved}" data-dvx-theme-preference="${theme.preference}" data-theme="${theme.resolved}" data-theme-preference="${theme.preference}">
<head>
  <meta charset="UTF-8">
  <meta
    http-equiv="Content-Security-Policy"
    content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}'; worker-src blob:; font-src ${webview.cspSource}; connect-src 'none';"
  >
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Droid</title>
  <style nonce="${nonce}">html,body{background:${initialBackground}}</style>
  <link rel="stylesheet" href="${styleUri}">
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}">${BOOT_BEACON_SCRIPT}</script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

/**
 * Runs before the bundle so a broken webview reports what failed instead
 * of staying blank: resource load failures, uncaught errors, unhandled
 * rejections, and a 10s boot watchdog all post bounded
 * `webview.diagnostic` beacons to the host, and the watchdog paints a
 * plain-text fallback. The script is a static string with no
 * interpolation, so it introduces no injection surface beyond the nonce
 * already required by the CSP. It also acquires the VS Code API exactly
 * once and shares it with the bundle via `window.__dvxApi`.
 */
const BOOT_BEACON_SCRIPT = /* js */ `
(function () {
  var api = acquireVsCodeApi();
  window.__dvxApi = api;
  var post = function (kind, detail) {
    try {
      api.postMessage({
        type: 'webview.diagnostic',
        kind: kind,
        detail: String(detail).slice(0, 2048)
      });
    } catch (postError) {}
  };
  window.__dvxBeacon = post;
  window.addEventListener('error', function (event) {
    var target = event.target;
    if (target && target !== window && target.tagName) {
      post('error', 'resource failed: ' + target.tagName + ' ' +
        (target.src || target.href || ''));
      return;
    }
    post('error', (event.message || 'unknown error') + ' @' +
      (event.filename || '?') + ':' + (event.lineno || 0));
  }, true);
  window.addEventListener('unhandledrejection', function (event) {
    var reason = event.reason;
    post('unhandledrejection',
      reason && reason.stack ? reason.stack : String(reason));
  });
  setTimeout(function () {
    if (window.__dvxBooted) { return; }
    post('boot-timeout', 'bundle did not mount within 10s');
    var root = document.getElementById('root');
    if (root && !root.firstChild) {
      root.style.cssText =
        'padding:16px;font-family:sans-serif;font-size:13px;';
      root.textContent = 'Droid failed to start. Fully quit and ' +
        'restart Cursor, then check the "Droid Logs" output channel.';
    }
  }, 10000);
})();
`;

function createNonce(): string {
  return randomBytes(24).toString('base64url');
}

function escapeHtmlAttribute(value: string): string {
  return value.replace(/[&"<>]/g, (character) => {
    switch (character) {
      case '&':
        return '&amp;';
      case '"':
        return '&quot;';
      case '<':
        return '&lt;';
      default:
        return '&gt;';
    }
  });
}
