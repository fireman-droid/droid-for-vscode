// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { UiEnvironmentProvider } from '@droidvisx/chat-ui/environment';
import { ReplyView } from '@droidvisx/chat-ui/chat/ReplyView';
import { parseMarkdown } from '../../../packages/chat-ui/src/markdown/parseMarkdown';
import { createMarkdownTreeDelta, type MarkdownParseRequest, type MarkdownParseResponse } from '../../../packages/chat-ui/src/markdown/markdownWorkerProtocol';
import { Markdown } from '../../../packages/chat-ui/src/content/Markdown';
import { ContentProvider } from '../../../packages/chat-ui/src/content/context';

vi.mock('../../../packages/chat-ui/src/markdown/markdownWorkerSource', () => ({ markdownWorkerSource: 'local test worker' }));

class ControlledWorker {
  static instances: ControlledWorker[] = [];
  readonly requests: MarkdownParseRequest[] = [];
  delta = createMarkdownTreeDelta();
  onmessage: ((event: MessageEvent<MarkdownParseResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  terminated = false;
  constructor() { ControlledWorker.instances.push(this); }
  postMessage(value: MarkdownParseRequest) { this.requests.push(value); }
  terminate() { this.terminated = true; }
  complete() {
    const request = this.requests.at(-1)!;
    if (request.reset) this.delta = createMarkdownTreeDelta();
    this.onmessage?.({ data: { id: request.id, nodes: this.delta(parseMarkdown(request.text, request.thinking)) } } as MessageEvent<MarkdownParseResponse>);
  }
}
const padding = Array.from({ length: 120 }, (_, index) => `Paragraph ${index}: ${'a complete local sentence. '.repeat(5)}`).join('\n\n');
beforeEach(() => {
  ControlledWorker.instances = [];
  vi.stubGlobal('Worker', ControlledWorker);
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = vi.fn(() => 'blob:local-markdown');
    static revokeObjectURL = vi.fn();
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('coalesces appends and resolves whole-document references, loose lists, tables, math, code and copied source at completion', async () => {
  const prefix = `[Earlier reference][docs]\n\n${padding}\n\n- First paragraph\n\n  Continued in the same item\n\n- Second item\n\n`;
  const text = `${prefix}| Column | Value |\n| --- | --- |\n| Kept | Whole |\n\nFormula $x^2$.\n\n\`\`\`typescript\nconst finalValue = 42;\n\`\`\`\n\n[docs]: https://example.invalid/final\n\n<script>unsafe()</script>`;
  const copyText = vi.fn(async () => {});
  const view = (source: string, streaming: boolean) => <UiEnvironmentProvider value={{ assistantName: 'Droid', copyText }}>
    <ReplyView replyText={source} running={streaming}><Markdown text={source} streaming={streaming} /></ReplyView>
  </UiEnvironmentProvider>;
  const { rerender, container } = render(view(prefix, true));
  const worker = ControlledWorker.instances[0]!;
  rerender(view(`${prefix}| Column`, true));
  rerender(view(text, false));
  expect(worker.requests).toHaveLength(1);
  expect(container.querySelector('.markdown-content')?.getAttribute('aria-busy')).toBe('true');
  act(() => worker.complete());
  expect(worker.requests).toHaveLength(2);
  expect(worker.requests[1]!.text).toBe(text);
  act(() => worker.complete());
  expect(worker.terminated).toBe(true);
  await waitFor(() => expect(container.querySelector('.markdown-content')?.hasAttribute('aria-busy')).toBe(false));
  expect(screen.getByRole('link', { name: 'Earlier reference' }).getAttribute('href')).toBe('https://example.invalid/final');
  expect(screen.getAllByRole('listitem')).toHaveLength(2);
  expect(screen.getAllByRole('listitem')[0]!.querySelectorAll('p')).toHaveLength(2);
  expect(screen.getByRole('table').textContent).toContain('Whole');
  expect(screen.getByRole('math', { hidden: true }).querySelector('annotation')?.textContent).toBe('x^2');
  expect(screen.getByText('const', { exact: true })).toBeTruthy();
  expect(screen.getByRole('region', { name: 'typescript code' }).textContent).toBe('const finalValue = 42;\n');
  expect(container.querySelector('script')).toBeNull();
  expect(container.textContent).not.toContain('unsafe()');
  fireEvent.click(screen.getByRole('button', { name: 'Copy reply' }));
  await waitFor(() => expect(copyText).toHaveBeenCalledWith(text));
});

it('preserves the selected earlier DOM node while later paragraphs stream', () => {
  const source = `Selected earlier text.\n\n${padding}\n\n`;
  const { rerender, container, unmount } = render(<Markdown text={source} streaming />);
  const worker = ControlledWorker.instances[0]!;
  act(() => worker.complete());
  const paragraph = container.querySelector('p')!;
  const selection = window.getSelection()!;
  const range = document.createRange();
  range.selectNodeContents(paragraph);
  selection.removeAllRanges();
  selection.addRange(range);
  rerender(<Markdown text={`${source}One more complete paragraph.`} streaming />);
  act(() => worker.complete());
  expect(container.querySelector('p')).toBe(paragraph);
  expect(selection.toString()).toBe('Selected earlier text.');
  selection.removeAllRanges();
  unmount();
  expect(worker.terminated).toBe(true);
});

it('renders Mermaid only after the final background revision has settled', async () => {
  const renderDiagram = vi.fn(async () => ({ ok: true as const,
    svg: '<svg xmlns="http://www.w3.org/2000/svg"><text>Complete diagram</text></svg>', css: '' }));
  const source = `${padding}\n\n\`\`\`mermaid\ngraph LR\n  A --> B\n\`\`\``;
  const view = (text: string, streaming: boolean) => <ContentProvider value={{ workspaceRoot: null, theme: 'dark', renderDiagram }}>
    <Markdown text={text} streaming={streaming} />
  </ContentProvider>;
  const { rerender } = render(view(source.slice(0, -10), true));
  const worker = ControlledWorker.instances[0]!;
  rerender(view(source, false));
  act(() => worker.complete());
  expect(renderDiagram).not.toHaveBeenCalled();
  act(() => worker.complete());
  expect(await screen.findByRole('img', { name: 'Mermaid diagram' })).toBeTruthy();
  expect(renderDiagram).toHaveBeenCalledExactlyOnceWith('graph LR\n  A --> B\n', 'dark');
});

it('cancels a replaced reply and never displays its late result', () => {
  const { rerender, container } = render(<Markdown text={`OLD REPLY\n\n${padding}`} streaming />);
  const old = ControlledWorker.instances[0]!;
  act(() => old.complete());
  expect(container.textContent).toContain('OLD REPLY');
  rerender(<Markdown text={`OLD REPLY\n\n${padding}\n\nStill arriving`} streaming />);
  rerender(<Markdown text={`NEW REPLY\n\n${padding}`} streaming />);
  expect(old.terminated).toBe(true);
  expect(container.textContent).not.toContain('OLD REPLY');
  act(() => old.complete());
  expect(container.textContent).not.toContain('OLD REPLY');
  act(() => ControlledWorker.instances[1]!.complete());
  expect(container.textContent).toContain('NEW REPLY');
});

it('falls back visibly to complete synchronous Markdown when Worker creation is unavailable', () => {
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.stubGlobal('Worker', class { constructor() { throw new Error('Workers disabled'); } });
  const { container } = render(<Markdown text={`# Complete fallback\n\n${padding}`} streaming />);
  expect(screen.getByRole('heading', { name: 'Complete fallback' })).toBeTruthy();
  expect(container.textContent).toContain('Paragraph 119:');
  expect(container.querySelector('.markdown-content')?.hasAttribute('aria-busy')).toBe(false);
  expect(warning).toHaveBeenCalledWith(expect.stringContaining('synchronous renderer'), expect.any(Error));
});

it('queues several restored replies through one worker, removes an unmounted waiting reply and isolates reference definitions', async () => {
  const sources = [1, 2, 3].map((id) => `[Shared reference][docs]\n\n${padding}\n\n[docs]: https://example.invalid/history-${id}`);
  const view = (ids: number[]) => <>{ids.map((id) => <Markdown key={id} text={sources[id - 1]!} />)}</>;
  const { rerender, container } = render(view([1, 2, 3]));
  expect(screen.getAllByRole('status')).toHaveLength(3);
  expect(ControlledWorker.instances).toHaveLength(1);
  const worker = ControlledWorker.instances[0]!;
  expect(worker.requests).toHaveLength(1);
  rerender(view([1, 3]));
  act(() => worker.complete());
  expect(worker.requests).toHaveLength(2);
  expect(worker.requests[1]).toMatchObject({ text: sources[2], reset: true });
  act(() => worker.complete());
  expect(worker.terminated).toBe(true);
  await waitFor(() => expect(container.querySelector('[data-markdown-pending]')).toBeNull());
  expect(screen.getAllByRole('link', { name: 'Shared reference' }).map((link) => link.getAttribute('href')))
    .toEqual(['https://example.invalid/history-1', 'https://example.invalid/history-3']);
  expect(screen.getAllByText(/^Paragraph 119:/)).toHaveLength(2);
});

it('releases an active unmounted history task and mounts a replacement in bounded batches', async () => {
  const first = `OLD HISTORY\n\n${padding}`;
  const second = `NEW HISTORY\n\n${padding}`;
  const { rerender, container } = render(<Markdown text={first} />);
  const old = ControlledWorker.instances[0]!;
  rerender(<Markdown text={second} />);
  expect(old.terminated).toBe(true);
  expect(container.textContent).not.toContain('OLD HISTORY');
  act(() => old.complete());
  const current = ControlledWorker.instances[1]!;
  act(() => current.complete());
  expect(container.textContent).toContain('NEW HISTORY');
  expect(container.textContent).not.toContain('Paragraph 119:');
  await waitFor(() => expect(container.textContent).toContain('Paragraph 119:'));
  expect(current.terminated).toBe(true);
  // A fully mounted previous reply must not donate its entire mount budget.
  rerender(<Markdown text={first} />);
  act(() => ControlledWorker.instances[2]!.complete());
  expect(container.textContent).not.toContain('NEW HISTORY');
  expect(container.textContent).not.toContain('Paragraph 119:');
  await waitFor(() => expect(container.querySelector('[data-markdown-pending]')).toBeNull());
  expect(container.textContent).toContain('Paragraph 119:');
});
