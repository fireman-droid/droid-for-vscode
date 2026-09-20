import { useCallback, useLayoutEffect, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react';
import { defaultRangeExtractor, useVirtualizer, type Range } from '@tanstack/react-virtual';

/** Window long button lists while keeping native Tab order and keyboard navigation. */
export function useVirtualList({ keys, estimateSize, revealKey, enabled }: {
  readonly keys: readonly string[];
  readonly estimateSize: (index: number) => number;
  readonly revealKey?: string | null;
  readonly enabled: boolean;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const pendingFocus = useRef<string | null>(null);
  const indices = useMemo(() => new Map(keys.map((key, index) => [key, index])), [keys]);
  const focused = focusedKey === null ? undefined : indices.get(focusedKey);
  const virtualizer = useVirtualizer({
    count: keys.length, enabled, getScrollElement: () => viewport.current,
    getItemKey: (index) => keys[index]!, estimateSize, overscan: 6,
    rangeExtractor: useCallback((range: Range) => {
      const visible = defaultRangeExtractor(range);
      // Keep the focused row and its Tab neighbours mounted, even after scrolling.
      if (focused === undefined) return visible;
      return [...new Set([...visible, focused - 1, focused, focused + 1])]
        .filter((index) => index >= 0 && index < keys.length).sort((a, b) => a - b);
    }, [focused, keys.length]),
  });
  const revealIndex = revealKey == null ? undefined : indices.get(revealKey);
  useLayoutEffect(() => {
    if (revealIndex === undefined) return;
    if (enabled) virtualizer.scrollToIndex(revealIndex, { align: 'auto' });
    else {
      const container = viewport.current;
      const row = container?.querySelector<HTMLElement>(`[data-virtual-row="${revealIndex}"]`);
      if (!container || !row) return;
      const viewportRect = container.getBoundingClientRect(), rowRect = row.getBoundingClientRect();
      if (rowRect.top < viewportRect.top) container.scrollTop += rowRect.top - viewportRect.top;
      else if (rowRect.bottom > viewportRect.bottom) container.scrollTop += rowRect.bottom - viewportRect.bottom;
    }
  }, [enabled, revealIndex, revealKey, virtualizer]);
  useLayoutEffect(() => {
    const element = viewport.current;
    if (element) element.scrollTop = Math.min(element.scrollTop, Math.max(0, element.scrollHeight - element.clientHeight));
  }, [keys]);
  useLayoutEffect(() => {
    const key = pendingFocus.current;
    if (key === null) return;
    const index = indices.get(key);
    const button = viewport.current?.querySelector<HTMLElement>(`[data-virtual-row="${index}"] button`);
    if (button) { button.focus({ preventScroll: enabled }); pendingFocus.current = null; }
  });
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const row = (event.target as HTMLElement).closest<HTMLElement>('[data-virtual-row]');
    if (!row || !keys.length) return;
    const index = Number(row.dataset.virtualRow);
    const target = event.key === 'ArrowDown' ? Math.min(index + 1, keys.length - 1)
      : event.key === 'ArrowUp' ? Math.max(index - 1, 0)
      : event.key === 'Home' ? 0 : event.key === 'End' ? keys.length - 1 : null;
    if (target === null) return;
    event.preventDefault();
    pendingFocus.current = keys[target]!;
    setFocusedKey(keys[target]!);
    if (enabled) virtualizer.scrollToIndex(target, { align: 'auto' });
    const button = viewport.current?.querySelector<HTMLElement>(`[data-virtual-row="${target}"] button`);
    if (button) { button.focus({ preventScroll: enabled }); pendingFocus.current = null; }
  };
  const onFocusCapture = (event: FocusEvent<HTMLDivElement>) => {
    const row = (event.target as HTMLElement).closest<HTMLElement>('[data-virtual-row]');
    if (row) setFocusedKey(keys[Number(row.dataset.virtualRow)] ?? null);
  };
  const onBlurCapture = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocusedKey(null);
  };
  return { viewport, virtualizer, onKeyDown, onFocusCapture, onBlurCapture };
}
