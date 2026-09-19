export type MermaidOutcome =
  | { readonly ok: true; readonly svg: string; readonly css: string }
  | { readonly ok: false };

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
  for (const element of Array.from(host.querySelectorAll<HTMLElement>('[style]'))) {
    const text = element.getAttribute('style');
    if (text !== null) {
      element.style.cssText = text;
    }
  }
}

