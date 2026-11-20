// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DiffView, findDiffChange, splitDiffRows } from '../../src/review/DiffView';
import { inlineDiffLines } from '../../src/review/inlineDiffLines';
import { CODE_REFERENCE_MIME } from '../../src/chat/codeReferences';

const observers: ViewportObserver[] = [];
class ViewportObserver {
  readonly elements = new Set<Element>();
  constructor(private readonly callback: IntersectionObserverCallback, readonly options?: IntersectionObserverInit) { observers.push(this); }
  observe(element: Element) { this.elements.add(element); }
  unobserve(element: Element) { this.elements.delete(element); }
  disconnect() { this.elements.clear(); }
  reveal(elements = [...this.elements]) {
    act(() => this.callback(elements.map((target) => ({ target, isIntersecting: true }) as IntersectionObserverEntry), this as unknown as IntersectionObserver));
  }
  hide(elements = [...this.elements]) {
    act(() => this.callback(elements.map((target) => ({ target, isIntersecting: false }) as IntersectionObserverEntry), this as unknown as IntersectionObserver));
  }
}
beforeEach(() => { observers.length = 0; vi.stubGlobal('IntersectionObserver', ViewportObserver); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); document.getSelection()?.removeAllRanges(); });
const patch = (prefix: string, count = 300) => `@@ -0,0 +1,${count} @@\n${Array.from({ length: count }, (_, index) => `+${prefix}-${index}`).join('\n')}`;

it.each([true, false])('copies one source side with exact lines and a code-reference payload (split=%s)', split => {
  render(<DiffView path="src/file.ts" split={split} patch={'@@ -7,2 +7,2 @@\n-old value\n+new value\n same line'} />);
  const code = [...document.querySelectorAll('code')].find(node => node.textContent === 'old value')!;
  const range = document.createRange(); range.selectNodeContents(code);
  document.getSelection()!.addRange(range);
  const data = new Map<string, string>();
  fireEvent.copy(code, { clipboardData: { setData: (type: string, text: string) => data.set(type, text) } });
  expect(data.get('text/plain')).toBe('old value');
  expect(JSON.parse(data.get(CODE_REFERENCE_MIME)!)).toEqual({ path: 'src/file.ts', startLine: 7, endLine: 7, text: 'old value', side: 'before' });
});

it('keeps excerpts without recorded line numbers as plain text', () => {
  render(<DiffView path="src/file.ts" patch={'@@\n+new value'} />);
  const code = document.querySelector('code')!;
  const range = document.createRange(); range.selectNodeContents(code);
  document.getSelection()!.addRange(range);
  const data = new Map<string, string>();
  fireEvent.copy(code, { clipboardData: { setData: (type: string, text: string) => data.set(type, text) } });
  expect(data.get('text/plain')).toBe('new value');
  expect(data.has(CODE_REFERENCE_MIME)).toBe(false);
});

it('defers long diff content until it approaches the viewport and preserves the final line', () => {
  render(<DiffView patch={patch('complete')} path="large.txt" />);
  expect(screen.queryByText('complete-0')).toBeNull();
  const observer = observers[0]!;
  observer.reveal([[...observer.elements][0]!]);
  expect(screen.getByText('complete-0')).toBeDefined();
  expect(screen.queryByText('complete-299')).toBeNull();
  observer.reveal();
  expect(screen.getByText('complete-299')).toBeDefined();
  expect(document.querySelectorAll('code')).toHaveLength(300);
});

it('keeps every change target available before its content is mounted', () => {
  render(<DiffView patch={`${patch('first')}\n@@ -600 +600 @@\n-last-before\n+last-after`} path="hunks.txt" />);
  const chunks = [...document.querySelectorAll<HTMLElement>('[data-diff-changes]')];
  vi.spyOn(chunks[0]!, 'getBoundingClientRect').mockReturnValue({ top: 100, height: 64 * 22 } as DOMRect);
  vi.spyOn(chunks[1]!, 'getBoundingClientRect').mockReturnValue({ top: 7000, height: 2 * 22 } as DOMRect);
  expect(findDiffChange(document.body, 108, 1)).toBe(7000);
  expect(findDiffChange(document.body, 6992, -1)).toBe(100);
  expect(screen.queryByText('last-after')).toBeNull();
  const observer = observers[0]!;
  observer.reveal([[...observer.elements].at(-1)!]);
  expect(screen.getByText((_, element) => element?.tagName === 'CODE' && element.textContent === 'last-before')).toBeDefined();
  expect(screen.getByText((_, element) => element?.tagName === 'CODE' && element.textContent === 'last-after')).toBeDefined();
});

it('navigates separate edits within the same deferred block by their actual line offsets', () => {
  render(<DiffView patch={'@@ -1,4 +1,4 @@\n first\n-before-one\n+after-one\n between\n-before-two\n+after-two'} path="edits.txt" />);
  const chunk = document.querySelector<HTMLElement>('[data-diff-changes]')!;
  vi.spyOn(chunk, 'getBoundingClientRect').mockReturnValue({ top: 100, height: 6 * 22 } as DOMRect);
  expect(findDiffChange(document.body, 108, 1)).toBe(122);
  expect(findDiffChange(document.body, 130, 1)).toBe(188);
  expect(findDiffChange(document.body, 180, -1)).toBe(122);
  expect(findDiffChange(document.body, 196, 1)).toBeNull();
});

it('replaces revealed content on live patch updates and does not carry it into a different file', () => {
  const view = render(<DiffView patch={patch('original')} path="first.txt" />);
  observers[0]!.reveal();
  view.rerender(<DiffView patch={patch('updated')} path="first.txt" />);
  expect(screen.queryByText('original-299')).toBeNull();
  expect(screen.getByText('updated-299')).toBeDefined();
  view.rerender(<DiffView patch={patch('different')} path="second.txt" />);
  expect(screen.queryByText('updated-299')).toBeNull();
  expect(screen.queryByText('different-299')).toBeNull();
  observers[0]!.reveal();
  expect(screen.getByText('different-299')).toBeDefined();
});

it('keeps short limited chat previews immediate and respects the requested line boundary', () => {
  render(<DiffView patch={patch('preview')} path="preview.txt" limit={3} />);
  expect(screen.getByText('preview-0')).toBeDefined();
  expect(screen.getByText('preview-1')).toBeDefined();
  expect(screen.queryByText('preview-2')).toBeNull();
  expect(observers).toHaveLength(0);
});

it('preserves both sides and tail content when changing to split view', () => {
  const edit = `@@ -1,150 +1,150 @@\n${Array.from({ length: 150 }, (_, index) => `-before-${index}`).join('\n')}\n${Array.from({ length: 150 }, (_, index) => `+after-${index}`).join('\n')}`;
  const view = render(<DiffView patch={edit} path="change.txt" />);
  observers[0]!.reveal();
  view.rerender(<DiffView patch={edit} path="change.txt" split />);
  observers[0]!.reveal();
  expect(screen.getByText((_, element) => element?.tagName === 'CODE' && element.textContent === 'before-0')).toBeDefined();
  expect(screen.getByText((_, element) => element?.tagName === 'CODE' && element.textContent === 'after-0')).toBeDefined();
  expect(screen.getByText((_, element) => element?.tagName === 'CODE' && element.textContent === 'before-149')).toBeDefined();
  expect(screen.getByText((_, element) => element?.tagName === 'CODE' && element.textContent === 'after-149')).toBeDefined();
  expect(document.querySelectorAll('code')).toHaveLength(300);
});

it('aligns an extracted method after an inserted block without losing source order or line numbers', () => {
  const before = [
    'async function processPracticeGeneration(request: Request) {',
    '  const exercise = await generateExercise(request);',
    '  return exercise;',
    '}',
  ];
  const added = [
    'async function preparePractice(request: Request) {',
    ...Array.from({ length: 80 }, (_, index) => `  const preparation${index} = ${index};`),
    '  return request;',
    '}',
    'async function processPracticeGeneration(request: PracticeRequest) {',
    '  const exercise = await generateExercise(request);',
    '  return exercise;',
    '}',
  ];
  const edit = `@@ -10,4 +10,${added.length} @@\n${before.map(line => `-${line}`).join('\n')}\n${added.map(line => `+${line}`).join('\n')}`;
  const rows = splitDiffRows(inlineDiffLines(edit));
  const method = rows.find(row => row.left?.text === before[0]);
  expect(method?.right?.text).toBe(added[83]);
  expect(rows.filter(row => row.left).map(row => [row.left!.text, row.left!.before])).toEqual(before.map((line, index) => [line, index + 10]));
  expect(rows.filter(row => row.right).map(row => [row.right!.text, row.right!.after])).toEqual(added.map((line, index) => [line, index + 10]));
});

it('aligns surviving lines after deletions and retains their source order', () => {
  const edit = '@@ -20,4 +20,2 @@\n-prepareOne();\n-prepareTwo();\n-const first = oldValue;\n-return first;\n+const first = newValue;\n+return first;';
  const rows = splitDiffRows(inlineDiffLines(edit)).slice(1);
  expect(rows.map(row => [row.left?.text ?? null, row.right?.text ?? null])).toEqual([
    ['prepareOne();', null], ['prepareTwo();', null],
    ['const first = oldValue;', 'const first = newValue;'], ['return first;', 'return first;'],
  ]);
});

it.each([true, false])('highlights words against the aligned replacement rather than an inserted line (split=%s)', split => {
  const edit = '@@ -1 +1,2 @@\n-const generated = oldValue;\n+preparePractice();\n+const generated = newValue;';
  render(<DiffView path="src/file.ts" split={split} patch={edit} />);
  const codes = [...document.querySelectorAll('code')];
  const before = codes.find(code => code.textContent === 'const generated = oldValue;')!;
  const after = codes.find(code => code.textContent === 'const generated = newValue;')!;
  expect(before.querySelector('.diff-word-change')?.textContent).toBe('oldValue');
  expect(after.querySelector('.diff-word-change')?.textContent).toBe('newValue');
  expect(codes.find(code => code.textContent === 'preparePractice();')!.querySelector('.diff-word-change')).toBeNull();
});

it('preserves all lines in very large replacement blocks', () => {
  const before = Array.from({ length: 501 }, (_, index) => `-old${index}`);
  const after = Array.from({ length: 501 }, (_, index) => `+new${index}`);
  const rows = splitDiffRows(inlineDiffLines(`@@ -1,501 +1,501 @@\n${[...before, ...after].join('\n')}`));
  expect(rows.filter(row => row.left).map(row => row.left!.text)).toEqual(before.map(line => line.slice(1)));
  expect(rows.filter(row => row.right).map(row => row.right!.text)).toEqual(after.map(line => line.slice(1)));
});

it.each([
  ['left', 'before', 11, 'const first = oldValue;\nreturn first;'],
  ['right', 'after', 13, 'const first = newValue;\ninsertOne();\ninsertTwo();\nreturn first;'],
] as const)('copies a contiguous %s selection across inserted split rows', (side, referenceSide, endLine, text) => {
  const edit = '@@ -10,2 +10,4 @@\n-const first = oldValue;\n-return first;\n+const first = newValue;\n+insertOne();\n+insertTwo();\n+return first;';
  render(<DiffView path="src/file.ts" split patch={edit} />);
  const code = [...document.querySelectorAll<HTMLElement>(`.review-diff-cell[data-side="${side}"] code`)];
  const range = document.createRange();
  range.setStart(code[0]!, 0);
  range.setEnd(code.at(-1)!, code.at(-1)!.childNodes.length);
  document.getSelection()!.addRange(range);
  const data = new Map<string, string>();
  fireEvent.copy(code[0]!, { clipboardData: { setData: (type: string, text: string) => data.set(type, text) } });
  expect(data.get('text/plain')).toBe(text);
  expect(JSON.parse(data.get(CODE_REFERENCE_MIME)!)).toEqual({
    path: 'src/file.ts', startLine: 10, endLine, text, side: referenceSide,
  });
});

it('renders generated long code lines in full without dropping text', () => {
  const generated = `const generated = "${'x'.repeat(20_000)}";`;
  render(<DiffView patch={`@@ -0,0 +1 @@\n+${generated}`} path="generated.ts" />);
  expect(document.querySelector('code')?.textContent).toBe(generated);
});

it('recycles code while traversing a large full-file diff and can return to its beginning', () => {
  render(<DiffView patch={patch('full-file', 20_000)} path="large.txt" split />);
  const observer = observers[0]!;
  const chunks = [...observer.elements];
  for (const index of [0, 100, chunks.length - 1]) {
    observer.hide();
    observer.reveal([chunks[index]!]);
    expect(document.querySelectorAll('code').length).toBeLessThanOrEqual(64);
  }
  expect(screen.getByText('full-file-19999')).toBeDefined();
  expect(screen.queryByText('full-file-0')).toBeNull();
  observer.hide();
  observer.reveal([chunks[0]!]);
  expect(screen.getByText('full-file-0')).toBeDefined();
  expect(screen.queryByText('full-file-19999')).toBeNull();
});

it('retains a scrolled-away native text selection until the selection is cleared', () => {
  render(<DiffView patch={patch('selectable')} path="large.txt" />);
  const observer = observers[0]!;
  const firstChunk = [...observer.elements][0]!;
  observer.reveal([firstChunk]);
  const range = document.createRange();
  range.selectNodeContents(screen.getByText('selectable-0'));
  document.getSelection()!.addRange(range);
  observer.hide([firstChunk]);
  expect(document.getSelection()!.toString()).toBe('selectable-0');
  expect(screen.getByText('selectable-0')).toBeDefined();
  act(() => { document.getSelection()!.removeAllRanges(); document.dispatchEvent(new Event('selectionchange')); });
  expect(screen.queryByText('selectable-0')).toBeNull();
});

it('uses the enclosing vertical viewport instead of a horizontal-only diff scroller', () => {
  const viewport = document.createElement('div');
  viewport.style.overflowY = 'auto';
  document.body.append(viewport);
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLElement) { return this === viewport ? 20_000 : 1_000; });
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) { return this === viewport ? 600 : 1_000; });
  render(<DiffView patch={patch('viewport')} path="large.txt" />, { container: viewport });
  expect(observers[0]!.options?.root).toBe(viewport);
});
