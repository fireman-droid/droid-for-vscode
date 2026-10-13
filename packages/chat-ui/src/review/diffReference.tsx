import { createContext, useContext, useLayoutEffect, type RefObject } from 'react';
import type { CodeReference } from '../chat/codeReferences';

export const DiffReferenceContext = createContext<(CodeReference & { request: number }) | null>(null);

/** The review adapter supplies a comparison-relative location, never an editor command. */
export function useDiffReference(root: RefObject<HTMLDivElement | null>, path: string) {
  const request = useContext(DiffReferenceContext);
  const reference = request?.path === path ? request : null;
  useLayoutEffect(() => {
    const node = root.current;
    if (!node || !reference) return;
    const side = reference.side ?? 'after';
    const rows = [...node.querySelectorAll<HTMLElement>(`[data-diff-${side}]`)].filter(row => {
      const line = Number(row.getAttribute(`data-diff-${side}`));
      return line >= reference.startLine && line <= reference.endLine;
    });
    const first = rows[0], viewport = node.closest<HTMLElement>('.review-code-scroll');
    // File virtualization positions its section in a parent layout effect first.
    const frame = requestAnimationFrame(() => {
      if (first?.isConnected && viewport) viewport.scrollTop += first.getBoundingClientRect().top - viewport.getBoundingClientRect().top - 44;
    });
    const targets = rows.map(row => row.querySelector<HTMLElement>(`[data-side="${side === 'before' ? 'left' : 'right'}"]`) ?? row);
    for (const target of targets) target.dataset.referenceHighlight = '';
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const animations = reduced ? [] : targets.map(target => target.animate?.([
      { backgroundColor: 'color-mix(in srgb, var(--link-ink) 35%, transparent)' },
      { backgroundColor: 'color-mix(in srgb, var(--link-ink) 12%, transparent)' },
    ], { duration: 900, easing: 'ease-out' })).filter(Boolean);
    const timer = setTimeout(() => { for (const target of targets) delete target.dataset.referenceHighlight; }, 1600);
    return () => { cancelAnimationFrame(frame); clearTimeout(timer); for (const animation of animations) animation?.cancel(); for (const target of targets) delete target.dataset.referenceHighlight; };
  }, [root, reference]);
  return reference;
}
