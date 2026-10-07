import type { ThemeRegistration, ThemedToken } from 'shiki';

// TextMate scopes, like Kilo's Shiki theme, map to the UI's semantic palette.
// Class output avoids inline style attributes under the webview's strict CSP.
const scopes = [
  ['comment', 'hljs-comment'], ['string', 'hljs-string'],
  ['constant.numeric', 'hljs-number'], ['constant.language', 'hljs-literal'],
  ['keyword', 'hljs-keyword'], ['storage', 'hljs-keyword'],
  ['entity.name.type', 'hljs-type'], ['entity.name.class', 'hljs-type'],
  ['entity.name.tag', 'hljs-name'], ['entity.other.attribute-name', 'hljs-attr'],
  ['entity.name.function', 'hljs-title'], ['support', 'hljs-built_in'],
  ['meta.preprocessor', 'hljs-meta'], ['constant.character', 'hljs-symbol'],
] as const;
export const syntaxTheme: ThemeRegistration = {
  name: 'droid-syntax', type: 'dark',
  colors: { 'editor.foreground': '#000000', 'editor.background': '#ffffff' },
  tokenColors: scopes.map(([scope], index) => ({ scope, settings: { foreground: `#${(index + 1).toString(16).padStart(6, '0')}` } })),
};
const classes = new Map(scopes.map(([, className], index) => [`#${(index + 1).toString(16).padStart(6, '0')}`, className]));
export function syntaxHtml(tokens: readonly ThemedToken[]): string {
  return tokens.map(token => {
    const text = token.content.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
    const name = classes.get(token.color?.toLowerCase() ?? '');
    return name ? `<span class="${name}">${text}</span>` : text;
  }).join('');
}
