import { useEffect, useRef, type ClipboardEvent } from 'react';
import { useUiEnvironment } from '../environment';
import { CODE_REFERENCE_MIME, EDITOR_COPY_MIME, decodeCodeReference, editorCopyMarkers, formatCodeReferences, parseCodeReferences, type CodeReference } from './codeReferences';

/** Keeps snapshots in the draft, so queue/edit/reload and model input cannot lose them. */
export function useCodeReferenceDraft(value: string, onChange: (value: string) => void, maxLength = Infinity, owner?: unknown) {
  const { resolveCodeReference } = useUiEnvironment();
  const parsed = parseCodeReferences(value);
  const current = useRef({ value, onChange, owner });
  current.current = { value, onChange, owner };
  const generation = useRef(0);
  useEffect(() => () => { generation.current++; }, [owner]);
  const change = (body: string) => onChange(formatCodeReferences(parsed.references, body));
  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>): boolean => {
    const plain = event.clipboardData.getData('text/plain');
    const reference = decodeCodeReference(event.clipboardData.getData(CODE_REFERENCE_MIME));
    const markers = editorCopyMarkers(event.clipboardData.getData(EDITOR_COPY_MIME));
    if ((!reference || reference.text !== plain) && (!markers.length || !resolveCodeReference)) return false;
    const input = event.currentTarget;
    const start = input.selectionStart, end = input.selectionEnd;
    const before = parsed.body.slice(0, start), after = parsed.body.slice(end);
    const restoreCaret = (body: string, offset: number) => queueMicrotask(() => {
      if (input.isConnected && input.ownerDocument.activeElement === input && input.value === body) input.setSelectionRange(offset, offset);
    });
    const fold = (ref: CodeReference) => formatCodeReferences([...parsed.references, ref], before + after);
    if (reference && reference.text === plain && fold(reference).length <= maxLength) {
      event.preventDefault(); onChange(fold(reference)); restoreCaret(before + after, start); return true;
    }
    if (!markers.length || !resolveCodeReference) return false;
    // Insert text immediately. A slow host may only fold it if this draft is unchanged.
    const room = Math.max(0, maxLength - (value.length - (end - start)));
    const inserted = plain.slice(0, room);
    const next = formatCodeReferences(parsed.references, before + inserted + after);
    event.preventDefault(); onChange(next);
    restoreCaret(before + inserted + after, start + inserted.length);
    const captured = ++generation.current;
    void resolveCodeReference(markers, plain).then(ref => {
      if (generation.current !== captured || current.current.owner !== owner || current.current.value !== next || inserted !== plain || !ref || ref.text !== plain) return;
      const folded = fold(ref);
      if (folded.length <= maxLength) {
        const offset = input.selectionStart <= start ? input.selectionStart : Math.max(start, input.selectionStart - inserted.length);
        current.current.onChange(folded); restoreCaret(before + after, offset);
      }
    }, () => { /* Plain pasted text is already retained if the host is unavailable. */ });
    return true;
  };
  return { ...parsed, change, onPaste, maxLength: Math.max(0, maxLength - (value.length - parsed.body.length)),
    remove: (index: number) => onChange(formatCodeReferences(parsed.references.filter((_, position) => position !== index), parsed.body)) };
}
