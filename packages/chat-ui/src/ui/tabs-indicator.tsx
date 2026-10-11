import { useLayoutEffect, useRef } from 'react';

/** Follows the active Radix trigger without taking over selection or focus. */
export function TabsIndicator() {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const indicator = ref.current;
    const list = indicator?.parentElement;
    if (!indicator || !list) return;
    let positioned = false;
    let frame = 0;
    const measure = () => {
      const active = list.querySelector<HTMLElement>('[role="tab"][data-state="active"]');
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
      indicator.style.transform = `translateX(${active.offsetLeft}px)`;
      positioned = true;
    };
    const selection = new MutationObserver(measure);
    selection.observe(list, { subtree: true, attributes: true, attributeFilter: ['data-state'] });
    const resize = new ResizeObserver(measure);
    resize.observe(list);
    list.querySelectorAll('[role="tab"]').forEach(tab => resize.observe(tab));
    measure();
    return () => { selection.disconnect(); resize.disconnect(); cancelAnimationFrame(frame); };
  }, []);
  return <span ref={ref} className="dvx-tabs-indicator" aria-hidden="true" />;
}
