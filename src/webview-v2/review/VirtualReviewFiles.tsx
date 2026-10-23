import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual';
import type { ReviewFile } from '../../shared/protocol/reviewProtocol';

/** Retains measured heights and the focused row as offscreen files unmount. */
interface Props {
  files: readonly ReviewFile[]; scroll: RefObject<HTMLDivElement | null>;
  collapsed: ReadonlySet<string>;
  jump: { path: string } | null; render(file: ReviewFile, index: number): ReactNode;
}
export function VirtualReviewFiles(props: Props) {
  if (props.files.length > 20) return <VirtualReviewWindow {...props} />;
  return <ReviewFileList {...props} />;
}
function ReviewFileList({ files, scroll, jump, render }: Props) {
  useLayoutEffect(() => {
    if (!jump || !scroll.current) return;
    const container = scroll.current;
    const element = [...container.querySelectorAll<HTMLElement>('[data-review-path]')].find(item => item.dataset.reviewPath === jump.path);
    if (element) container.scrollTop += element.getBoundingClientRect().top - container.getBoundingClientRect().top;
  }, [jump, scroll]);
  return <>{files.map((file, index) => <div key={file.path}>{render(file, index)}</div>)}</>;
}
function VirtualReviewWindow({ files, scroll, jump, render, collapsed }: Props) {
  const anchor = useRef<number | null>(null);
  const anchorFrame = useRef(0);
  const [focused, setFocused] = useState<string | null>(null);
  const [selection, setSelection] = useState<string[]>([]);
  const focusedIndex = files.findIndex(file => file.path === focused);
  const rangeExtractor = useCallback((range: Parameters<typeof defaultRangeExtractor>[0]) => {
    const indices = defaultRangeExtractor(range);
    if (focusedIndex >= 0 && !indices.includes(focusedIndex)) indices.push(focusedIndex);
    for (const path of selection) {
      const index = files.findIndex(file => file.path === path);
      if (index >= 0 && !indices.includes(index)) indices.push(index);
    }
    return indices.sort((a, b) => a - b);
  }, [focusedIndex, selection, files]);
  useEffect(() => {
    const update = () => {
      const selection = document.getSelection();
      const range = selection && !selection.isCollapsed && selection.rangeCount ? selection.getRangeAt(0) : undefined;
      setSelection(range ? [...scroll.current?.querySelectorAll<HTMLElement>('[data-review-path]') ?? []]
        .filter(element => range.intersectsNode(element)).map(element => element.dataset.reviewPath!) : []);
    };
    document.addEventListener('selectionchange', update);
    return () => document.removeEventListener('selectionchange', update);
  }, [scroll]);
  const virtual = useVirtualizer({ count: files.length, getScrollElement: () => scroll.current,
    estimateSize: index => collapsed.has(files[index]!.path) ? 36 : 280,
    getItemKey: index => files[index]!.path, overscan: 3, useFlushSync: false,
    rangeExtractor,
    onChange: (instance, scrolling) => {
      if (scrolling || anchor.current === null) return;
      cancelAnimationFrame(anchorFrame.current);
      anchorFrame.current = requestAnimationFrame(() => {
        const index = anchor.current;
        const viewport = scroll.current;
        if (index === null || !viewport || !files[index]) return;
        const row = instance.elementsCache.get(files[index]!.path);
        const bounds = row?.getBoundingClientRect();
        const area = viewport.getBoundingClientRect();
        // Browser scroll clamping can discard a size adjustment before the new
        // total height is committed. Recheck after that commit, without moving
        // an already visible selection or interrupting manual scrolling.
        if (!bounds || bounds.bottom <= area.top || bounds.top > area.bottom - Math.min(bounds.height, 300))
          instance.scrollToIndex(index, { align: 'start' });
      });
    } });
  // Files above a selected destination may finish loading after its first paint.
  // Preserve that destination even when those files were inside the viewport.
  const jumpIndex = jump ? files.findIndex(file => file.path === jump.path) : -1;
  useLayoutEffect(() => {
    anchor.current = jumpIndex >= 0 ? jumpIndex : null;
    virtual.shouldAdjustScrollPositionOnItemSizeChange = jumpIndex < 0 ? undefined : item => item.index < jumpIndex;
    if (jumpIndex >= 0) virtual.scrollToIndex(jumpIndex, { align: 'start' });
  }, [jump, jumpIndex]);
  useEffect(() => {
    const element = scroll.current;
    const release = () => { anchor.current = null; virtual.shouldAdjustScrollPositionOnItemSizeChange = undefined; };
    for (const type of ['wheel', 'pointerdown', 'keydown']) element?.addEventListener(type, release, { passive: true });
    return () => {
      cancelAnimationFrame(anchorFrame.current);
      for (const type of ['wheel', 'pointerdown', 'keydown']) element?.removeEventListener(type, release);
    };
  }, [scroll, virtual]);
  return <div className="review-virtual-files" style={{ position: 'relative', height: virtual.getTotalSize(), width: '100%' }}>
    {virtual.getVirtualItems().map(item => {
      const file = files[item.index]!;
      return <div key={item.key} data-index={item.index} ref={virtual.measureElement}
        onFocusCapture={() => setFocused(file.path)}
        style={{ position: 'absolute', top: item.start, left: 0, width: '100%' }}>
        {render(file, item.index)}
      </div>;
    })}
  </div>;
}
