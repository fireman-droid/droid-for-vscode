import { useEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '../ui/button';
import { usePortalContainer } from '../ui/overlays';
import { useUiEnvironment } from '../environment';
import { readTranscriptSelection } from './transcriptSelection';

export function SelectionToolbar({ viewport, selectionRoot = viewport, onQuote, onBtwQuote }: {
  readonly viewport: RefObject<HTMLElement | null>;
  readonly selectionRoot?: RefObject<HTMLElement | null>;
  readonly onQuote: (text: string) => void;
  readonly onBtwQuote?: (text: string) => void;
}) {
  const { copyText } = useUiEnvironment();
  const container = usePortalContainer();
  const toolbar = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<{ text: string; left: number; top: number } | null>(null);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');
  useEffect(() => { setCopyState('idle'); }, [selection?.text]);
  useEffect(() => {
    let frame = 0;
    let dragging = false;
    const read = () => {
      if (dragging) return;
      const selected = readTranscriptSelection(selectionRoot.current);
      const root = viewport.current;
      const text = selected?.toString() ?? '';
      if (!root || !selected || !text.trim()) {
        setSelection(null);
        return;
      }
      const rect = selected.getRangeAt(0).getBoundingClientRect();
      const bounds = root.getBoundingClientRect();
      if (rect.bottom < bounds.top || rect.top > bounds.bottom) { setSelection(null); return; }
      const width = toolbar.current?.offsetWidth ?? (onBtwQuote ? 250 : 160);
      const next = {
        text,
        left: Math.max(bounds.left + 8, Math.min(rect.left, bounds.right - width - 8)),
        top: Math.max(bounds.top + 8, Math.min(rect.top - 34, bounds.bottom - 34)),
      };
      setSelection((previous) => previous?.text === next.text && previous.left === next.left && previous.top === next.top ? previous : next);
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(read); };
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && toolbar.current?.contains(event.target)) return;
      dragging = true;
      setSelection(null);
    };
    const finish = () => { dragging = false; schedule(); };
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { cancelAnimationFrame(frame); setSelection(null); }
    };
    document.addEventListener('selectionchange', schedule);
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('pointerup', finish);
    document.addEventListener('pointercancel', finish);
    document.addEventListener('keydown', keydown);
    viewport.current?.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    const root = viewport.current;
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('selectionchange', schedule);
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('pointerup', finish);
      document.removeEventListener('pointercancel', finish);
      document.removeEventListener('keydown', keydown);
      root?.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, [viewport, selectionRoot, onBtwQuote]);
  if (!selection) return null;
  const choose = (action: (text: string) => void) => {
    const current = readTranscriptSelection(selectionRoot.current);
    if (!current || current.toString() !== selection.text) { setSelection(null); return; }
    action(current.toString());
    window.getSelection()?.removeAllRanges();
    setSelection(null);
  };
  return createPortal(<div ref={toolbar} role="toolbar" aria-label="Selected text actions" data-webview-overlay=""
    className="fixed z-30 flex max-w-[calc(100vw-16px)] flex-wrap select-none gap-1 rounded border border-[var(--panel-edge)] bg-popover p-1 shadow-sm"
    style={{ left: selection.left, top: selection.top }} onMouseDown={(event) => event.preventDefault()}>
    <Button size="sm" variant="ghost" onClick={() => {
      const current = readTranscriptSelection(selectionRoot.current);
      if (!current || current.toString() !== selection.text) { setSelection(null); return; }
      void copyText(selection.text).then(() => setCopyState('copied'), () => setCopyState('error'));
    }}>{copyState === 'copied' ? 'Copied' : 'Copy'}</Button>
    <Button size="sm" variant="ghost" onClick={() => choose(onQuote)}>Add to Chat</Button>
    {onBtwQuote ? <Button size="sm" variant="ghost" onClick={() => choose(onBtwQuote)}>By the Way</Button> : null}
    {copyState === 'error' ? <span role="alert" className="w-full px-2 text-xs text-destructive">Could not copy selected text.</span> : null}
  </div>, container ?? document.body);
}
