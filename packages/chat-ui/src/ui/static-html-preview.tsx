import { useMemo } from 'react';
import { cn } from './cn';

const TAGS = new Set('div span p br hr section article header footer main aside h1 h2 h3 h4 h5 h6 table thead tbody tfoot tr th td caption colgroup col ul ol li dl dt dd pre code blockquote strong em b i u s small sup sub figure figcaption img style'.split(' '));
const ATTRIBUTES = new Set(['id', 'class', 'title', 'role', 'aria-label', 'colspan', 'rowspan', 'alt', 'width', 'height']);

/** Parse in an inert template, never in the live document or a network-capable DOMParser document. */
export function staticHtmlDocument(source: string, nonce: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(nonce)) throw new Error('Invalid preview nonce.');
  const template = document.createElement('template');
  template.innerHTML = source;
  const inlineRules: string[] = [];
  let index = 0;
  for (const node of template.content.querySelectorAll('*')) {
    const tag = node.tagName.toLowerCase();
    if (!TAGS.has(tag) || node.namespaceURI !== 'http://www.w3.org/1999/xhtml') { node.remove(); continue; }
    const style = node.getAttribute('style');
    for (const attribute of Array.from(node.attributes)) {
      if (tag === 'img' && attribute.name === 'src' && /^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/=\s]+$/.test(attribute.value)) continue;
      if (!ATTRIBUTES.has(attribute.name)) node.removeAttribute(attribute.name);
    }
    if (tag === 'style') node.setAttribute('nonce', nonce);
    if (style) {
      const marker = `dvx-static-${index++}`;
      node.classList.add(marker);
      inlineRules.push(`.${marker}{${style.replaceAll('<', '\\3c ')}}`);
    }
  }
  const policy = `default-src 'none'; script-src 'none'; style-src 'nonce-${nonce}'; img-src data:; font-src 'none'; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}">`
    + `<style nonce="${nonce}">body{font-family:system-ui,sans-serif;margin:16px;overflow-wrap:anywhere}img{max-width:100%}${inlineRules.join('\n')}</style>`
    + `</head><body>${template.innerHTML}</body></html>`;
}

/** No scripts, same-origin access, navigation controls, forms, or message bridge. */
export function StaticHtmlPreview({ html, nonce, title, className }: {
  html: string; nonce: string; title: string; className?: string;
}) {
  const srcDoc = useMemo(() => staticHtmlDocument(html, nonce), [html, nonce]);
  return <iframe title={title} sandbox="" referrerPolicy="no-referrer" srcDoc={srcDoc}
    className={cn('min-h-[440px] w-full rounded-lg border border-border bg-white', className)} />;
}
