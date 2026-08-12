import { describe, expect, it } from 'vitest';

import {
  buildPreviewShellHtml,
  injectPrototypeCsp,
  MAX_PREVIEW_SOURCE_BYTES,
  PREVIEW_CONTENT_CSP,
  PREVIEW_IFRAME_SANDBOX,
} from './previewHtml';

const CSP_META = `<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CONTENT_CSP}">`;

function shellFor(html: string): string {
  return buildPreviewShellHtml({
    fileName: 'proto.html',
    relativePath: 'demo/proto.html',
    content: { kind: 'document', html },
  });
}

describe('PREVIEW_CONTENT_CSP', () => {
  it('grants inline execution but no network or embedding surface', () => {
    expect(PREVIEW_CONTENT_CSP).toContain("default-src 'none'");
    expect(PREVIEW_CONTENT_CSP).toContain(
      "script-src 'unsafe-inline' 'unsafe-eval'",
    );
    expect(PREVIEW_CONTENT_CSP).toContain("connect-src 'none'");
    expect(PREVIEW_CONTENT_CSP).toContain("frame-src 'none'");
    expect(PREVIEW_CONTENT_CSP).toContain("worker-src 'none'");
    expect(PREVIEW_CONTENT_CSP).toContain("object-src 'none'");
    expect(PREVIEW_CONTENT_CSP).toContain("form-action 'none'");
    expect(PREVIEW_CONTENT_CSP).toContain("base-uri 'none'");
    // No host source anywhere: img/font/media allow only data:/blob:,
    // so nothing in the prototype can reach the network.
    expect(PREVIEW_CONTENT_CSP).not.toMatch(/https?:/);
    expect(PREVIEW_CONTENT_CSP).not.toContain('*');
    // A nonce would make browsers ignore 'unsafe-inline', killing the
    // prototype's inherited inline scripts.
    expect(PREVIEW_CONTENT_CSP).not.toContain('nonce');
  });
});

describe('injectPrototypeCsp', () => {
  it('injects immediately after <head>', () => {
    const result = injectPrototypeCsp(
      '<!doctype html><html><head><script>x()</script></head></html>',
    );
    expect(result).toContain(`<head>${CSP_META}<script>`);
  });

  it('injects after an attributed <head> case-insensitively', () => {
    const result = injectPrototypeCsp(
      '<HEAD data-x="1"><meta charset="utf-8"></HEAD>',
    );
    expect(result.indexOf(CSP_META)).toBe('<HEAD data-x="1">'.length);
  });

  it('falls back to <html>, doctype, then prepending', () => {
    expect(injectPrototypeCsp('<html lang="en"><script>x()</script>')).toContain(
      `<html lang="en">${CSP_META}<script>`,
    );
    expect(injectPrototypeCsp('<!DOCTYPE html><script>x()</script>')).toContain(
      `<!DOCTYPE html>${CSP_META}<script>`,
    );
    expect(injectPrototypeCsp('<script>x()</script>')).toBe(
      `${CSP_META}<script>x()</script>`,
    );
  });

  it('does not mistake <header> for <head>', () => {
    const result = injectPrototypeCsp('<header>hi</header>');
    expect(result).toBe(`${CSP_META}<header>hi</header>`);
  });

  it('always lands before the first script', () => {
    for (const html of [
      '<!doctype html><html><head><script>a()</script></head></html>',
      '<html><script>a()</script></html>',
      '<!doctype html><script>a()</script>',
      'hello<script>a()</script>',
    ]) {
      const result = injectPrototypeCsp(html);
      expect(result.indexOf(CSP_META)).toBeGreaterThanOrEqual(0);
      expect(result.indexOf(CSP_META)).toBeLessThan(
        result.indexOf('<script>'),
      );
    }
  });

  it('keeps a prototype-supplied CSP alongside the injected one', () => {
    const own =
      '<head><meta http-equiv="Content-Security-Policy" content="script-src *"></head>';
    const result = injectPrototypeCsp(own);
    expect(result).toContain(CSP_META);
    expect(result).toContain('content="script-src *"');
  });
});

describe('buildPreviewShellHtml', () => {
  it('applies the strict CSP to the shell document itself', () => {
    const shell = shellFor('<p>hi</p>');
    expect(shell).toContain(`content="${PREVIEW_CONTENT_CSP}"`);
  });

  it('sandboxes the prototype without allow-same-origin', () => {
    const shell = shellFor('<p>hi</p>');
    expect(PREVIEW_IFRAME_SANDBOX).toBe('allow-scripts');
    expect(shell).toContain('sandbox="allow-scripts"');
    expect(shell).not.toContain('allow-same-origin');
    expect(shell).not.toContain('allow-popups');
    expect(shell).not.toContain('allow-top-navigation');
    expect(shell).not.toContain('allow-forms');
    expect(shell).not.toContain('allow-modals');
  });

  it('registers no window message listener for the child to reach', () => {
    const shell = shellFor('<p>hi</p>');
    expect(shell).not.toContain("addEventListener('message'");
    expect(shell).not.toContain('addEventListener("message"');
    expect(shell).not.toContain('onmessage');
  });

  it('posts exactly the two fixed toolbar commands', () => {
    const shell = shellFor('<p>hi</p>');
    expect(shell).toContain("postMessage({ type: 'preview.reload' })");
    expect(shell).toContain(
      "postMessage({ type: 'preview.openInEditor' })",
    );
    expect(shell).toContain('>Reload<');
    expect(shell).toContain('>Open in editor<');
  });

  it('escapes prototype content so it cannot break out of srcdoc', () => {
    const hostile = '"><script>window.parent.steal()</script>';
    const shell = shellFor(hostile);
    expect(shell).not.toContain(hostile);
    expect(shell).toContain(
      '&quot;&gt;&lt;script&gt;window.parent.steal()&lt;/script&gt;',
    );
    // The shell contains exactly the template's own quote-delimited
    // srcdoc attribute; hostile content adds no second one.
    expect(shell.match(/srcdoc="/g)).toHaveLength(1);
  });

  it('injects the meta CSP into the inlined prototype', () => {
    const shell = shellFor('<head><script>x()</script></head>');
    expect(shell).toContain(
      escapeForAttribute(`<head>${CSP_META}<script>`),
    );
  });

  it('escapes file name and path interpolations', () => {
    const shell = buildPreviewShellHtml({
      fileName: '<img src=x onerror=alert(1)>.html',
      relativePath: 'a"b/<x>.html',
      content: { kind: 'document', html: '<p>hi</p>' },
    });
    expect(shell).not.toContain('<img src=x');
    expect(shell).toContain('&lt;img src=x onerror=alert(1)&gt;.html');
    expect(shell).toContain('a&quot;b/&lt;x&gt;.html');
  });

  it('renders a plain notice without an iframe when asked', () => {
    const shell = buildPreviewShellHtml({
      fileName: 'proto.html',
      relativePath: 'demo/proto.html',
      content: {
        kind: 'notice',
        message: 'demo/proto.html was deleted <now>.',
      },
    });
    expect(shell).not.toContain('<iframe');
    expect(shell).toContain('demo/proto.html was deleted &lt;now&gt;.');
    expect(shell).toContain('>Reload<');
  });

  it('caps prototypes at 4 MB', () => {
    expect(MAX_PREVIEW_SOURCE_BYTES).toBe(4 * 1024 * 1024);
  });
});

function escapeForAttribute(value: string): string {
  return value.replace(/[&"'<>]/g, (character) => {
    switch (character) {
      case '&':
        return '&amp;';
      case '"':
        return '&quot;';
      case "'":
        return '&#39;';
      case '<':
        return '&lt;';
      default:
        return '&gt;';
    }
  });
}
