// @vitest-environment jsdom
import { useState } from 'react';
import { act, cleanup, createEvent, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { CodeReferenceInput } from '../../../packages/chat-ui/src/chat/CodeReferenceInput';
import { useCodeReferenceDraft } from '../../../packages/chat-ui/src/chat/useCodeReferenceDraft';
import { formatCodeReferences, parseCodeReferences } from '../../../packages/chat-ui/src/chat/codeReferences';
import { inlineSelection, inlineText, setInlineSelection } from '../../../packages/chat-ui/src/ui/inlineInputDom';
import { pasteText } from './inlineInput.testHelpers';

afterEach(cleanup);
const first = { path: 'first.ts', startLine: 1, endLine: 2, text: 'const first = 1;' };
const second = { ...first, path: 'second.ts' };
const snapshots = formatCodeReferences([first, second], '');
function Draft({ initial = snapshots }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  const draft = useCodeReferenceDraft(value, setValue, 4000);
  return <><CodeReferenceInput draft={draft} /><output>{value}</output></>;
}

it('moves across adjacent references and inserts text before, between and after them', async () => {
  render(<Draft />);
  const input = screen.getByRole('textbox'); input.focus(); setInlineSelection(input, 2);
  for (const position of [1, 0]) {
    fireEvent.keyDown(input, { key: 'ArrowLeft' });
    expect(inlineSelection(input)).toMatchObject({ start: position, end: position });
    expect(document.getSelection()!.anchorNode?.nodeType).toBe(Node.TEXT_NODE);
  }
  await act(async () => pasteText(input, 'before'));
  fireEvent.keyDown(input, { key: 'ArrowRight' });
  await act(async () => pasteText(input, 'between'));
  fireEvent.keyDown(input, { key: 'ArrowRight' });
  await act(async () => pasteText(input, 'after'));
  expect(parseCodeReferences(screen.getByRole('status').textContent!)).toMatchObject({
    inline: 'before\ue000between\ue001after', references: [first, second],
  });
});

it('keeps the caret on the new line before a leading reference', async () => {
  render(<Draft initial={'explain\n' + snapshots} />);
  const input = screen.getByRole('textbox'); input.focus(); setInlineSelection(input, 9);
  fireEvent.keyDown(input, { key: 'ArrowLeft' });
  expect(inlineSelection(input)).toMatchObject({ start: 8, end: 8 });
  await act(async () => pasteText(input, 'here '));
  expect(parseCodeReferences(screen.getByRole('status').textContent!).inline).toBe('explain\nhere \ue000\ue001');
});

it('extends and shrinks a backward selection one reference at a time', () => {
  render(<Draft />);
  const input = screen.getByRole('textbox'); input.focus(); setInlineSelection(input, 2);
  fireEvent.keyDown(input, { key: 'ArrowLeft', shiftKey: true });
  expect(inlineSelection(input)).toEqual({ start: 1, end: 2, direction: 'backward' });
  fireEvent.keyDown(input, { key: 'ArrowLeft', shiftKey: true });
  expect(inlineSelection(input)).toEqual({ start: 0, end: 2, direction: 'backward' });
  fireEvent.keyDown(input, { key: 'ArrowRight', shiftKey: true });
  expect(inlineSelection(input)).toEqual({ start: 1, end: 2, direction: 'backward' });
  fireEvent.keyDown(input, { key: 'ArrowLeft' });
  expect(inlineSelection(input)).toMatchObject({ start: 1, end: 1 });
});

it.each(['Backspace', 'Delete'])('deletes exactly one adjacent reference with %s and can undo', async key => {
  render(<Draft />);
  const input = screen.getByRole('textbox'); input.focus(); setInlineSelection(input, 1);
  await act(async () => fireEvent.keyDown(input, { key }));
  expect(parseCodeReferences(screen.getByRole('status').textContent!).references).toEqual([key === 'Backspace' ? second : first]);
  fireEvent.keyDown(input, { key: 'z', ctrlKey: true });
  expect(screen.getByRole('status').textContent).toBe(snapshots);
});

it('keeps native typing and copy at a caret stop free of invisible draft characters', () => {
  render(<Draft />);
  const input = screen.getByRole('textbox'); input.focus(); setInlineSelection(input, 0);
  const selection = document.getSelection()!, text = selection.anchorNode as Text;
  text.insertData(selection.anchorOffset, '中文'); setInlineSelection(input, 2);
  fireEvent.input(input, { inputType: 'insertText' });
  expect(inlineText(input)).toBe('中文\ue000\ue001');
  expect(screen.getByRole('status').textContent).toBe('中文' + snapshots);
  setInlineSelection(input, 0, 4);
  let copied = '';
  fireEvent.copy(input, { clipboardData: { setData: (_: string, value: string) => { copied = value; } } });
  expect(copied).toBe('中文' + snapshots);
});

it('keeps the input edges editable after deletion at the beginning or end', async () => {
  render(<Draft />);
  const input = screen.getByRole('textbox'); input.focus();
  for (const [position, key] of [[0, 'Backspace'], [2, 'Delete']] as const) {
    setInlineSelection(input, position);
    const event = createEvent.keyDown(input, { key }); fireEvent(input, event);
    expect(event.defaultPrevented).toBe(true);
  }
  await act(async () => pasteText(input, 'after'));
  expect(parseCodeReferences(screen.getByRole('status').textContent!).inline).toBe('\ue000\ue001after');
});
