import type { MermaidApi } from './mermaidGlobal';

import { splitSvgStyles, type MermaidOutcome } from '@droidvisx/chat-ui/markdown/diagramStyles';
export { adoptDiagramStyles, reapplyInlineStyles, splitSvgStyles, type MermaidOutcome } from '@droidvisx/chat-ui/markdown/diagramStyles';
const MAIN_BUNDLE_FILES = ['webview.js', 'session-viewer.js'];
const MERMAID_BUNDLE_FILE = 'mermaid.js';

/**
 * Mermaid theme variables tuned to the warm Droid palette
 * (`styles.css` Surface #f5f3ef / Ink #262626 / Border #e5e5e5 /
 * code #f7f5f1 / accent-soft #fff0ea). Light-first by design: the
 * shell paints its own warm light surfaces in every VS Code theme.
 */
const WARM_THEME_VARIABLES = {
  background: '#ffffff',
  fontFamily: '"Inter Variable", "Segoe UI", "Microsoft YaHei UI", sans-serif',
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
 * Charcoal counterpart for the dark theme: neutral gray node fills a
 * step above the raised card they sit on, translucent-white-derived
 * borders and light ink, notes in the theme's quiet warm sand.
 */
const DARK_THEME_VARIABLES = {
  ...WARM_THEME_VARIABLES,
  background: '#242425',
  primaryColor: '#2e2e30',
  primaryTextColor: '#e8e8e8',
  primaryBorderColor: '#4a4a4c',
  secondaryColor: '#3a3a3c',
  secondaryBorderColor: '#565658',
  secondaryTextColor: '#e8e8e8',
  tertiaryColor: '#1e1e1f',
  tertiaryBorderColor: '#3f3f41',
  tertiaryTextColor: '#e8e8e8',
  lineColor: '#8a8a8a',
  textColor: '#e8e8e8',
  noteBkgColor: '#33302a',
  noteBorderColor: '#55503f',
  errorBkgColor: '#2e2e30',
  errorTextColor: '#d8a8a8',
} as const;

export type MermaidTheme = 'light' | 'dark';

/**
 * Builds the script element that loads the sibling mermaid bundle.
 * The URL is derived from the already-trusted main bundle script, so
 * it can only ever point into the extension's own resource root. The
 * nonce content attribute is hidden after parsing, but the IDL
 * property stays readable from same-document script; jsdom (tests)
 * and plain harness pages fall back to the attribute.
 */
export function createMermaidScript(doc: Document): HTMLScriptElement | null {
  const host = Array.from(doc.scripts).find((script) =>
    MAIN_BUNDLE_FILES.some((name) => script.src.endsWith(`/${name}`)),
  );
  if (host === undefined) {
    return null;
  }
  const script = doc.createElement('script');
  script.src = new URL(MERMAID_BUNDLE_FILE, host.src).href;
  const nonce = host.nonce || host.getAttribute('nonce') || '';
  if (nonce.length > 0) {
    script.nonce = nonce;
  }
  return script;
}

let mermaidLoad: Promise<MermaidApi> | null = null;
let initializedTheme: MermaidTheme | null = null;

function loadMermaid(): Promise<MermaidApi> {
  mermaidLoad ??= new Promise<MermaidApi>((resolve, reject) => {
    const preloaded = window.__dvxMermaid;
    if (preloaded !== undefined) {
      resolve(preloaded);
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
        resolve(mermaid);
      }
    };
    script.onerror = () => reject(new Error('Mermaid bundle failed to load.'));
    document.head.append(script);
  });
  return mermaidLoad;
}

/**
 * (Re)initializes when the requested theme differs from the one the
 * API was configured with — a theme switch re-renders every mounted
 * diagram, so the palette must follow.
 */
function ensureTheme(mermaid: MermaidApi, theme: MermaidTheme): MermaidApi {
  if (initializedTheme !== theme) {
    mermaid.initialize({
      startOnLoad: false,
      // 'strict' sanitizes labels and disables script/click injection.
      securityLevel: 'strict',
      theme: 'base',
      themeVariables: {
        ...(theme === 'dark' ? DARK_THEME_VARIABLES : WARM_THEME_VARIABLES),
      },
    });
    initializedTheme = theme;
  }
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
  theme: MermaidTheme = 'light',
): Promise<MermaidOutcome> {
  renderSequence += 1;
  const elementId = `dvx-mermaid-${renderSequence}`;
  try {
    const mermaid = ensureTheme(await loadMermaid(), theme);
    const { svg } = await mermaid.render(elementId, source);
    return { ok: true, ...splitSvgStyles(svg) };
  } catch {
    // Failed renders can leave mermaid's scratch element behind.
    document.getElementById(elementId)?.remove();
    return { ok: false };
  }
}
