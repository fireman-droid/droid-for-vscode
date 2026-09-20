import type { SessionContextState } from '../../shared/protocol/settings';
import type { SessionTokenUsageState, TokenUsageBreakdown } from '../../shared/protocol/tokenUsage';
import { formatCompactTokens, formatCredits, getContextLabel, getContextPercent } from '../../webview/assistant/composer/contextPresentation';
import { Button } from '../ui/button';

const categories: readonly { field: Exclude<keyof TokenUsageBreakdown, 'factoryCredits'>; label: string }[] = [
  { field: 'inputTokens', label: 'Input' }, { field: 'outputTokens', label: 'Output' },
  { field: 'cacheReadTokens', label: 'Cache read' }, { field: 'cacheCreationTokens', label: 'Cache write' },
  { field: 'thinkingTokens', label: 'Thinking' },
];

export function ContextPanel({ context, usage, disabled, compactPending, onRefresh, onCompact }: {
  readonly context: SessionContextState;
  readonly usage: SessionTokenUsageState;
  readonly disabled: boolean;
  readonly compactPending: boolean;
  readonly onRefresh: () => void;
  readonly onCompact: () => void;
}) {
  const stats = context.value;
  const breakdown = usage.cumulative ?? usage.lastTurn;
  const percentage = getContextPercent(context);
  return <section aria-label="Context usage" className="space-y-3 text-xs">
    {stats?.availability === 'available' ? <>
      <div className="flex items-center justify-between gap-2">
        <span>{percentage === 0 ? '<1' : percentage}% full</span>
        <span className="text-muted-foreground">{formatCompactTokens(stats.used)} / {formatCompactTokens(stats.limit)} adjusted tokens</span>
      </div>
      <div role="progressbar" aria-label={getContextLabel(context)} aria-valuenow={Math.min(100, stats.used / stats.limit * 100)} aria-valuemin={0} aria-valuemax={100} className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full bg-primary" style={{ width: `${Math.min(100, stats.used / stats.limit * 100)}%` }} />
      </div>
    </> : <p role="status" className="text-muted-foreground">{stats?.availability === 'unavailable' && stats.reason === 'unsupported'
      ? 'This Runtime does not expose the official compaction statistics.'
      : getContextLabel(context)}</p>}
    {context.status === 'error' ? <p role="alert" className="text-destructive">{context.message}</p> : null}
    {breakdown === null ? null : <>
      <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1">
        {categories.map(({ field, label }) => <div key={field} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd title={usage.lastTurn ? `Last turn: ${usage.lastTurn[field].toLocaleString()}` : undefined}>{formatCompactTokens(breakdown[field])}</dd>
        </div>)}
        {(breakdown.factoryCredits ?? 0) > 0 ? <><dt className="text-muted-foreground">Credits</dt><dd>{formatCredits(breakdown.factoryCredits!)}</dd></> : null}
      </dl>
      <p className="text-muted-foreground">Token counts are {usage.cumulative ? 'session totals' : 'from the last turn'}, not current compaction usage.</p>
    </>}
    <div className="flex flex-wrap gap-1 border-t border-[var(--panel-edge)] pt-2">
      <Button variant="outline" size="sm" disabled={disabled || context.status === 'loading'} onClick={onRefresh}>Refresh</Button>
      <Button variant="outline" size="sm" disabled={disabled || context.status === 'loading' || compactPending} onClick={onCompact}>{compactPending ? 'Compacting…' : 'Compact conversation'}</Button>
    </div>
  </section>;
}
