import { useMemo } from 'react';
import { inlineDiffLines, type InlineDiffLine } from './inlineDiffLines';
import { highlightCode } from '../markdown/highlightCode';

const languages: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript', json: 'json',
  css: 'css', html: 'xml', py: 'python', sh: 'bash', md: 'markdown', yml: 'yaml', yaml: 'yaml',
};
function Code({ text, language }: { text: string; language?: string }) {
  const html = useMemo(() => language ? highlightCode(text, language) : null, [text, language]);
  return html === null ? <code>{text || ' '}</code> : <code dangerouslySetInnerHTML={{ __html: html || ' ' }} />;
}
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
export function DiffView({ patch, path, split = false, limit }: {
  patch: string; path: string; split?: boolean; limit?: number;
}) {
  const all = useMemo(() => inlineDiffLines(patch), [patch]);
  const lines = limit === undefined ? all : all.slice(0, limit);
  const language = languages[path.split('.').at(-1) ?? ''];
  if (split) return <div className="review-diff markdown-content" role="region" aria-label={`Diff for ${path}`} tabIndex={0}>
    <div className="review-split-labels"><span>Before</span><span>After</span></div>
    {splitDiffRows(lines).map((row, index) => row.header !== undefined
      ? <div key={index} data-diff-hunk className="review-hunk">{row.header}</div>
      : <div key={index} className="review-split-row">{(['left', 'right'] as const).map((side) => {
        const line = row[side];
        return <div key={side} className={`review-diff-cell ${line ? `diff-${line.kind}` : 'diff-empty'}`}>
          <span className="diff-number" aria-hidden>{line && (side === 'left' ? line.before : line.after)}</span>
          <span className="diff-sign" aria-hidden>{line?.kind === 'remove' ? '−' : line?.kind === 'add' ? '+' : ''}</span>
          {line ? <Code text={line.text} language={language} /> : null}
        </div>;
      })}</div>)}
  </div>;
  return <div className="review-diff markdown-content" role="region" aria-label={`Diff for ${path}`} tabIndex={0}>
    {lines.map((line, index) => line.kind === 'hunk' || line.kind === 'note'
      ? <div key={index} data-diff-hunk className="review-hunk">{line.text}</div>
      : <div key={index} className={`review-unified-row diff-${line.kind}`}>
        <span className="diff-number" aria-hidden>{line.before}</span>
        <span className="diff-number" aria-hidden>{line.after}</span>
        <span className="diff-sign" aria-hidden>{line.kind === 'remove' ? '−' : line.kind === 'add' ? '+' : ''}</span>
        <Code text={line.text} language={language} />
      </div>)}
  </div>;
}
