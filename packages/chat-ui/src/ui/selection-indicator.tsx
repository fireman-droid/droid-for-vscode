import { useLayoutEffect, useRef } from 'react';

/** Follows the selected control without taking over selection or focus. */
export function SelectionIndicator({ activeSelector, variant = 'underline' }: {
  readonly activeSelector: string;
  readonly variant?: 'underline' | 'surface';
}) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const indicator = ref.current;
    const list = indicator?.parentElement;
    if (!indicator || !list) return;
    let positioned = false;
    let frame = 0;
    const measure = () => {
      const active = list.querySelector<HTMLElement>(activeSelector);
      if (!active || !active.offsetWidth) {
        indicator.hidden = true;
        positioned = false;
        return;
      }
      indicator.hidden = false;
      if (!positioned) {
        indicator.style.transition = 'none';
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => indicator.style.removeProperty('transition'));
      }
      indicator.style.width = `${active.offsetWidth}px`;
      indicator.style.height = `${variant === 'surface' ? active.offsetHeight : 2}px`;
      const top = active.offsetTop + (variant === 'surface' ? 0 : active.offsetHeight - 2);
      indicator.style.transform = `translate(${active.offsetLeft}px, ${top}px)`;
      positioned = true;
    };
    const selection = new MutationObserver(measure);
    selection.observe(list, { subtree: true, attributes: true, attributeFilter: ['data-state', 'aria-current'] });
    const resize = new ResizeObserver(measure);
    resize.observe(list);
    Array.from(list.children).filter(child => child !== indicator).forEach(child => resize.observe(child));
    measure();
    return () => { selection.disconnect(); resize.disconnect(); cancelAnimationFrame(frame); };
  }, [activeSelector, variant]);
  return <span ref={ref} className="dvx-selection-indicator" data-variant={variant} aria-hidden="true" />;
}
