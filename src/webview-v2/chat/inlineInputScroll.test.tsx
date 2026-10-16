// @vitest-environment jsdom
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CodeReferenceInput } from '../../../packages/chat-ui/src/chat/CodeReferenceInput';
import { ComposerView } from '../../../packages/chat-ui/src/chat/ComposerView';
import { UiEnvironmentProvider } from '../../../packages/chat-ui/src/environment';
import { EDITOR_COPY_MIME } from '../../../packages/chat-ui/src/chat/codeReferences';
import { useCodeReferenceDraft } from '../../../packages/chat-ui/src/chat/useCodeReferenceDraft';
import { inlineText, setInlineSelection } from '../../../packages/chat-ui/src/ui/inlineInputDom';
import { pasteText } from './inlineInput.testHelpers';

const originalRects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects');
afterEach(() => {
  cleanup(); vi.restoreAllMocks();
  if (originalRects) Object.defineProperty(Range.prototype, 'getClientRects', originalRects);
  else Reflect.deleteProperty(Range.prototype, 'getClientRects');
});
function Draft() {
  const [value, setValue] = useState('');
  const draft = useCodeReferenceDraft(value, setValue, 200_000);
  return <><CodeReferenceInput draft={draft} /><output>{value}</output></>;
}

function editor() {
  const view = render(<Draft />);
  const input = screen.getByRole('textbox');
  const outer = input.parentElement!;
  outer.scrollTop = 120;
  // JSDOM supplies no layout. Model a three-line viewport and the caret's
  // actual position in a long, newline-delimited draft; keep real editing.
  Object.defineProperty(input, 'clientHeight', { configurable: true, value: 60 });
  vi.spyOn(input, 'getBoundingClientRect').mockReturnValue({ top: 100, bottom: 160 } as DOMRect);
  const rects = function (this: Range) {
    const before = document.createRange();
    before.selectNodeContents(input); before.setEnd(this.endContainer, this.endOffset);
    const line = before.toString().split('\n').length - 1;
    const top = 100 + line * 20 - input.scrollTop;
    return [{ top, bottom: top + 20, height: 20, width: 0 }] as unknown as DOMRectList;
  };
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: vi.fn(rects) });
  input.focus(); setInlineSelection(input, 0);
  return { input, outer, view };
}

it('shows the end of a large paste and continued typing without scrolling the chat', async () => {
  const { input, outer } = editor();
  const text = 'a long pasted line\n'.repeat(6000) + 'last line';
  await act(async () => pasteText(input, text));
  expect(inlineText(input)).toBe(text);
  expect(screen.getByRole('status').textContent).toBe(text);
  expect(input.scrollTop).toBe(120020 - 60);
  expect(outer.scrollTop).toBe(120);

  // Native typing changes the DOM before the controlled render restores it.
  const node = input.firstChild as Text;
  node.appendData('\ncontinued'); setInlineSelection(input, text.length + 10);
  fireEvent.input(input, { inputType: 'insertText' });
  expect(inlineText(input)).toBe(text + '\ncontinued');
  expect(input.scrollTop).toBe(120040 - 60);
  expect(outer.scrollTop).toBe(120);
});

it('reveals an edit near the beginning instead of always jumping to the end', async () => {
  const { input, outer } = editor();
  const text = 'line\n'.repeat(100) + 'end';
  await act(async () => pasteText(input, text));
  setInlineSelection(input, 0);
  await act(async () => pasteText(input, 'start '));
  expect(inlineText(input)).toBe('start ' + text);
  expect(input.scrollTop).toBe(0);
  expect(outer.scrollTop).toBe(120);
});

it('does not pull a manually scrolled draft back to its caret on an unrelated render', async () => {
  const { input, view } = editor();
  await act(async () => pasteText(input, 'line\n'.repeat(100) + 'end'));
  input.scrollTop = 20;
  view.rerender(<Draft />);
  expect(input.scrollTop).toBe(20);
});

it.each([false, true])('explains oversized paste and rejected typing, then clears the notice after deletion (editor metadata=%s)', async metadata => {
  function Composer() {
    const [value, setValue] = useState('');
    const draft = useCodeReferenceDraft(value, setValue, 200_000);
    return <ComposerView value={draft.body} codeDraft={draft} onChange={draft.change} onSend={() => {}} />;
  }
  render(<UiEnvironmentProvider value={{ assistantName: 'Droid', copyText: async () => {}, resolveCodeReference: async () => null }}><Composer /></UiEnvironmentProvider>);
  const input = screen.getByRole('textbox'); input.focus();
  await act(async () => fireEvent.paste(input, { clipboardData: { getData: (type: string) => type === 'text/plain' ? 'x'.repeat(200_010)
    : metadata && type === EDITOR_COPY_MIME ? JSON.stringify({ providerCopyMimeTypes: ['application/vnd.droid.copy.aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'] }) : '' } }));
  expect(inlineText(input)).toHaveLength(200_000);
  expect(screen.getByRole('alert').textContent).toContain('Excess text was not inserted');
  // At the limit, a native keystroke must be explained rather than disappearing silently.
  (input.firstChild as Text).appendData('y'); setInlineSelection(input, 200_001);
  await act(async () => fireEvent.input(input, { inputType: 'insertText' }));
  expect(inlineText(input)).toHaveLength(200_000);
  expect(screen.getByRole('alert').textContent).toContain('200000');
  (input.firstChild as Text).deleteData(199_999, 1); setInlineSelection(input, 199_999);
  fireEvent.input(input, { inputType: 'deleteContentBackward' });
  expect(inlineText(input)).toHaveLength(199_999);
  expect(screen.queryByRole('alert')).toBeNull();
});
