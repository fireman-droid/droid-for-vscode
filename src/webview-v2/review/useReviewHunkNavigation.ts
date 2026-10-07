import { useEffect, useState, type RefObject } from 'react';
import { findDiffChange } from './DiffView';

/** Navigation crosses file windows even when the next file is not mounted yet. */
export function useReviewHunkNavigation(scroll: RefObject<HTMLDivElement | null>, paths: readonly string[],
  select: (path: string) => void, scopeKey: string) {
  const [pending, setPending] = useState<{ path: string; direction: number; scope: string } | null>(null);
  useEffect(() => {
    if (!pending || pending.scope !== scopeKey || !scroll.current) return;
    const container = scroll.current;
    let frame = 0;
    const reveal = () => {
      const section = [...container.querySelectorAll<HTMLElement>('[data-review-path]')]
        .find(element => element.dataset.reviewPath === pending.path);
      if (!section) return;
      const target = findDiffChange(section, pending.direction > 0 ? -Infinity : Infinity, pending.direction);
      if (target === null) return;
      container.scrollTop += target - container.getBoundingClientRect().top - 36;
      setPending(null);
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(reveal); };
    const observer = new MutationObserver(schedule);
    observer.observe(container, { subtree: true, childList: true }); schedule();
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [pending, scopeKey, scroll]);
  return (direction: number) => {
    const container = scroll.current;
    if (!container) return;
    setPending(null);
    const top = container.getBoundingClientRect().top + 36;
    const sections = [...container.querySelectorAll<HTMLElement>('[data-review-path]')]
      .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
    const current = sections.find(section => section.getBoundingClientRect().bottom > top) ?? sections[0];
    if (!current) return;
    const next = findDiffChange(current, top + direction * 8, direction);
    if (next !== null) {
      container.scrollBy({ top: next - top,
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
      return;
    }
    const index = paths.indexOf(current.dataset.reviewPath!);
    const path = paths[index + direction];
    if (!path) return;
    setPending({ path, direction, scope: scopeKey }); select(path);
  };
}
