// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';

import {
  createMermaidScript,
  renderMermaid,
  reapplyInlineStyles,
  splitSvgStyles,
} from './mermaidRenderer';

afterEach(() => {
  document.head.replaceChildren();
  document.body.replaceChildren();
});

function appendScript(src: string, nonce?: string): HTMLScriptElement {
  const script = document.createElement('script');
  script.src = src;
  if (nonce !== undefined) {
    script.setAttribute('nonce', nonce);
  }
  document.body.append(script);
  return script;
}

describe('createMermaidScript', () => {
  it.each(['webview.js', 'session-viewer.js'])('derives the sibling bundle URL from %s', (filename) => {
    appendScript('https://resource.test/ext/dist/webview/other.js');
    appendScript(`https://resource.test/ext/dist/webview/${filename}`, 'n0nce-123');
    const script = createMermaidScript(document);
    expect(script).not.toBeNull();
    expect(script?.src).toBe('https://resource.test/ext/dist/webview/mermaid.js');
    expect(script?.nonce).toBe('n0nce-123');
  });

  it('propagates the page nonce so the CSP admits the script', () => {
    appendScript('https://resource.test/ext/dist/webview/webview.js', 'n0nce-123');
    const script = createMermaidScript(document);
    expect(script?.nonce).toBe('n0nce-123');
  });

  it('returns null when the main bundle script is absent', () => {
    appendScript('https://resource.test/ext/dist/webview/notwebview.js');
    expect(createMermaidScript(document)).toBeNull();
  });
});

describe('splitSvgStyles', () => {
  it('extracts every style block and strips it from the SVG', () => {
    const svg =
      '<svg id="d1"><style>#d1 .node{fill:#f7f5f1;}</style>' +
      '<g class="node"/><style>#d1 .edge{stroke:#8f867c;}</style></svg>';
    const result = splitSvgStyles(svg);
    expect(result.svg).toBe('<svg id="d1"><g class="node"/></svg>');
    expect(result.css).toBe('#d1 .node{fill:#f7f5f1;}\n#d1 .edge{stroke:#8f867c;}');
  });

  it('passes SVG without styles through unchanged', () => {
    const svg = '<svg id="d2"><g/></svg>';
    expect(splitSvgStyles(svg)).toEqual({ svg, css: '' });
  });
});

describe('reapplyInlineStyles', () => {
  it('writes style attributes back through the CSSOM', () => {
    // jsdom keeps the style attribute and the CSSOM synced, so the
    // CSP divergence (attribute present, CSSOM empty) cannot be
    // reproduced here; the CSP harness smoke covers that. This test
    // pins the copy loop itself via a spied cssText setter.
    const host = document.createElement('div');
    host.innerHTML = '<svg><rect style="fill: red;"></rect><g></g></svg>';
    const rect = host.querySelector('rect');
    expect(rect).not.toBeNull();
    const assigned: string[] = [];
    Object.defineProperty(rect!.style, 'cssText', {
      set: (value: string) => {
        assigned.push(value);
      },
    });
    reapplyInlineStyles(host);
    expect(assigned).toEqual(['fill: red;']);
  });
});

describe('renderMermaid', () => {
  it('falls back quietly when the lazy bundle cannot be located', async () => {
    // No webview.js script exists in this document, so the loader
    // cannot resolve a bundle URL; the outcome must be a quiet failure.
    await expect(renderMermaid('graph TD; A-->B')).resolves.toEqual({
      ok: false,
    });
  });
});
