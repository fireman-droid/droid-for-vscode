import { useContext, useMemo } from 'react';
import { formatDiffHunkHeader, inlineDiffLines } from '@droidvisx/chat-ui/review/inlineDiffLines';
import { INLINE_DIFF_UNAVAILABLE, InlineDiffContext, useInlineDiff } from '../review/useInlineDiff';
import { Button } from '../ui/button';
import { cn } from '../ui/cn';

export function InlineFileDiff({ path, turnId, expanded }: {
  readonly path: string;
  readonly turnId: string;
  readonly expanded: boolean;
}) {
  const { result, retry, refreshing, refreshFailed } = useInlineDiff(path, turnId, expanded);
  const context = useContext(InlineDiffContext);
  const patch = result?.status === 'ready' ? result.patch : '';
  const lines = useMemo(() => inlineDiffLines(patch), [patch]);
  return <section aria-label={`Changes to ${path}`} className="min-w-0 overflow-hidden rounded border border-border text-xs">
    <div className="flex flex-wrap items-center justify-between gap-1 border-b border-border bg-muted/30 px-2 py-1">
      <span title="Workspace comparison, including changes from unconfirmed sources" className="text-[11px] text-muted-foreground">
        {result?.status === 'ready' && result.phase === 'live' ? 'Workspace · before turn → current' : 'Workspace · before turn → after turn'}
      </span>
      {refreshing && result?.status === 'ready' ? <span role="status" className="text-[11px] text-muted-foreground">Updating…</span> : null}
      {result?.status === 'ready' && context?.connected && context.sessionId !== null ? <Button variant="ghost" size="sm" onClick={() => context.port.postMessage({
        type: 'file.openTurnDiff', sessionId: context.sessionId!, turnId, path,
      })}>Open diff in editor</Button> : null}
    </div>
    {refreshFailed ? <div role="status" className="flex flex-wrap items-center gap-2 p-2">
      <span>Could not refresh. Showing the previous diff.</span><Button variant="outline" size="sm" onClick={retry}>Retry</Button>
    </div> : null}
    {result === null ? <p role="status" className="p-2 text-muted-foreground">Loading diff…</p>
      : result.status !== 'ready' ? <div role="status" className="flex flex-wrap items-center gap-2 p-2">
        <span>{INLINE_DIFF_UNAVAILABLE[result.status]}</span><Button variant="outline" size="sm" onClick={retry}>Retry</Button>
      </div> : <>
        {lines.length > 0 ? <div tabIndex={0} role="region" aria-label={`Diff for ${path}`} className="max-h-80 overflow-auto outline-none focus-visible:ring-1 focus-visible:ring-ring">
          <pre className="min-w-max font-mono text-[11px] leading-5"><code>
            {lines.map((line, index) => <span key={index} className={cn('block',
              line.kind === 'add' && 'bg-[var(--vscode-diffEditor-insertedLineBackground,rgba(46,160,67,0.12))]',
              line.kind === 'remove' && 'bg-[var(--vscode-diffEditor-removedLineBackground,rgba(248,81,73,0.12))]')}>
              {line.kind === 'hunk' || line.kind === 'note' ? <span className="block px-2 text-muted-foreground" title={line.text}>{formatDiffHunkHeader(line.text)}</span>
                : <span className="grid grid-cols-[4ch_4ch_2ch_auto] gap-1 pr-2">
                  <span aria-hidden className="text-right text-muted-foreground">{line.before}</span>
                  <span aria-hidden className="text-right text-muted-foreground">{line.after}</span>
                  <span>{line.kind === 'add' ? '+' : line.kind === 'remove' ? '−' : ' '}</span>
                  <span>{line.text || ' '}</span>
                </span>}
            </span>)}
          </code></pre>
        </div> : !result.truncated ? <p className="p-2 text-muted-foreground">No net workspace text changes in this turn.</p> : null}
        {result.truncated ? <p className="p-2 text-muted-foreground">Preview truncated. Open the diff in the editor to see more.</p> : null}
      </>}
  </section>;
}
