import type { MermaidApi } from '../mermaidGlobal';

export type MermaidOutcome =
  | { readonly ok: true; readonly svg: string; readonly css: string }
  | { readonly ok: false };

const MAIN_BUNDLE_FILE = 'webview.js';
const MERMAID_BUNDLE_FILE = 'mermaid.js';

/**
 * Mermaid theme variables tuned to the warm DroidVisX palette
 * (`styles.css` Surface #f5f3ef / Ink #262626 / Border #e5e5e5 /
 * code #f7f5f1 / accent-soft #fff0ea). Light-first by design: the
 * shell paints its own warm light surfaces in every VS Code theme.
 */
const WARM_THEME_VARIABLES = {
  background: '#ffffff',
  fontFamily:
    '"Inter Variable", "Segoe UI", "Microsoft YaHei UI", sans-serif',
  fontSize: '13px',
  primaryColor: '#f7f5f1',
  primaryTextColor: '#262626',
  primaryBorderColor: '#ded6cc',
  secondaryColor: '#fff0ea',
  secondaryBorderColor: '#e8c9b8',
  secondaryTextColor: '#262626',
  tertiaryColor: '#f5f3ef',
  tertiaryBorderColor: '#e5e5e5',
  tertiaryTextColor: '#262626',
  lineColor: '#8f867c',
  textColor: '#262626',
  noteBkgColor: '#fdf6ec',
  noteBorderColor: '#e8ddc9',
  errorBkgColor: '#f7f5f1',
  errorTextColor: '#7a4a3a',
} as const;

/**
 * Builds the script element that loads the sibling mermaid bundle.
 * The URL is derived from the already-trusted main bundle script, so
 * it can only ever point into the extension's own resource root. The
 * nonce content attribute is hidden after parsing, but the IDL
 * property stays readable from same-document script; jsdom (tests)
 * and plain harness pages fall back to the attribute.
 */
export function createMermaidScript(
  doc: Document,
): HTMLScriptElement | null {
  const host = Array.from(doc.scripts).find((script) =>
    script.src.endsWith(`/${MAIN_BUNDLE_FILE}`),
  );
  if (host === undefined) {
    return null;
  }
  const script = doc.createElement('script');
  script.src =
    host.src.slice(0, -MAIN_BUNDLE_FILE.length) + MERMAID_BUNDLE_FILE;
  const nonce = host.nonce || host.getAttribute('nonce') || '';
  if (nonce.length > 0) {
    script.nonce = nonce;
  }
  return script;
}

/**
 * Splits the `<style>` blocks out of a mermaid SVG string. The webview
 * CSP (`style-src` without `'unsafe-inline'`) ignores parser-inserted
 * style elements, so the CSS must be re-applied through the CSSOM
 * (see {@link adoptDiagramStyles}), which CSP does not restrict.
 */
export function splitSvgStyles(svg: string): {
  svg: string;
  css: string;
} {
  const styles: string[] = [];
  const stripped = svg.replace(
    /<style[^>]*>([\s\S]*?)<\/style>/gu,
    (_match, css: string) => {
      styles.push(css);
      return '';
    },
  );
  return { svg: stripped, css: styles.join('\n') };
}

/**
 * Adopts diagram CSS via a constructable stylesheet (CSP-exempt).
 * Mermaid scopes every rule with the diagram element id, so adopting
 * at document level cannot leak styles. Returns a release function.
 */
export function adoptDiagramStyles(css: string): () => void {
  if (css.length === 0) {
    return () => {};
  }
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(css);
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  return () => {
    document.adoptedStyleSheets = document.adoptedStyleSheets.filter(
      (existing) => existing !== sheet,
    );
  };
}

/**
 * Re-applies `style="…"` attributes through the CSSOM. Parser-inserted
 * inline style attributes are dead under the webview CSP, but property
 * assignment is exempt, so the rendered SVG keeps its presentation.
 */
export function reapplyInlineStyles(host: Element): void {
  for (const element of Array.from(
    host.querySelectorAll<HTMLElement>('[style]'),
  )) {
    const text = element.getAttribute('style');
    if (text !== null) {
      element.style.cssText = text;
    }
  }
}

let mermaidLoad: Promise<MermaidApi> | null = null;

function loadMermaid(): Promise<MermaidApi> {
  mermaidLoad ??= new Promise<MermaidApi>((resolve, reject) => {
    const preloaded = window.__dvxMermaid;
    if (preloaded !== undefined) {
      resolve(initializeMermaid(preloaded));
      return;
    }
    const script = createMermaidScript(document);
    if (script === null) {
      reject(new Error('Main webview bundle script not found.'));
      return;
    }
    script.onload = () => {
      const mermaid = window.__dvxMermaid;
      if (mermaid === undefined) {
        reject(new Error('Mermaid bundle did not register its API.'));
      } else {
        resolve(initializeMermaid(mermaid));
      }
    };
    script.onerror = () =>
      reject(new Error('Mermaid bundle failed to load.'));
    document.head.append(script);
  });
  return mermaidLoad;
}

function initializeMermaid(mermaid: MermaidApi): MermaidApi {
  mermaid.initialize({
    startOnLoad: false,
    // 'strict' sanitizes labels and disables script/click injection.
    securityLevel: 'strict',
    theme: 'base',
    themeVariables: { ...WARM_THEME_VARIABLES },
  });
  return mermaid;
}

let renderSequence = 0;

/**
 * Renders mermaid source to CSP-ready SVG + CSS. Every failure path
 * (bundle load, parse, render) collapses to `{ ok: false }` so the
 * caller can quietly fall back to the plain code block.
 */
export async function renderMermaid(
  source: string,
): Promise<MermaidOutcome> {
  renderSequence += 1;
  const elementId = `dvx-mermaid-${renderSequence}`;
  try {
    const mermaid = await loadMermaid();
    const { svg } = await mermaid.render(elementId, source);
    return { ok: true, ...splitSvgStyles(svg) };
  } catch {
    // Failed renders can leave mermaid's scratch element behind.
    document.getElementById(elementId)?.remove();
    return { ok: false };
  }
}
