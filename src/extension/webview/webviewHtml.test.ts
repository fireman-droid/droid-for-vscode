import { describe, expect, it } from 'vitest';

import { getWebviewHtml } from './webviewHtml';

const nonce = 'fixed_test_nonce';
const webview = {
  cspSource: 'vscode-webview://test-source',
  asWebviewUri(uri: { toString(): string }) {
    return {
      toString: () => `vscode-webview://test/${uri.toString()}`,
    };
  },
};
const assets = {
  script: {
    toString: () => 'dist/webview/webview.js',
  },
  style: {
    toString: () => 'dist/webview/webview.css',
  },
};

describe('getWebviewHtml', () => {
  it('loads only the local bundled assets under a restrictive CSP', () => {
    const html = getWebviewHtml(webview, assets, nonce);
    const scriptTags = [...html.matchAll(/<script\b[^>]*>/g)].map(([tag]) => tag);
    const styleLinks = [...html.matchAll(/<link\b[^>]*>/g)].map(([tag]) => tag);

    expect(html).toContain("default-src 'none'");
    expect(html).toContain(`script-src 'nonce-${nonce}'`);
    expect(html).toContain(`style-src vscode-webview://test-source 'nonce-${nonce}'`);
    expect(html).toContain('font-src vscode-webview://test-source');
    expect(html).toContain("connect-src 'none'");
    expect(html).not.toContain("'unsafe-inline'");
    expect(html).not.toContain("'unsafe-eval'");
    expect(html).not.toContain('command:');
    expect(html).not.toContain('http:');
    expect(html).not.toContain('https:');
    // Exactly two scripts: the inline boot beacon and the bundle, both
    // under the CSP nonce.
    expect(scriptTags).toHaveLength(2);
    expect(scriptTags.every((tag) => tag.includes(`nonce="${nonce}"`))).toBe(true);
    expect(scriptTags[1]).toContain(
      'src="vscode-webview://test/dist/webview/webview.js"',
    );
    expect(styleLinks).toHaveLength(1);
    expect(styleLinks[0]).toContain(
      'href="vscode-webview://test/dist/webview/webview.css"',
    );
    expect(html).toContain('<div id="root"></div>');
  });

  it('boots on the requested theme: first-frame background and attributes', () => {
    const light = getWebviewHtml(webview, assets, nonce, {
      preference: 'auto',
      resolved: 'light',
    });
    expect(light).toContain(
      'html,body{background:var(--vscode-sideBar-background,' +
        'var(--vscode-editor-background,#f8f8f8))}',
    );
    expect(light).toContain('data-dvx-theme="light"');
    expect(light).toContain('data-dvx-theme-preference="auto"');

    const dark = getWebviewHtml(webview, assets, nonce, {
      preference: 'dark',
      resolved: 'dark',
    });
    expect(dark).toContain('html,body{background:#181818}');
    expect(dark).toContain('data-dvx-theme="dark"');
    expect(dark).toContain('data-dvx-theme-preference="dark"');
    expect(dark).toContain('data-theme="dark"');
    expect(dark).toContain('data-theme-preference="dark"');
  });

  it('paints the shell background before the stylesheet loads', () => {
    const html = getWebviewHtml(webview, assets, nonce);
    const styleTags = [...html.matchAll(/<style\b[^>]*>[^<]*<\/style>/g)].map(
      ([tag]) => tag,
    );

    // Exactly one inline style, nonce'd for the CSP, that follows the
    // editor ground in Auto before the external stylesheet loads.
    expect(styleTags).toHaveLength(1);
    expect(styleTags[0]).toContain(`nonce="${nonce}"`);
    expect(styleTags[0]).toContain(
      'html,body{background:var(--vscode-sideBar-background,' +
        'var(--vscode-editor-background,#f8f8f8))}',
    );
    // The inline style comes before the external stylesheet.
    expect(html.indexOf('<style')).toBeLessThan(html.indexOf('<link rel="stylesheet"'));
  });

  it('leaves ready-handshake ownership with the React bundle', () => {
    const html = getWebviewHtml(webview, assets, nonce);

    // The boot beacon script only reports diagnostics; the protocol
    // handshake stays in the bundle.
    expect(html).not.toContain('webview.ready');
    expect(html).toContain('webview.diagnostic');
    expect(html).not.toContain('innerHTML');
    expect(html).not.toContain('outerHTML');
    expect(html).not.toContain('document.write');
  });

  it('rejects a nonce that could escape an HTML attribute', () => {
    expect(() => getWebviewHtml(webview, assets, 'bad"><script')).toThrow(
      'Webview nonce contains unsupported characters.',
    );
  });
});
