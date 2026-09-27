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

// The virtualized transcript observes its scroller and every mounted row
// through ResizeObserver, which jsdom does not ship. Without a stand-in
// the virtualizer throws on unmount and renders no rows at all. Sizes
// still come from the estimate and initialRect, so an inert observer is
// all the DOM tests need.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
}

// Radix Select uses pointer capture; jsdom does not implement it.
if (typeof HTMLElement !== 'undefined' && !HTMLElement.prototype.hasPointerCapture) {
  HTMLElement.prototype.hasPointerCapture = () => false;
  HTMLElement.prototype.setPointerCapture = () => {};
  HTMLElement.prototype.releasePointerCapture = () => {};
}
export {};
