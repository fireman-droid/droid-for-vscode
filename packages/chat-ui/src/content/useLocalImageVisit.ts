import { useState, useEffect, type RefObject } from 'react';
/** Request once per visible visit, not on cache eviction while still mounted. */
export function useLocalImageVisit(
  ref: RefObject<HTMLSpanElement | null>,
  path: string,
  request: ((path: string) => void) | undefined,
): void {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const observer = new IntersectionObserver(([entry]) =>
      setVisible(entry?.isIntersecting === true),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, path]);
  useEffect(() => {
    if (visible) request?.(path);
  }, [visible, path, request]);
}
