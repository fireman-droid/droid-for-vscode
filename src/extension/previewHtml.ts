/**
 * Shell HTML for the "Preview" WebviewPanel that renders Droid-written
 * HTML prototypes inside a sandboxed iframe.
 *
 * Loading mechanism (deviation from the original slice design, forced
 * by a VS Code platform probe): since VS Code 1.56 nested iframes
 * cannot navigate to `asWebviewUri` resources — the webview service
 * worker never sees top-level iframe navigations and Microsoft closed
 * the request as-designed (microsoft/vscode#121479, #123766). The
 * prototype document is therefore read by the host and inlined into a
 * sandboxed `srcdoc` iframe. Consequences:
 *
 * - only self-contained HTML runs; same-directory relative assets are
 *   not loadable (an opaque-origin frame is not service-worker
 *   controlled), which the toolbar states honestly;
 * - the panel needs no `localResourceRoots` at all (empty array =
 *   zero local file readability), strictly tighter than the planned
 *   parent-directory root.
 *
 * Security model (probed in Chromium, artifacts/preview-harness):
 *
 * 1. `sandbox="allow-scripts"` without `allow-same-origin` gives the
 *    prototype an opaque origin: no shell DOM access, no storage, no
 *    `acquireVsCodeApi`.
 * 2. `srcdoc` documents inherit the shell CSP below, and srcdoc frames
 *    are exempt from `frame-src`, so the shell CSP can stay maximally
 *    strict while the prototype's inline scripts still run. No network
 *    directive carries a host source, so fetch/XHR/WebSocket, CDN
 *    scripts, and external images are all blocked inside the
 *    prototype — closing prep risk R1 (network egress) by
 *    construction.
 * 3. The same policy is additionally injected into the prototype
 *    document as a `<meta>` tag (belt and suspenders should CSP
 *    inheritance ever regress); CSP composition is intersective, so a
 *    hostile prototype cannot loosen it.
 * 4. The shell registers no `window` message listener; the sandboxed
 *    child can spam `parent.postMessage` but nothing consumes it. The
 *    shell's own toolbar posts two fixed, payload-free commands to the
 *    host, which acts only on host-side state.
 *
 * The shell script is intentionally NOT nonce-guarded: a nonce or hash
 * in `script-src` makes browsers ignore `'unsafe-inline'`, which the
 * inherited policy needs for the prototype's inline scripts. The shell
 * document is generated exclusively from this template with every
 * interpolation HTML-escaped.
 */

/** Largest prototype source the panel will inline, in bytes. */
export const MAX_PREVIEW_SOURCE_BYTES = 4 * 1024 * 1024;

/** Exact sandbox grants for the prototype iframe. Never widen with
 * `allow-same-origin`: the entire isolation model rests on the child
 * keeping an opaque origin. */
export const PREVIEW_IFRAME_SANDBOX = 'allow-scripts';

/**
 * One policy, two enforcement points: the shell document's CSP (which
 * the srcdoc prototype inherits) and the `<meta>` tag injected into
 * the prototype itself. `'unsafe-eval'` is included deliberately —
 * it enables no egress or escape inside an opaque-origin frame and
 * keeps eval-based prototypes working.
 */
export const PREVIEW_CONTENT_CSP =
  "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; " +
  "style-src 'unsafe-inline'; img-src data: blob:; font-src data:; " +
  "media-src data: blob:; connect-src 'none'; frame-src 'none'; " +
  "child-src 'none'; worker-src 'none'; object-src 'none'; " +
  "form-action 'none'; base-uri 'none'";

const CSP_META_TAG =
  '<meta http-equiv="Content-Security-Policy" ' +
  `content="${PREVIEW_CONTENT_CSP}">`;

export type PreviewShellContent =
  | { readonly kind: 'document'; readonly html: string }
  | { readonly kind: 'notice'; readonly message: string };

export interface PreviewShellOptions {
  readonly fileName: string;
  readonly relativePath: string;
  readonly content: PreviewShellContent;
  /**
   * `inline` marks chat-authored HTML with no backing file: the
   * toolbar drops "Open in editor" (nothing to open) and the note
   * names the transcript as the source. Reload stays available and
   * re-renders the identical content. Defaults to `file`.
   */
  readonly source?: 'file' | 'inline';
}

/**
 * Injects the preview CSP `<meta>` into a prototype document as early
 * as the markup allows (after `<head>`, else `<html>`, else the
 * doctype, else prepended) so it precedes any script the parser will
 * execute. This is the secondary lock; the inherited shell CSP holds
 * even when a pathological document defeats the injection point.
 */
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

export function buildPreviewShellHtml(
  options: PreviewShellOptions,
): string {
  const inline = options.source === 'inline';
  const fileName = escapeHtml(options.fileName);
  const relativePath = escapeHtml(options.relativePath);
  const body =
    options.content.kind === 'document'
      ? `<iframe
      class="dvx-preview-frame"
      sandbox="${PREVIEW_IFRAME_SANDBOX}"
      srcdoc="${escapeHtml(injectPrototypeCsp(options.content.html))}"
      title="Prototype preview of ${relativePath}"
    ></iframe>`
      : `<p class="dvx-preview-notice" role="status">${escapeHtml(
          options.content.message,
        )}</p>`;
  const note = inline
    ? 'From chat · sandboxed · no network'
    : 'Sandboxed · inline code only · no network';
  const noteTitle = inline
    ? 'This HTML comes from a code block in the chat transcript and ' +
      'runs in a sandboxed frame with an opaque origin. Network ' +
      'requests, workspace files, and linked assets are unavailable; ' +
      'only inline HTML, CSS, and JavaScript execute.'
    : 'The prototype runs in a sandboxed frame with an opaque origin. ' +
      'Network requests, workspace files, and linked assets are ' +
      'unavailable; only inline HTML, CSS, and JavaScript execute.';

  return /* html */ `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta
    http-equiv="Content-Security-Policy"
    content="${PREVIEW_CONTENT_CSP}"
  >
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Preview · ${fileName}</title>
  <style>${SHELL_STYLE}</style>
</head>
<body>
  <header class="dvx-preview-toolbar">
    <span class="dvx-preview-file" title="${relativePath}">${fileName}</span>
    <span
      class="dvx-preview-note"
      title="${escapeHtml(noteTitle)}"
    >${escapeHtml(note)}</span>
    <span class="dvx-preview-spacer"></span>
    <button id="dvx-preview-reload" type="button">Reload</button>
    ${inline ? '' : '<button id="dvx-preview-open" type="button">Open in editor</button>'}
  </header>
  <main class="dvx-preview-stage">${body}</main>
  <script>${TOOLBAR_SCRIPT}</script>
</body>
</html>`;
}

/**
 * Static toolbar wiring with zero interpolation. It posts exactly two
 * fixed, payload-free commands and deliberately registers no window
 * "message" listener, so the sandboxed prototype has no path to the
 * host no matter what it posts at its parent.
 */
const TOOLBAR_SCRIPT = /* js */ `
(function () {
  var api = acquireVsCodeApi();
  var reload = document.getElementById('dvx-preview-reload');
  var open = document.getElementById('dvx-preview-open');
  if (reload) {
    reload.addEventListener('click', function () {
      api.postMessage({ type: 'preview.reload' });
    });
  }
  if (open) {
    open.addEventListener('click', function () {
      api.postMessage({ type: 'preview.openInEditor' });
    });
  }
})();
`;

/**
 * Quiet warm-neutral finish matching the chat shell tokens
 * (src/webview/assistant/styles.css); the panel cannot load that
 * stylesheet because it deliberately has no local resource roots.
 */
const SHELL_STYLE = /* css */ `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body {
    margin: 0;
    display: flex;
    flex-direction: column;
    background: #f5f3ef;
    color: #262626;
    font-family: ui-sans-serif, -apple-system, "Segoe UI", Roboto,
      "Helvetica Neue", Arial, sans-serif;
    font-size: 12.5px;
  }
  .dvx-preview-toolbar {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 7px 12px;
    border-bottom: 1px solid #e5e5e5;
    background: #fff;
    box-shadow: 0 1px 2px rgb(0 0 0 / 3%);
    white-space: nowrap;
    overflow: hidden;
  }
  .dvx-preview-file {
    font-weight: 600;
    letter-spacing: 0.01em;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .dvx-preview-note {
    color: #a1a1a1;
    overflow: hidden;
    text-overflow: ellipsis;
    cursor: default;
  }
  .dvx-preview-spacer { flex: 1; }
  .dvx-preview-toolbar button {
    appearance: none;
    font: inherit;
    color: #737373;
    background: #fff;
    border: 1px solid #e5e5e5;
    border-radius: 6px;
    padding: 3px 10px;
    cursor: pointer;
    transition: border-color 100ms ease, background 100ms ease,
      color 100ms ease;
  }
  .dvx-preview-toolbar button:hover {
    color: #262626;
    border-color: #d4d4d4;
    background: rgb(0 0 0 / 4%);
  }
  .dvx-preview-toolbar button:focus-visible {
    outline: 2px solid #f2612e;
    outline-offset: 1px;
  }
  .dvx-preview-stage {
    flex: 1;
    min-height: 0;
    display: flex;
  }
  .dvx-preview-frame {
    flex: 1;
    width: 100%;
    border: 0;
    background: #fff;
  }
  .dvx-preview-notice {
    margin: auto;
    padding: 14px 22px;
    color: #737373;
    background: #fff;
    border: 1px solid #e5e5e5;
    border-radius: 8px;
    box-shadow: 0 16px 40px -14px rgb(0 0 0 / 28%);
    max-width: 420px;
    text-align: center;
    line-height: 1.5;
  }
  @media (prefers-reduced-motion: reduce) {
    .dvx-preview-toolbar button { transition: none; }
  }
`;

function escapeHtml(value: string): string {
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
