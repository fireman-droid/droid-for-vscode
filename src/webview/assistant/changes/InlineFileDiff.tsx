import { useContext, useMemo } from 'react';
import { post } from '../shell/chatIntent';
import { inlineDiffLines } from './inlineDiffLines';
import { INLINE_DIFF_UNAVAILABLE, InlineDiffContext, useInlineDiff } from './useInlineDiff';
import './inlineDiff.css';

export function InlineFileDiff({ path, turnId, expanded }: {
  readonly path: string;
  readonly turnId: string;
  readonly expanded: boolean;
}): React.JSX.Element {
  const { result, retry } = useInlineDiff(path, turnId, expanded);
  const context = useContext(InlineDiffContext);
  const patch = result?.status === 'ready' ? result.patch : '';
  const lines = useMemo(() => inlineDiffLines(patch), [patch]);
  return (
    <section className="dvx-inline-diff" aria-label={`Changes to ${path}`}>
      <div className="dvx-inline-diff-toolbar">
        <span title="Cumulative changes to this file during this turn, not a single edit">
          {result?.status === 'ready' && result.phase === 'live'
            ? 'This turn · before → current' : 'This turn · before → after'}
        </span>
        {result?.status === 'ready' && context?.connected && context.sessionId !== null ? (
          <button type="button" onClick={() => post(context.port, {
            type: 'file.openTurnDiff', sessionId: context.sessionId!, turnId, path,
          })}>
            Open diff in editor
          </button>
        ) : null}
      </div>
      {result === null ? (
        <div className="dvx-inline-diff-notice" role="status">Loading diff…</div>
      ) : result.status !== 'ready' ? (
        <div className="dvx-inline-diff-notice" role="status">
          <span>{INLINE_DIFF_UNAVAILABLE[result.status]}</span>
          <button type="button" onClick={retry}>Retry</button>
        </div>
      ) : (
        <>
          {lines.length > 0 ? (
            <div className="dvx-inline-diff-scroll" tabIndex={0} role="region" aria-label={`Diff for ${path}`}>
              <pre className="dvx-inline-diff-code"><code>
                {lines.map((line, index) => (
                  <span className={`dvx-inline-diff-line dvx-inline-diff-${line.kind}`} key={index}>
                    {line.kind === 'hunk' || line.kind === 'note' ? (
                      <span className="dvx-inline-diff-meta">{line.text}</span>
                    ) : (
                      <>
                        <span className="dvx-inline-diff-number" aria-hidden="true">{line.before}</span>
                        <span className="dvx-inline-diff-number" aria-hidden="true">{line.after}</span>
                        <span className="dvx-inline-diff-sign">{line.kind === 'add' ? '+' : line.kind === 'remove' ? '−' : ' '}</span>
                        <span className="dvx-inline-diff-text">{line.text || ' '}</span>
                      </>
                    )}
                  </span>
                ))}
              </code></pre>
            </div>
          ) : !result.truncated ? (
            <div className="dvx-inline-diff-notice">No net text changes in this turn.</div>
          ) : null}
          {result.truncated ? (
            <div className="dvx-inline-diff-notice">Preview truncated. Open the diff in the editor to see more.</div>
          ) : null}
        </>
      )}
    </section>
  );
}
