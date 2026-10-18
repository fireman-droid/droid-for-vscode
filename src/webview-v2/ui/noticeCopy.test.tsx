// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PortalContainerProvider } from '../../../packages/chat-ui/src/ui/overlays';
import { selectedContentText } from '../../../packages/chat-ui/src/ui/copySelection';
import { DiffView } from '../../../packages/chat-ui/src/review/DiffView';
import { CODE_REFERENCE_MIME } from '../../../packages/chat-ui/src/chat/codeReferences';
import { Input } from '../../../packages/chat-ui/src/ui/input';
import { CommandOutput } from '../../../packages/chat-ui/src/chat/CommandOutput';

afterEach(() => { cleanup(); document.getSelection()?.removeAllRanges(); });

function select(element: Element) {
  const range = document.createRange(); range.selectNodeContents(element);
  const selection = document.getSelection()!;
  selection.removeAllRanges(); selection.addRange(range);
  return selection;
}
function copy(element: Element) {
  const data = new Map<string, string>();
  fireEvent.copy(element, { clipboardData: { setData: (type: string, value: string) => data.set(type, value) } });
  return data;
}

it('excludes status, receipts and control labels from a mixed native copy and quote while retaining prose and real output', () => {
  const { container } = render(<PortalContainerProvider container={document.body}>
    <article><p>First answer</p><p role="status">Restored 3 files</p><p data-ui-notice="">Read lines 1–20</p>
      <section><header data-ui-notice="">Tool output</header><pre>{'  real output\n    next line'}</pre></section>
      <p>Final answer</p><div data-transcript-selection-exclude=""><button>Copied reply</button></div></article>
  </PortalContainerProvider>);
  const article = container.querySelector('article')!;
  const selection = select(article);
  expect(selectedContentText(selection)).toBe('First answer\n  real output\n    next line\nFinal answer');
  const result = copy(article);
  expect(result.get('text/plain')).toBe('First answer\n  real output\n    next line\nFinal answer');
  expect(result.get('text/html')).not.toMatch(/Restored|Read lines|Tool output|Copied reply/);
  expect(screen.getByRole('status').textContent).toBe('Restored 3 files');
});

it('does not copy a status-only selection, including a nested text node', () => {
  render(<PortalContainerProvider container={document.body}><p role="alert"><span>Unable to connect</span></p></PortalContainerProvider>);
  const text = screen.getByText('Unable to connect'); select(text);
  expect(copy(text).get('text/plain')).toBe('');
  expect(screen.getByRole('alert').textContent).toBe('Unable to connect');
});

it('preserves actual queued question text in a live status region', () => {
  render(<PortalContainerProvider container={document.body}>
    <div role="status"><span>Next question</span><p data-ui-copy-content="">Please explain this code</p></div>
  </PortalContainerProvider>);
  const status = screen.getByRole('status'); select(status);
  expect(copy(status).get('text/plain')).toBe('Please explain this code');
});

it('leaves editor and plain code copying native when no UI notice is selected', () => {
  const onCopy = vi.fn();
  render(<PortalContainerProvider container={document.body}>
    <label>Input instructions<Input defaultValue="Keep my draft" onCopy={onCopy} /></label><pre>{'const value = 1;\n  keepIndent();'}</pre>
  </PortalContainerProvider>);
  const input = screen.getByRole('textbox');
  expect(copy(input).size).toBe(0); expect(onCopy).toHaveBeenCalledOnce();
  const pre = screen.getByText('const value = 1; keepIndent();'); select(pre);
  expect(copy(pre).size).toBe(0);
  expect(selectedContentText(document.getSelection())).toBe('const value = 1;\n  keepIndent();');
});

it.each([false, true])('preserves the command/output line boundary when filtering UI from a copy (crossCard=%s)', crossCard => {
  const { container } = render(<PortalContainerProvider container={document.body}>
    <article><p>Before command</p><section><header data-ui-notice="">Run checks</header>
      <CommandOutput command="npm test" output={'PASS\n  details'} running={false} />
    </section><p>After command</p></article>
  </PortalContainerProvider>);
  const selected = container.querySelector(crossCard ? 'article' : 'pre')!;
  select(selected);
  const expected = crossCard ? 'Before command\nnpm test\nPASS\n  details\nAfter command' : 'npm test\nPASS\n  details';
  expect(copy(selected).get('text/plain')).toBe(expected);
  expect(selectedContentText(document.getSelection())).toBe(expected);
});

it.each([false, true])('retains the Diff copy handler and code reference MIME (split=%s)', split => {
  render(<PortalContainerProvider container={document.body}>
    <DiffView path="src/file.ts" split={split} patch={'@@ -7,2 +7,2 @@\n-old value\n+new value\n same line'} />
  </PortalContainerProvider>);
  const code = [...document.querySelectorAll('code')].find(node => node.textContent === 'old value')!;
  select(code);
  const result = copy(code);
  expect(result.get('text/plain')).toBe('old value');
  expect(JSON.parse(result.get(CODE_REFERENCE_MIME)!)).toEqual({ path: 'src/file.ts', startLine: 7, endLine: 7, text: 'old value', side: 'before' });
});
