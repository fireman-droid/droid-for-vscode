// @vitest-environment jsdom
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { UiEnvironmentProvider, type UiEnvironment } from '../../../packages/chat-ui/src/environment';
import { CodeReferenceInput } from '../../../packages/chat-ui/src/chat/CodeReferenceInput';
import { useCodeReferenceDraft } from '../../../packages/chat-ui/src/chat/useCodeReferenceDraft';
import { EDITOR_COPY_MIME, formatCodeReferences, parseCodeReferences } from '../../../packages/chat-ui/src/chat/codeReferences';
import { inlineText, setInlineSelection, pasteText } from './inlineInput.testHelpers';

afterEach(cleanup);
const ref = { path: 'app.ts', startLine: 1, endLine: 1, text: 'x'.repeat(100) };
const snapshot = formatCodeReferences([ref], '');
const environment: UiEnvironment = { assistantName: 'Droid', copyText: async () => undefined };
function Draft({ initial, limit }: { initial: string; limit: number }) {
  const [value, setValue] = useState(initial);
  const draft = useCodeReferenceDraft(value, setValue, limit);
  return <><CodeReferenceInput draft={draft} /><output>{value}</output></>;
}

it('releases a deleted snapshot’s budget before pasting its replacement', () => {
  render(<Draft initial={snapshot} limit={200} />);
  const input = screen.getByRole('textbox'); input.focus(); setInlineSelection(input, 0, 1);
  pasteText(input, 'a'.repeat(100));
  expect(screen.getByRole('status').textContent).toBe('a'.repeat(100));
});

it('counts retained snapshots while limiting inserted text without losing the suffix', () => {
  render(<Draft initial={snapshot + 'tail'} limit={snapshot.length + 7} />);
  const input = screen.getByRole('textbox'); input.focus(); setInlineSelection(input, 1);
  pasteText(input, 'abcdef');
  expect(parseCodeReferences(screen.getByRole('status').textContent!)).toMatchObject({ references: [ref], body: 'abctail' });
});

it('releases the same budget while resolving editor clipboard metadata', async () => {
  const resolveCodeReference = vi.fn(async () => null);
  render(<UiEnvironmentProvider value={{ ...environment, resolveCodeReference }}><Draft initial={snapshot} limit={200} /></UiEnvironmentProvider>);
  const input = screen.getByRole('textbox'); input.focus(); setInlineSelection(input, 0, 1);
  await act(async () => fireEvent.paste(input, { clipboardData: { getData: (type: string) => type === 'text/plain' ? 'a'.repeat(100)
    : type === EDITOR_COPY_MIME ? JSON.stringify({ providerCopyMimeTypes: ['application/vnd.droid.copy.aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'] }) : '' } }));
  expect(screen.getByRole('status').textContent).toBe('a'.repeat(100));
  expect(resolveCodeReference).toHaveBeenCalledOnce();
});

it.each([
  [5, 'abXcde', 'abcde', 2],
  [7, 'abXYZcde', 'abXYcde', 4],
  [6, 'ab🙂cde', 'abcde', 2],
] as const)('limits a native insertion at %s without deleting existing text', async (limit, browserValue, expected, caret) => {
  render(<Draft initial="abcde" limit={limit} />);
  const input = screen.getByRole('textbox'); input.focus(); input.textContent = browserValue;
  setInlineSelection(input, browserValue.length - 3);
  await act(async () => fireEvent.input(input, { inputType: 'insertText' }));
  expect(screen.getByRole('status').textContent).toBe(expected);
  expect(inlineText(input)).toBe(expected);
  const selection = document.getSelection()!;
  expect(selection.anchorOffset).toBe(caret);
});

it('limits a completed IME insertion while keeping the old text after it', async () => {
  render(<Draft initial="abcde" limit={6} />);
  const input = screen.getByRole('textbox'); input.focus(); setInlineSelection(input, 2);
  fireEvent.compositionStart(input);
  input.textContent = 'ab中文cde'; setInlineSelection(input, 4);
  fireEvent.input(input, { isComposing: true });
  expect(screen.getByRole('status').textContent).toBe('abcde');
  await act(async () => fireEvent.compositionEnd(input));
  expect(inlineText(input)).toBe('ab中cde');
  expect(screen.getByRole('status').textContent).toBe('ab中cde');
});

