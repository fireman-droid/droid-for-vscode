import { createContext, useContext, useEffect, useLayoutEffect, type ReactNode, type RefObject } from 'react';
import type { InlineDiffLine } from './inlineDiffLines';
import type { DiffRow } from './DiffView';

export interface DiffQuestionSelection {
  path: string;
  side: 'before' | 'after';
  startLine: number | null;
  endLine: number | null;
  text: string;
  context: string;
}
export interface DiffQuestionAnchor {
  key: string;
  source: string;
  startRow: number;
  row: number;
  selection: DiffQuestionSelection;
}
interface DiffQuestionContextValue {
  enabled: boolean;
  anchor: DiffQuestionAnchor | null;
  select(anchor: DiffQuestionAnchor): void;
  close(): void;
}
export const DiffQuestionContext = createContext<DiffQuestionContextValue | null>(null);
export const DiffQuestionContentContext = createContext<ReactNode>(null);

function QuestionSlot() { return <div className="review-question-slot">{useContext(DiffQuestionContentContext)}</div>; }

/** Extract from source rows, never the interleaved before/after DOM text. */
function readSelection(root: HTMLElement, path: string, rows: readonly DiffRow[] | null, lines: readonly InlineDiffLine[]): Omit<DiffQuestionAnchor, 'key' | 'source'> | null {
  const selection = root.ownerDocument.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount ||
    !root.contains(selection.anchorNode) || !root.contains(selection.focusNode)) return null;
  const element = selection.anchorNode instanceof Element ? selection.anchorNode : selection.anchorNode?.parentElement;
  const cell = element?.closest<HTMLElement>('.review-diff-cell, .review-unified-row');
  if (!cell) return null;
  const side = rows ? cell.dataset.side === 'left' ? 'before' : 'after' : cell.classList.contains('diff-remove') ? 'before' : 'after';
  const sideKey = side === 'before' ? 'left' : 'right';
  const lineAt = (index: number) => {
    const line = rows ? rows[index]?.[sideKey] : lines[index];
    return line && line.kind !== 'hunk' && line.kind !== 'note' && line.kind !== (side === 'before' ? 'add' : 'remove') ? line : null;
  };
  const range = selection.getRangeAt(0);
  let first: { row: number; offset: number } | undefined;
  let last: { row: number; offset: number } | undefined;
  const selector = rows ? `.review-diff-cell[data-side='${sideKey}'] .review-diff-code > code` : '.review-unified-row > code';
  for (const code of root.querySelectorAll<HTMLElement>(selector)) {
    const row = Number(code.closest<HTMLElement>('[data-diff-row]')!.dataset.diffRow);
    const line = lineAt(row);
    if (!line || !range.intersectsNode(code)) continue;
    const selected = root.ownerDocument.createRange();
    selected.selectNodeContents(code);
    if (range.compareBoundaryPoints(Range.START_TO_START, selected) > 0) selected.setStart(range.startContainer, range.startOffset);
    if (range.compareBoundaryPoints(Range.END_TO_END, selected) < 0) selected.setEnd(range.endContainer, range.endOffset);
    if (selected.collapsed && !(first && code.contains(range.endContainer))) continue;
    const prefix = root.ownerDocument.createRange();
    prefix.selectNodeContents(code);
    prefix.setEnd(selected.startContainer, selected.startOffset);
    const start = Math.min(prefix.toString().length, line.text.length);
    first ??= { row, offset: start };
    last = { row, offset: Math.min(start + selected.toString().length, line.text.length) };
  }
  if (!first || !last) return null;
  const text: string[] = [];
  for (let row = first.row; row <= last.row; row++) {
    const line = lineAt(row);
    if (line) text.push(line.text.slice(row === first.row ? first.offset : 0, row === last.row ? last.offset : undefined));
  }
  if (!text.join('\n').trim()) return null;
  const nearby: string[] = [];
  for (let row = Math.max(0, first.row - 5); row < Math.min((rows ?? lines).length, last.row + 6); row++) {
    const source = rows ? [rows[row]!.left, rows[row]!.right].filter((line, index) => line && (index === 0 || line !== rows[row]!.left)) : [lines[row]];
    for (const line of source) if (line) nearby.push(`${line.kind === 'remove' ? '-' : line.kind === 'add' ? '+' : ' '} ${line.before ?? ''}:${line.after ?? ''} ${line.text}`);
  }
  const startLine = lineAt(first.row)![side];
  const endLine = lineAt(last.row)![side];
  return { startRow: first.row, row: last.row, selection: { path, side, startLine: startLine === null || endLine === null ? null : startLine,
    endLine: startLine === null || endLine === null ? null : endLine, text: text.join('\n'), context: nearby.join('\n') } };
}

export function useDiffQuestion(root: RefObject<HTMLDivElement | null>, path: string, source: string, key: string, rows: readonly DiffRow[] | null, lines: readonly InlineDiffLine[]) {
  const question = useContext(DiffQuestionContext);
  const anchor = question?.anchor;
  const current = anchor?.key === key && anchor.source === source ? anchor : null;
  const select = question?.select;
  const close = question?.close;
  const enabled = question?.enabled;
  useEffect(() => {
    if (anchor?.key === key && anchor.source !== source) close?.();
  }, [anchor, key, source, close]);
  useEffect(() => {
    const diff = root.current;
    if (!diff || !enabled || !select) return;
    let frame = 0;
    const capture = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const selected = readSelection(diff, path, rows, lines);
        if (selected) select({ ...selected, key, source });
      });
    };
    diff.ownerDocument.addEventListener('pointerup', capture);
    diff.addEventListener('keyup', capture);
    return () => { cancelAnimationFrame(frame); diff.ownerDocument.removeEventListener('pointerup', capture); diff.removeEventListener('keyup', capture); };
  }, [root, enabled, select, key, source, path, rows, lines]);
  useLayoutEffect(() => {
    const diff = root.current;
    if (!diff || !question) return;
    const update = () => diff.style.setProperty('--diff-question-viewport', `${diff.clientWidth}px`);
    const observer = new ResizeObserver(update);
    observer.observe(diff); update();
    return () => observer.disconnect();
  }, [root, !!question]);
  return current ? { row: current.row, startRow: current.startRow, side: current.selection.side,
    content: <div className="review-question-row" data-side={current.selection.side}><QuestionSlot /></div> } : null;
}
