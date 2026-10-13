import { useEffect, useRef, type ClipboardEvent, type KeyboardEvent } from 'react';
import type { InlineInputHandle } from '../ui/inline-input';
import { useUiEnvironment } from '../environment';
import { CODE_REFERENCE_MIME, EDITOR_COPY_MIME, decodeCodeReference, editorCopyMarkers, formatInlineCodeReferences, parseCodeReferences, type CodeReference } from './codeReferences';

/** Keeps snapshots in the draft, so queue/edit/reload and model input cannot lose them. */
export function useCodeReferenceDraft(value: string, onChange: (value: string) => void, maxLength = Infinity, owner?: unknown) {
  const { resolveCodeReference } = useUiEnvironment();
  const parsed = parseCodeReferences(value);
  const current = useRef({ value, onChange, owner });
  current.current = { value, onChange, owner };
  const generation = useRef(0);
  const history = useRef({ past: [] as string[], future: [] as string[], emitted: value });
  if (value !== history.current.emitted) history.current = { past: [], future: [], emitted: value };
  useEffect(() => () => { generation.current++; }, [owner]);
  const commit = (next: string) => {
    if (next === current.current.value) return;
    history.current.past.push(current.current.value);
    if (history.current.past.length > 100) history.current.past.shift();
    history.current.future = []; history.current.emitted = next;
    onChange(next);
  };
  const format = (body: string) => formatInlineCodeReferences(body, parsed.references, parsed.tokens);
  const change = (body: string) => commit(format(body));
  const onPaste = (event: ClipboardEvent<HTMLElement>, target?: InlineInputHandle): boolean => {
    const plain = event.clipboardData.getData('text/plain');
    const reference = decodeCodeReference(event.clipboardData.getData(CODE_REFERENCE_MIME));
    const markers = editorCopyMarkers(event.clipboardData.getData(EDITOR_COPY_MIME));
    if ((!reference || reference.text !== plain) && (!markers.length || !resolveCodeReference)) return false;
    const input = target ?? event.currentTarget as HTMLTextAreaElement;
    const element = target?.element ?? event.currentTarget;
    const start = input.selectionStart, end = input.selectionEnd;
    const before = parsed.inline.slice(0, start), after = parsed.inline.slice(end);
    const restoreCaret = (body: string, offset: number) => queueMicrotask(() => {
      if (element.isConnected && element.ownerDocument.activeElement === element && input.value === body) input.setSelectionRange(offset, offset);
    });
    let code = 0xe000;
    while (parsed.inline.includes(String.fromCharCode(code))) code++;
    const token = String.fromCharCode(code);
    const fold = (ref: CodeReference) => formatInlineCodeReferences(before + token + after, [...parsed.references, ref], [...parsed.tokens, token]);
    if (reference && reference.text === plain && fold(reference).length <= maxLength) {
      event.preventDefault(); commit(fold(reference)); queueMicrotask(() => input.setSelectionRange(start + 1, start + 1)); return true;
    }
    if (!markers.length || !resolveCodeReference) return false;
    // Insert text immediately. A slow host may only fold it if this draft is unchanged.
    const room = Math.max(0, maxLength - (value.length - (end - start)));
    const inserted = plain.slice(0, room);
    const next = format(before + inserted + after);
    event.preventDefault(); commit(next);
    restoreCaret(before + inserted + after, start + inserted.length);
    const captured = ++generation.current;
    void resolveCodeReference(markers, plain).then(ref => {
      if (generation.current !== captured || current.current.owner !== owner || current.current.value !== next || inserted !== plain || !ref || ref.text !== plain) return;
      const folded = fold(ref);
      if (folded.length <= maxLength) {
        const offset = input.selectionStart <= start ? input.selectionStart : Math.max(start + 1, input.selectionStart - inserted.length + 1);
        history.current.emitted = folded;
        current.current.onChange(folded); queueMicrotask(() => { if (element.isConnected) input.setSelectionRange(offset, offset); });
      }
    }, () => { /* Plain pasted text is already retained if the host is unavailable. */ });
    return true;
  };
  const onCopy = (event: ClipboardEvent<HTMLElement>, input: InlineInputHandle) => {
    const selected = input.value.slice(input.selectionStart, input.selectionEnd);
    if (!selected) return;
    event.preventDefault(); event.clipboardData.setData('text/plain', format(selected));
    const index = parsed.tokens.indexOf(selected);
    if (index >= 0) {
      event.clipboardData.setData('text/plain', parsed.references[index]!.text);
      event.clipboardData.setData(CODE_REFERENCE_MIME, JSON.stringify(parsed.references[index]));
    }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!(event.ctrlKey || event.metaKey) || event.nativeEvent.isComposing) return;
    const undo = event.key.toLowerCase() === 'z' && !event.shiftKey;
    const redo = event.key.toLowerCase() === 'y' || event.key.toLowerCase() === 'z' && event.shiftKey;
    if (!undo && !redo) return;
    event.preventDefault();
    const from = undo ? history.current.past : history.current.future;
    const next = from.pop();
    if (next === undefined) return;
    (undo ? history.current.future : history.current.past).push(value);
    history.current.emitted = next; onChange(next);
  };
  return { ...parsed, body: parsed.inline, change, onPaste, onCopy, onKeyDown,
    maxLength: Math.max(0, maxLength - (value.length - parsed.inline.length)),
    remove: (index: number) => change(parsed.inline.replace(parsed.tokens[index]!, '')) };
}
