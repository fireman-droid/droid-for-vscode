import { memo, useEffect, useLayoutEffect, useMemo, useRef, type CSSProperties, type RefObject } from 'react';
import { formatDiffHunkHeader, inlineDiffLines, type InlineDiffLine } from './inlineDiffLines';
import { highlightCode } from '../markdown/highlightCode';
import { codeLanguageForPath } from '../markdown/codeLanguages';
import { DeferredDiffChunk, useDeferredDiff } from './deferredDiff';
export { findDiffChange } from './diffNavigation';

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
type DiffBlock<T> = { index: number; header: string } | { index: number; rows: readonly T[]; changes: readonly number[] };
function diffBlocks<T>(rows: readonly T[], header: (row: T) => string | undefined, changed: (row: T) => boolean): DiffBlock<T>[] {
  const blocks: DiffBlock<T>[] = [];
  for (let index = 0; index < rows.length;) {
    const text = header(rows[index]!);
    if (text !== undefined) { blocks.push({ index: index++, header: text }); continue; }
    const start = index;
    const changes: number[] = [];
    while (index < rows.length && index - start < 64 && header(rows[index]!) === undefined) {
      if (changed(rows[index]!) && (index === 0 || !changed(rows[index - 1]!))) changes.push(index - start);
      index++;
    }
    blocks.push({ index: start, rows: rows.slice(start, index), changes });
  }
  return blocks;
}
function SplitRow({ row, language }: { row: DiffRow; language?: string }) {
  return <div className="review-split-row">{(['left', 'right'] as const).map((side) => {
    const line = row[side];
    return <div key={side} data-side={side} className={`review-diff-cell ${line ? `diff-${line.kind}` : 'diff-empty'}`}>
      <span className="diff-number" aria-hidden>{line && (side === 'left' ? line.before : line.after)}</span>
      <span className="diff-sign" aria-hidden>{line?.kind === 'remove' ? '−' : line?.kind === 'add' ? '+' : ''}</span>
      <div className="review-diff-code">{line ? <Code text={line.text} language={language} /> : null}</div>
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

function textColumns(text: string): number {
  if (/^[\x20-\x7e]*$/.test(text)) return text.length;
  let columns = 0;
  for (const character of text) {
    if (character === '\t') columns += 8 - columns % 8;
    // A conservative width for wide/fallback glyphs prevents an offscreen
    // non-ASCII line from being clipped without shaping the entire file.
    else columns += character.codePointAt(0)! > 0x7e ? 2 : 1;
  }
  return columns;
}

function SplitScrollbars({ root, before, after }: { root: RefObject<HTMLDivElement | null>; before: number; after: number }) {
  const scrollbars = useRef<Array<HTMLDivElement | null>>([]);
  useEffect(() => {
    const diff = root.current;
    if (!diff) return;
    const scrollCode = (event: WheelEvent) => {
      // Native horizontal gestures over code should move that side's scrollbar
      // too. Vertical wheel input remains with the shared file viewport.
      if (!event.shiftKey && Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
      const rectangle = diff.getBoundingClientRect();
      const scrollbar = scrollbars.current[event.clientX < rectangle.left + rectangle.width / 2 ? 0 : 1];
      if (!scrollbar || (event.target instanceof Node && scrollbar.contains(event.target))) return;
      const delta = event.deltaX || event.deltaY;
      const previous = scrollbar.scrollLeft;
      scrollbar.scrollLeft += delta * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? scrollbar.clientWidth : 1);
      if (scrollbar.scrollLeft !== previous) event.preventDefault();
    };
    diff.addEventListener('wheel', scrollCode, { passive: false });
    return () => diff.removeEventListener('wheel', scrollCode);
  }, [root]);
  useLayoutEffect(() => {
    // Native scroll offsets may be clamped after a shorter live edit. Reflect
    // the actual offsets rather than leaving code shifted beyond its text.
    for (const [index, side] of ['before', 'after'].entries())
      root.current?.style.setProperty(`--diff-${side}-scroll`, `${-(scrollbars.current[index]?.scrollLeft ?? 0)}px`);
  }, [root, before, after]);
  return <div className="review-split-labels">{(['before', 'after'] as const).map((side, index) => <div key={side} className="review-split-heading">
    <span>{side === 'before' ? 'Before' : 'After'}</span>
    <div ref={(element) => { scrollbars.current[index] = element; }} className="review-split-scrollbar"
      role="region" aria-label={`Scroll ${side} code horizontally`} tabIndex={0}
      onScroll={(event) => root.current?.style.setProperty(`--diff-${side}-scroll`, `${-event.currentTarget.scrollLeft}px`)}>
      <div className="review-split-track" style={{ width: `calc(${side === 'before' ? before : after}ch + 16px)` }} />
    </div>
  </div>)}</div>;
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
  const columns = useMemo(() => {
    let before = 0, after = 0;
    for (const line of lines) {
      if (line.kind === 'hunk' || line.kind === 'note') continue;
      const width = textColumns(line.text);
      if (line.kind !== 'add') before = Math.max(before, width);
      if (line.kind !== 'remove') after = Math.max(after, width);
    }
    return { before, after };
  }, [lines]);
  const defer = lines.length > 128;
  const observe = useDeferredDiff(root, defer);
  const language = codeLanguageForPath(path);
  return <div ref={root} className="review-diff markdown-content" data-layout={split ? 'split' : 'unified'}
    style={{ '--diff-code-columns': Math.max(columns.before, columns.after) } as CSSProperties}
    role="region" aria-label={`Diff for ${path}`} tabIndex={0}>
    {split ? <SplitScrollbars key={path} root={root} before={columns.before} after={columns.after} /> : null}
    <div className="review-diff-content" key={`${path}:${split}`}>
      {blocks.map((block) => 'header' in block
        ? <div key={block.index} className="review-hunk" title={block.header}>{formatDiffHunkHeader(block.header)}</div>
        : <DeferredDiffChunk key={block.index} count={block.rows.length} changes={block.changes} defer={defer} observe={observe}>
          {() => block.rows.map((row, index) => split
            ? <SplitRow key={index} row={row as DiffRow} language={language} />
            : <UnifiedRow key={index} line={row as InlineDiffLine} language={language} />)}
        </DeferredDiffChunk>)}
    </div>
  </div>;
});
