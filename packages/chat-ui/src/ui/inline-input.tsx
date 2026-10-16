import { useImperativeHandle, useLayoutEffect, useRef, useState, type ClipboardEvent, type HTMLAttributes, type ReactNode, type Ref } from 'react';
import { createPortal } from 'react-dom';
import { cn } from './cn';
import { inlineSelection, inlineText, revealInlineCaret, setInlineSelection } from './inlineInputDom';
import { limitInlineEdit } from './inlineInputEdit';

export interface InlineInputHandle {
  readonly element: HTMLDivElement;
  readonly value: string;
  readonly selectionStart: number;
  readonly selectionEnd: number;
  readonly selectionDirection: 'forward' | 'backward' | 'none';
  focus(options?: FocusOptions): void;
  setSelectionRange(start: number, end: number, direction?: string): void;
}
export interface InlineInputProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onChange' | 'onPaste' | 'onCopy'> {
  ref?: Ref<InlineInputHandle>;
  value: string;
  tokens: readonly string[];
  renderToken(token: string): ReactNode;
  onChange(value: string, cursor: number): void;
  onPaste?(event: ClipboardEvent<HTMLDivElement>, input: InlineInputHandle): void;
  onCopy?(event: ClipboardEvent<HTMLDivElement>, input: InlineInputHandle): void;
  placeholder?: string;
  disabled?: boolean;
  maxLength?: number;
  measureText?(value: string): number;
  onLimitExceeded?(): void;
  onContentLayout?(element: HTMLDivElement): void;
}

/** Shared editing primitive for text interspersed with non-editable, keyboard-addressable atoms. */
export function InlineInput({ ref, value, tokens, renderToken, onChange, onPaste, onCopy, onKeyDown, onInput, onCompositionStart, onCompositionEnd,
  placeholder, disabled, maxLength = Infinity, measureText, onLimitExceeded, onContentLayout, className, ...props }: InlineInputProps) {
  const root = useRef<HTMLDivElement>(null);
  const composing = useRef(false);
  const revealAfterEdit = useRef(false);
  const rendered = useRef<string | null>(null);
  const [slots, setSlots] = useState<Array<{ token: string; element: HTMLElement }>>([]);
  const [revision, setRevision] = useState(0);
  const handle = useRef<InlineInputHandle>(null);
  if (!handle.current) handle.current = {
    get element() { return root.current!; }, get value() { return inlineText(root.current!); },
    get selectionStart() { return inlineSelection(root.current!).start; },
    get selectionEnd() { return inlineSelection(root.current!).end; },
    get selectionDirection() { return inlineSelection(root.current!).direction; },
    focus(options) { root.current?.focus(options); },
    setSelectionRange(start, end, direction) {
      if (root.current) { setInlineSelection(root.current, start, end, direction); revealInlineCaret(root.current); }
    },
  };
  useImperativeHandle(ref, () => handle.current!, []);
  const tokenKey = tokens.join('');
  useLayoutEffect(() => {
    const node = root.current!;
    if (composing.current || (rendered.current === value + tokenKey && inlineText(node) === value)) return;
    const selected = inlineSelection(node);
    const focused = node.ownerDocument.activeElement === node;
    const scrollTop = node.scrollTop;
    const fragment = node.ownerDocument.createDocumentFragment();
    const next: typeof slots = [];
    let text = '';
    const flush = () => {
      if (!text && tokens.length) {
        // Empty text nodes are not caret stops in Chromium. Give the edges of
        // atoms a real editable position without adding text to the draft.
        const caret = node.ownerDocument.createElement('span');
        caret.dataset.inlineCaret = ''; caret.textContent = '\u200b'; fragment.append(caret);
      } else fragment.append(node.ownerDocument.createTextNode(text));
      text = '';
    };
    for (const character of value) {
      if (!tokens.includes(character)) { text += character; continue; }
      flush();
      const atom = node.ownerDocument.createElement('span');
      atom.contentEditable = 'false'; atom.dataset.inlineToken = character; atom.className = 'dvx-inline-atom';
      fragment.append(atom); next.push({ token: character, element: atom });
    }
    flush();
    // Keep a real caret position on the last empty line. inlineText omits this
    // filler so selecting/deleting the draft does not leave an invisible newline.
    if (value.endsWith('\n')) fragment.append(node.ownerDocument.createElement('br'));
    node.replaceChildren(fragment);
    rendered.current = value + tokenKey; setSlots(next);
    if (focused) setInlineSelection(node, selected.start, selected.end, selected.direction);
    node.scrollTop = scrollTop;
  }, [value, tokenKey, revision]);
  useLayoutEffect(() => {
    const node = root.current!;
    // The first commit creates atom containers; the next commits their portals.
    // Consumers must measure only the completed content, including chip labels.
    if (slots.some(slot => slot.element.parentNode !== node) ||
      node.querySelectorAll(':scope > [data-inline-token]').length !== slots.length) return;
    onContentLayout?.(node);
    if (revealAfterEdit.current) { revealInlineCaret(node); revealAfterEdit.current = false; }
  }, [value, tokenKey, slots, revision, onContentLayout]);
  const restoreCaret = (next: string, cursor: number) => {
    const input = handle.current!, element = input.element;
    queueMicrotask(() => {
      if (element.isConnected && element.ownerDocument.activeElement === element && input.value === next)
        input.setSelectionRange(cursor, cursor);
    });
  };
  const change = () => {
    if (composing.current) return;
    const next = inlineText(root.current!);
    const caret = handle.current!.selectionStart;
    const limited = limitInlineEdit(value, next, caret, maxLength, measureText);
    revealAfterEdit.current = true;
    onChange(limited.value, limited.cursor);
    if (limited.value !== next) {
      onLimitExceeded?.();
      // A rejected insertion may leave the controlled value unchanged. Still
      // restore the browser DOM and caret before accepting another edit.
      setRevision(count => count + 1);
      restoreCaret(limited.value, limited.cursor);
    }
  };
  const replace = (text: string) => {
    const input = handle.current!, start = input.selectionStart, end = input.selectionEnd;
    const next = input.value.slice(0, start) + text + input.value.slice(end);
    const limited = limitInlineEdit(input.value, next, start + text.length, maxLength, measureText);
    onChange(limited.value, limited.cursor);
    if (limited.value !== next) onLimitExceeded?.();
    restoreCaret(limited.value, limited.cursor);
  };
  return <div {...props} ref={root} role="textbox" aria-multiline="true" aria-disabled={disabled || undefined}
    contentEditable={!disabled} suppressContentEditableWarning tabIndex={disabled ? -1 : 0}
    data-slot="inline-input" data-placeholder={placeholder} data-empty={(!value && !composing.current) || undefined}
    className={cn('dvx-inline-input', className)}
    onCompositionStart={event => { composing.current = true; setRevision(count => count + 1); onCompositionStart?.(event); }}
    onCompositionEnd={event => { composing.current = false; change(); setRevision(count => count + 1); onCompositionEnd?.(event); }}
    onInput={event => { change(); onInput?.(event); }}
    onPaste={event => {
      onPaste?.(event, handle.current!);
      if (event.defaultPrevented) return;
      event.preventDefault(); replace(event.clipboardData.getData('text/plain'));
    }}
    onCopy={event => onCopy?.(event, handle.current!)}
    onCut={event => {
      onCopy?.(event, handle.current!);
      if (event.defaultPrevented) replace('');
    }}
    onKeyDown={event => {
      // Embedded controls own their keys; IME confirmation/cancellation must
      // never reach a consumer's send, undo or close shortcuts.
      if (event.target !== event.currentTarget) return;
      if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) {
        event.stopPropagation(); return;
      }
      onKeyDown?.(event);
      if (event.defaultPrevented) return;
      if (tokens.length && ['ArrowLeft', 'ArrowRight', 'Backspace', 'Delete'].includes(event.key) && !event.ctrlKey && !event.metaKey && !event.altKey) {
        const input = handle.current!, text = input.value;
        const { start, end, direction } = inlineSelection(root.current!);
        const backward = event.key === 'ArrowLeft' || event.key === 'Backspace';
        const arrow = event.key === 'ArrowLeft' || event.key === 'ArrowRight';
        const deletion = event.key === 'Backspace' || event.key === 'Delete';
        if (deletion && start === end && (backward ? start === 0 : end === text.length)) {
          event.preventDefault(); return;
        }
        const focus = direction === 'backward' ? start : end;
        const adjacent = tokens.includes(text[(arrow ? focus : start) - (backward ? 1 : 0)] ?? '');
        const selectedAtom = start !== end && tokens.some(token => text.slice(start, end).includes(token));
        if (arrow && (adjacent || (!event.shiftKey && selectedAtom))) {
          event.preventDefault();
          const next = start !== end && !event.shiftKey ? (backward ? start : end) : focus + (backward ? -1 : 1);
          const anchor = event.shiftKey ? (direction === 'backward' ? end : start) : next;
          input.setSelectionRange(Math.min(anchor, next), Math.max(anchor, next), next < anchor ? 'backward' : 'forward');
        } else if (deletion && (selectedAtom || start === end && adjacent)) {
          event.preventDefault();
          if (start === end) input.setSelectionRange(backward ? start - 1 : start, backward ? end : end + 1);
          replace('');
        }
      }
      if (event.key === 'Enter') { event.preventDefault(); replace('\n'); }
    }}>{slots.filter(slot => tokens.includes(slot.token)).map(({ token, element }, index) => createPortal(renderToken(token), element, `${token}:${index}`))}</div>;
}
