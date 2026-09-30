/*! Vendored from Kilo 7d977bce994af36f0edf752cb53e3aefc7aeb214; Continue Apache-2.0; see third-party/CONTINUE-LICENSE.txt. */
const rx = /[\s.,/#!$%^&*;:{}=\-_`~()[\]]/g

export function getSymbolsForSnippet(snippet: string): Set<string> {
  const symbols = snippet
    .split(rx)
    .map((symbol) => symbol.trim())
    .filter((symbol) => symbol !== "")
  return new Set(symbols)
}
