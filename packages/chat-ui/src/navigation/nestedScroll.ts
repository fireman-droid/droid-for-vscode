/** Inner code/diff scrolling is reading intent, not a return to the chat tail. */
export function isNestedScrollTarget(viewport: HTMLElement, target: EventTarget | null): boolean {
  if (!(target instanceof Element) || !viewport.contains(target)) return false;
  for (let element: Element | null = target; element && element !== viewport; element = element.parentElement) {
    if (!(element instanceof HTMLElement)) continue;
    const style = getComputedStyle(element);
    if ((element.scrollWidth > element.clientWidth && /auto|scroll/.test(style.overflowX)) ||
      (element.scrollHeight > element.clientHeight && /auto|scroll/.test(style.overflowY))) return true;
  }
  return false;
}
