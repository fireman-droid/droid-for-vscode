import { useImperativeHandle, useLayoutEffect, useRef, useState, type ClipboardEvent, type HTMLAttributes, type ReactNode, type Ref } from 'react';
import { createPortal } from 'react-dom';
import { cn } from './cn';
import { inlineSelection, inlineText, setInlineSelection } from './inlineInputDom';
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
  onContentLayout?(element: HTMLDivElement): void;
}

/** Shared editing primitive for text interspersed with non-editable, keyboard-addressable atoms. */
export function InlineInput({ ref, value, tokens, renderToken, onChange, onPaste, onCopy, onKeyDown, onInput, onCompositionStart, onCompositionEnd,
  placeholder, disabled, maxLength = Infinity, measureText, onContentLayout, className, ...props }: InlineInputProps) {
  const root = useRef<HTMLDivElement>(null);
  const composing = useRef(false);
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
    setSelectionRange(start, end, direction) { if (root.current) setInlineSelection(root.current, start, end, direction); },
  };
  useImperativeHandle(ref, () => handle.current!, []);
  const tokenKey = tokens.join('');
  useLayoutEffect(() => {
    const node = root.current!;
    if (composing.current || (rendered.current === value + tokenKey && inlineText(node) === value)) return;
    const selected = inlineSelection(node);
    const focused = node.ownerDocument.activeElement === node;
    const fragment = node.ownerDocument.createDocumentFragment();
    const next: typeof slots = [];
    let text = '';
    const flush = () => { fragment.append(node.ownerDocument.createTextNode(text)); text = ''; };
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
  }, [value, tokenKey, revision]);
  useLayoutEffect(() => {
    const node = root.current!;
    // The first commit creates atom containers; the next commits their portals.
    // Consumers must measure only the completed content, including chip labels.
    if (slots.some(slot => slot.element.parentNode !== node) ||
      node.querySelectorAll(':scope > [data-inline-token]').length !== slots.length) return;
    onContentLayout?.(node);
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
    onChange(limited.value, limited.cursor);
    if (limited.value !== next) {
      // A rejected insertion may leave the controlled value unchanged. Still
      // restore the browser DOM and caret before accepting another edit.
      setRevision(count => count + 1);
      restoreCaret(limited.value, limited.cursor);
    }
  };
  const replace = (text: string) => {
    const input = handle.current!, start = input.selectionStart, end = input.selectionEnd;
    const limited = limitInlineEdit(input.value, input.value.slice(0, start) + text + input.value.slice(end), start + text.length, maxLength, measureText);
    onChange(limited.value, limited.cursor);
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
      if (event.key === 'Enter') { event.preventDefault(); replace('\n'); }
    }}>{slots.filter(slot => tokens.includes(slot.token)).map(({ token, element }, index) => createPortal(renderToken(token), element, `${token}:${index}`))}</div>;
}
