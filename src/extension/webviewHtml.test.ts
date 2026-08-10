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
    const scriptTags = [...html.matchAll(/<script\b[^>]*>/g)].map(
      ([tag]) => tag,
    );
    const styleLinks = [...html.matchAll(/<link\b[^>]*>/g)].map(
      ([tag]) => tag,
    );

    expect(html).toContain("default-src 'none'");
    expect(html).toContain(`script-src 'nonce-${nonce}'`);
    expect(html).toContain(
      'style-src vscode-webview://test-source',
    );
    expect(html).toContain("connect-src 'none'");
    expect(html).not.toContain("'unsafe-inline'");
    expect(html).not.toContain("'unsafe-eval'");
    expect(html).not.toContain('command:');
    expect(html).not.toContain('http:');
    expect(html).not.toContain('https:');
    expect(scriptTags).toHaveLength(1);
    expect(scriptTags.every((tag) => tag.includes(`nonce="${nonce}"`))).toBe(
      true,
    );
    expect(scriptTags[0]).toContain(
      'src="vscode-webview://test/dist/webview/webview.js"',
    );
    expect(styleLinks).toHaveLength(1);
    expect(styleLinks[0]).toContain(
      'href="vscode-webview://test/dist/webview/webview.css"',
    );
    expect(html).toContain('<div id="root"></div>');
  });

  it('leaves ready-handshake ownership with the React bundle', () => {
    const html = getWebviewHtml(webview, assets, nonce);

    expect(html).not.toContain('acquireVsCodeApi');
    expect(html).not.toContain('webview.ready');
    expect(html).not.toContain('droidvisx-bootstrap');
    expect(html).not.toContain('innerHTML');
    expect(html).not.toContain('outerHTML');
    expect(html).not.toContain('document.write');
  });

  it('rejects a nonce that could escape an HTML attribute', () => {
    expect(() =>
      getWebviewHtml(webview, assets, 'bad"><script'),
    ).toThrow('Webview nonce contains unsupported characters.');
  });
});
