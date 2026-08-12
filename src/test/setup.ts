// jsdom performs no layout and ships no scrollIntoView; webview code
// scrolls the keyboard-highlighted popup row into view on mount, so
// give the DOM tests an inert stand-in. Extension tests run in a
// plain node environment where Element does not exist at all.
if (
  typeof Element !== 'undefined' &&
  typeof Element.prototype.scrollIntoView !== 'function'
) {
  Element.prototype.scrollIntoView = () => {};
}
