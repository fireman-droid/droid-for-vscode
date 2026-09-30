import { Fragment, memo, useMemo, useRef } from 'react';
import { formatDiffHunkHeader, inlineDiffLines, type InlineDiffLine } from './inlineDiffLines';
import { highlightCode } from '../markdown/highlightCode';
import { codeLanguageForPath } from '../markdown/codeLanguages';
import { DeferredDiffChunk, useDeferredDiff } from './deferredDiff';

const Code = memo(function Code({ text, language }: { text: string; language?: string }) {
  // Minified/generated lines remain complete without spending a frame on a
  // syntax grammar for thousands of characters in one line.
  const html = useMemo(() => language && text.length <= 2_000 ? highlightCode(text, { language, detect: false }) : null, [text, language]);
  return html === null ? <code>{text || ' '}</code> : <code dangerouslySetInnerHTML={{ __html: html || ' ' }} />;
});
export interface DiffRow { left: InlineDiffLine | null; right: InlineDiffLine | null; header?: string }
export function splitDiffRows(lines: readonly InlineDiffLine[]): DiffRow[] {
  const rows: DiffRow[] = [];
  for (let i = 0; i < lines.length;) {
    const line = lines[i]!;
    if (line.kind === 'remove' || line.kind === 'add') {
      const removed: InlineDiffLine[] = [];
      const added: InlineDiffLine[] = [];
      while (lines[i]?.kind === 'remove') removed.push(lines[i++]!);
      while (lines[i]?.kind === 'add') added.push(lines[i++]!);
      for (let n = 0; n < Math.max(removed.length, added.length); n++)
        rows.push({ left: removed[n] ?? null, right: added[n] ?? null });
    } else {
      rows.push(line.kind === 'hunk' || line.kind === 'note'
        ? { left: null, right: null, header: line.text }
        : { left: line, right: line });
      i++;
    }
  }
  return rows;
}
type DiffBlock<T> = { index: number; header: string } | { index: number; rows: readonly T[]; changeStart: boolean };
function diffBlocks<T>(rows: readonly T[], header: (row: T) => string | undefined, changed: (row: T) => boolean): DiffBlock<T>[] {
  const blocks: DiffBlock<T>[] = [];
  for (let index = 0; index < rows.length;) {
    const text = header(rows[index]!);
    if (text !== undefined) { blocks.push({ index: index++, header: text }); continue; }
    const start = index++;
    const changeStart = changed(rows[start]!) && (start === 0 || !changed(rows[start - 1]!));
    while (index < rows.length && index - start < 64 && header(rows[index]!) === undefined &&
      !(changed(rows[index]!) && !changed(rows[index - 1]!))) index++;
    blocks.push({ index: start, rows: rows.slice(start, index), changeStart });
  }
  return blocks;
}
function SplitRow({ row, language }: { row: DiffRow; language?: string }) {
  return <div className="review-split-row">{(['left', 'right'] as const).map((side) => {
    const line = row[side];
    return <div key={side} className={`review-diff-cell ${line ? `diff-${line.kind}` : 'diff-empty'}`}>
      <span className="diff-number" aria-hidden>{line && (side === 'left' ? line.before : line.after)}</span>
      <span className="diff-sign" aria-hidden>{line?.kind === 'remove' ? '−' : line?.kind === 'add' ? '+' : ''}</span>
      {line ? <Code text={line.text} language={language} /> : null}
    </div>;
  })}</div>;
}
function UnifiedRow({ line, language }: { line: InlineDiffLine; language?: string }) {
  return <div className={`review-unified-row diff-${line.kind}`}>
    <span className="diff-number" aria-hidden>{line.before}</span>
    <span className="diff-number" aria-hidden>{line.after}</span>
    <span className="diff-sign" aria-hidden>{line.kind === 'remove' ? '−' : line.kind === 'add' ? '+' : ''}</span>
    <Code text={line.text} language={language} />
  </div>;
}
export const DiffView = memo(function DiffView({ patch, path, split = false, limit }: {
  patch: string; path: string; split?: boolean; limit?: number;
}) {
  const root = useRef<HTMLDivElement>(null);
  const all = useMemo(() => inlineDiffLines(patch), [patch]);
  const lines = useMemo(() => limit === undefined ? all : all.slice(0, limit), [all, limit]);
  const blocks = useMemo(() => split
    ? diffBlocks(splitDiffRows(lines), (row) => row.header, (row) => row.left?.kind === 'remove' || row.right?.kind === 'add')
    : diffBlocks(lines, (line) => line.kind === 'hunk' || line.kind === 'note' ? line.text : undefined, (line) => line.kind === 'add' || line.kind === 'remove'), [lines, split]);
  const widthText = useMemo(() => {
    if (split) return '';
    let longestAscii = '';
    const other: string[] = [];
    for (const { text } of lines) {
      // Printable ASCII has fixed character width in the diff's monospace font.
      // One representative avoids laying out the entire offscreen patch just
      // to size its scrollbar. Keep tabs and other scripts for native shaping.
      if (/^[\x20-\x7e]*$/.test(text)) {
        if (text.length > longestAscii.length) longestAscii = text;
      } else other.push(text);
    }
    return [longestAscii, ...other].join('\n');
  }, [lines, split]);
  const defer = lines.length > 128;
  const observe = useDeferredDiff(root, defer);
  const language = codeLanguageForPath(path);
  return <div ref={root} className="review-diff markdown-content" data-layout={split ? 'split' : 'unified'}
    role="region" aria-label={`Diff for ${path}`} tabIndex={0}>
    {split ? <div className="review-split-labels"><span>Before</span><span>After</span></div> : null}
    <div className="review-diff-content" key={`${path}:${split}`}>
      {!split ? <div aria-hidden className="review-diff-width" style={{ height: 0, overflow: 'hidden', visibility: 'hidden',
        whiteSpace: 'pre', paddingLeft: '13ch', paddingRight: 16, userSelect: 'none' }}>{widthText}</div> : null}
      {blocks.map((block) => 'header' in block
        ? <div key={block.index} className="review-hunk" title={block.header}>{formatDiffHunkHeader(block.header)}</div>
        : <Fragment key={block.index}>
          {block.changeStart ? <div data-diff-hunk aria-hidden="true" /> : null}
          <DeferredDiffChunk count={block.rows.length} defer={defer} split={split} observe={observe}>
          {() => block.rows.map((row, index) => split
            ? <SplitRow key={index} row={row as DiffRow} language={language} />
            : <UnifiedRow key={index} line={row as InlineDiffLine} language={language} />)}
        </DeferredDiffChunk></Fragment>)}
    </div>
  </div>;
});
