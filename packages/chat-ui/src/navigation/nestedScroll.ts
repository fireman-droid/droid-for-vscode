/** A wheel belongs to an inner scroller only while it can move in that direction. */
export function isNestedScrollTarget(viewport: HTMLElement, target: EventTarget | null, deltaY?: number): boolean {
  if (!(target instanceof Element) || !viewport.contains(target)) return false;
  for (let element: Element | null = target; element && element !== viewport; element = element.parentElement) {
    if (!(element instanceof HTMLElement)) continue;
    const style = getComputedStyle(element);
    if (deltaY !== undefined) {
      const remaining = deltaY < 0 ? element.scrollTop : element.scrollHeight - element.clientHeight - element.scrollTop;
      if (remaining > 0.5 && /auto|scroll/.test(style.overflowY)) return true;
      continue;
    }
    if ((element.scrollWidth > element.clientWidth && /auto|scroll/.test(style.overflowX)) ||
      (element.scrollHeight > element.clientHeight && /auto|scroll/.test(style.overflowY))) return true;
  }
  return false;
}
