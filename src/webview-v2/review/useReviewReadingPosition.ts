import { useLayoutEffect, useRef } from 'react';
export interface ReviewReadingPosition {
  top: number; left: number;
  anchor?: { before?: string; after?: string; text: string; offset: number };
}
export type ReviewReadingPositions = Map<string, ReviewReadingPosition>;

function rows(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('[data-diff-before], [data-diff-after]')];
}
function sourceText(row: HTMLElement): string {
  return [...row.querySelectorAll('.review-diff-code, code')].map(code => code.textContent ?? '').join('\n') || row.textContent || '';
}
export function captureReviewPosition(container: HTMLElement): ReviewReadingPosition {
  const top = container.getBoundingClientRect().top;
  const row = rows(container).find(row => row.getBoundingClientRect().bottom > top);
  return { top: container.scrollTop, left: container.scrollLeft,
    ...(row ? { anchor: { before: row.dataset.diffBefore, after: row.dataset.diffAfter,
      text: sourceText(row), offset: row.getBoundingClientRect().top - top } } : {}) };
}
export function restoreReviewPosition(container: HTMLElement, saved?: ReviewReadingPosition) {
  container.scrollTop = saved?.top ?? 0; container.scrollLeft = saved?.left ?? 0;
  if (!saved?.anchor) return;
  const anchor = saved.anchor;
  const available = rows(container);
  const line = available.find(row => row.dataset.diffAfter === anchor.after && row.dataset.diffBefore === anchor.before);
  const sameText = available.filter(row => sourceText(row) === anchor.text);
  const closest = sameText.sort((a, b) => Math.abs(Number(a.dataset.diffAfter ?? a.dataset.diffBefore) - Number(anchor.after ?? anchor.before)) -
    Math.abs(Number(b.dataset.diffAfter ?? b.dataset.diffBefore) - Number(anchor.after ?? anchor.before)))[0];
  const row = closest ?? line;
  if (row) container.scrollTop += row.getBoundingClientRect().top - container.getBoundingClientRect().top - anchor.offset;
}

/** Source-line anchors survive layout changes; pixels also restore unmounted virtual blocks. */
export function useReviewReadingPosition(container: () => HTMLElement | null, key: string | null,
  revision: unknown, positions: ReviewReadingPositions) {
  const getContainer = useRef(container); getContainer.current = container;
  useLayoutEffect(() => {
    const element = getContainer.current();
    if (!element || !key) return;
    const saved = positions.get(key);
    restoreReviewPosition(element, saved);
    const remember = () => positions.set(key, captureReviewPosition(element));
    remember();
    const frame = requestAnimationFrame(() => { restoreReviewPosition(element, saved); remember(); });
    element.addEventListener('scroll', remember, { passive: true });
    return () => { cancelAnimationFrame(frame); element.removeEventListener('scroll', remember); };
  }, [key, revision, positions]);
}
