import { CANVAS_SHELL_SCRIPT } from './canvasShellScript';
import { CANVAS_SHELL_STYLE } from './canvasShellStyle';

/** Largest prototype source the panel will inline, in bytes. */
export const MAX_PREVIEW_SOURCE_BYTES = 4 * 1024 * 1024;

/** The child remains opaque-origin. Never add `allow-same-origin`. */
export const PREVIEW_IFRAME_SANDBOX = 'allow-scripts';

export const PREVIEW_CONTENT_CSP =
  "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; " +
  "style-src 'unsafe-inline'; img-src data: blob:; font-src data:; " +
  "media-src data: blob:; connect-src 'none'; frame-src 'none'; " +
  "child-src 'none'; worker-src 'none'; object-src 'none'; " +
  "form-action 'none'; base-uri 'none'";

const CSP_META_TAG =
  '<meta http-equiv="Content-Security-Policy" ' + `content="${PREVIEW_CONTENT_CSP}">`;

export type PreviewShellContent =
  | { readonly kind: 'document'; readonly html: string }
  | { readonly kind: 'notice'; readonly message: string };

export interface PreviewShellOptions {
  readonly fileName: string;
  readonly relativePath: string;
  readonly content: PreviewShellContent;
  readonly source?: 'file' | 'inline';
  readonly displaySource?: string;
  readonly generation?: number;
  readonly revision?: number;
  readonly baseline?: string;
  readonly baselineTruncated?: boolean;
  readonly sourceTruncated?: boolean;
}

export function injectPrototypeCsp(html: string): string {
  for (const pattern of [
    /<head(?:\s[^>]*)?>/i,
    /<html(?:\s[^>]*)?>/i,
    /<!doctype(?:\s[^>]*)?>/i,
  ]) {
    const match = pattern.exec(html);
    if (match !== null) {
      const end = match.index + match[0].length;
      return `${html.slice(0, end)}${CSP_META_TAG}${html.slice(end)}`;
    }
  }
  return `${CSP_META_TAG}${html}`;
}

export function buildPreviewShellHtml(options: PreviewShellOptions): string {
  const inline = options.source === 'inline';
  const generation = safeRevision(options.generation);
  const revision = safeRevision(options.revision);
  const fileName = escapeHtml(options.fileName);
  const relativePath = escapeHtml(options.relativePath);
  const source =
    options.displaySource ??
    (options.content.kind === 'document' ? options.content.html : '');
  const baseline = options.baseline ?? source;
  const prototype =
    options.content.kind === 'document'
      ? injectCanvasInspector(
          injectPrototypeCsp(options.content.html),
          generation,
          revision,
        )
      : null;
  const previewBody =
    options.content.kind === 'notice'
      ? `<p class="dvx-canvas-notice" role="status">${escapeHtml(
          options.content.message,
        )}</p>`
      : `<div class="dvx-canvas-frame-wrap">
          <iframe
            id="dvx-canvas-frame"
            class="dvx-canvas-frame"
            sandbox="${PREVIEW_IFRAME_SANDBOX}"
            srcdoc="${escapeHtml(prototype ?? '')}"
            title="Canvas preview of ${relativePath}"
          ></iframe>
        </div>`;
  const truncation =
    options.sourceTruncated === true || options.baselineTruncated === true
      ? ' · bounded display'
      : '';

  return /* html */ `<!doctype html>
<html lang="en" data-generation="${generation}" data-revision="${revision}">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${PREVIEW_CONTENT_CSP}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Canvas · ${fileName}</title>
  <style>${CANVAS_SHELL_STYLE}</style>
</head>
<body>
  <header class="dvx-canvas-bar">
    <span class="dvx-canvas-identity" title="${relativePath}">
      <span class="dvx-canvas-kicker">Canvas</span>
      <span class="dvx-canvas-title">${fileName}</span>
    </span>
    <span class="dvx-canvas-tabs" role="tablist" aria-label="Canvas view">
      <button type="button" data-view="preview" role="tab">Preview</button>
      <button type="button" data-view="code" role="tab">Code</button>
      <button type="button" data-view="diff" role="tab">Diff</button>
    </span>
    <span class="dvx-canvas-spacer"></span>
    <span class="dvx-canvas-viewports" aria-label="Preview size">
      <button type="button" data-viewport="desktop">Desktop</button>
      <button type="button" data-viewport="tablet">Tablet</button>
      <button type="button" data-viewport="mobile">Mobile</button>
    </span>
    <button id="dvx-canvas-select" type="button" aria-pressed="false">Select element</button>
    <button id="dvx-canvas-feedback-open" type="button">Give feedback</button>
    <button id="dvx-canvas-reload" type="button">Reload</button>
    ${inline ? '' : '<button id="dvx-canvas-open" type="button">Open in editor</button>'}
  </header>
  <main class="dvx-canvas-main">
    <section
      id="dvx-canvas-preview"
      class="dvx-canvas-preview"
      data-canvas-view="preview"
      data-viewport="desktop"
    >${previewBody}</section>
    <section class="dvx-canvas-source-view" data-canvas-view="code" hidden>
      <p class="dvx-canvas-source-head"><strong>Artifact source</strong><span>${escapeHtml(
        inline ? `From chat${truncation}` : `${options.relativePath}${truncation}`,
      )}</span></p>
      <pre id="dvx-canvas-code-content" class="dvx-canvas-code"></pre>
    </section>
    <section class="dvx-canvas-source-view" data-canvas-view="diff" hidden>
      <p class="dvx-canvas-source-head"><strong>Changes from opening baseline</strong><span>In memory only${escapeHtml(
        truncation,
      )}</span></p>
      <div id="dvx-canvas-diff-content" class="dvx-canvas-diff"></div>
    </section>
    <aside id="dvx-canvas-feedback" class="dvx-canvas-feedback" hidden>
      <form id="dvx-canvas-feedback-form">
        <label for="dvx-canvas-feedback-text">Return feedback to chat</label>
        <div id="dvx-canvas-selection" class="dvx-canvas-selection">No element selected</div>
        <textarea
          id="dvx-canvas-feedback-text"
          maxlength="4000"
          placeholder="Describe what should change…"
        ></textarea>
        <div class="dvx-canvas-feedback-actions">
          <button id="dvx-canvas-feedback-close" type="button">Cancel</button>
          <button class="is-primary" type="submit">Add to Composer</button>
        </div>
      </form>
    </aside>
  </main>
  <script id="dvx-canvas-source" type="application/json">${safeJson(source)}</script>
  <script id="dvx-canvas-baseline" type="application/json">${safeJson(baseline)}</script>
  <script>${CANVAS_SHELL_SCRIPT}</script>
</body>
</html>`;
}

function injectCanvasInspector(
  html: string,
  generation: number,
  revision: number,
): string {
  const script = `<script>
(function () {
  var enabled = false;
  var active = null;
  var previousOutline = null;
  function clearActive() {
    if (!active || !previousOutline) return;
    active.style.outline = previousOutline.outline;
    active.style.outlineOffset = previousOutline.offset;
    active = null; previousOutline = null;
  }
  function descriptor(node) {
    var parts = [], cursor = node;
    while (cursor && cursor.nodeType === 1 && parts.length < 8) {
      var part = cursor.tagName.toLowerCase();
      if (cursor.id) part += '#' + cursor.id.slice(0, 120);
      else if (cursor.parentElement) {
        var peers = Array.prototype.filter.call(cursor.parentElement.children,
          function (item) { return item.tagName === cursor.tagName; });
        if (peers.length > 1) part += ':nth-of-type(' + (peers.indexOf(cursor) + 1) + ')';
      }
      parts.unshift(part); cursor = cursor.parentElement;
    }
    return {
      tag: node.tagName.toLowerCase().slice(0, 40),
      id: node.id ? node.id.slice(0, 120) : undefined,
      classes: typeof node.className === 'string' && node.className
        ? node.className.slice(0, 200) : undefined,
      text: (node.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 240) || undefined,
      path: parts.join(' > ').slice(0, 480)
    };
  }
  window.addEventListener('message', function (event) {
    var m = event.data;
    if (!m || m.type !== 'dvx.canvas.selection' ||
      m.generation !== ${generation} || m.revision !== ${revision} ||
      typeof m.enabled !== 'boolean') return;
    enabled = m.enabled;
    document.documentElement.style.cursor = enabled ? 'crosshair' : '';
    if (!enabled) clearActive();
  });
  document.addEventListener('click', function (event) {
    if (!enabled || !(event.target instanceof Element)) return;
    event.preventDefault(); event.stopPropagation();
    clearActive();
    active = event.target;
    previousOutline = {
      outline: active.style.outline,
      offset: active.style.outlineOffset
    };
    active.style.outline = '2px solid #d8673d';
    active.style.outlineOffset = '2px';
    parent.postMessage({
      type: 'dvx.canvas.selected',
      generation: ${generation},
      revision: ${revision},
      selection: descriptor(active)
    }, '*');
  }, true);
})();
</script>`;
  const bodyClose = html.toLowerCase().lastIndexOf('</body>');
  return bodyClose === -1
    ? `${html}${script}`
    : `${html.slice(0, bodyClose)}${script}${html.slice(bodyClose)}`;
}

function safeJson(value: string): string {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029');
}

function safeRevision(value: number | undefined): number {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? (value as number) : 0;
}

function escapeHtml(value: string): string {
  return value.replace(/[&"'<>]/g, (character) => {
    if (character === '&') return '&amp;';
    if (character === '"') return '&quot;';
    if (character === "'") return '&#39;';
    if (character === '<') return '&lt;';
    return '&gt;';
  });
}
