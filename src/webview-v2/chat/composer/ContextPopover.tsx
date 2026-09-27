// Context-usage popover in Cursor's Context Usage form (spec §3.2,
// 需求 4): a title row with quiet icon actions, one summary line
// ("12% Full" · "~115.6K / 1M Tokens"), a segmented category bar over
// the --dvx-ctx-1..5 palette, a swatch legend, and our extra Compact
// action seated in a hairline footer row. The old big-number summary,
// Remaining/Source stat pair and two-scope table retired; per-turn
// detail lives on in each legend row's hover title.

import { type SessionContextState } from '../../../shared/protocol/settings';
import { Button } from '../../ui/button';
import type {
  SessionTokenUsageState,
  TokenUsageBreakdown,
} from '../../../shared/protocol/tokenUsage';
import { formatCount } from './shared';
import { formatCompactTokens, formatCredits, hasUsableContextRatio } from './contextPresentation';
export { formatCompactTokens, getContextPercent, getContextLabel, hasUsableContextRatio } from './contextPresentation';

/** Legend rows: our real categories mapped onto the five ctx colors. */
const CONTEXT_CATEGORIES: readonly {
  readonly field: Exclude<keyof TokenUsageBreakdown, 'factoryCredits'>;
  readonly label: string;
  readonly colorVar: string;
}[] = [
  { field: 'inputTokens', label: 'Input', colorVar: '--dvx-ctx-1' },
  { field: 'outputTokens', label: 'Output', colorVar: '--dvx-ctx-2' },
  { field: 'cacheReadTokens', label: 'Cache read', colorVar: '--dvx-ctx-3' },
  {
    field: 'cacheCreationTokens',
    label: 'Cache write',
    colorVar: '--dvx-ctx-4',
  },
  { field: 'thinkingTokens', label: 'Thinking', colorVar: '--dvx-ctx-5' },
];

export function ContextPopover({
  id,
  context,
  tokenUsage,
  disabled,
  compactPending,
  onRefresh,
  onCompact,
  onClose,
}: {
  readonly id: string;
  readonly context: SessionContextState;
  readonly tokenUsage: SessionTokenUsageState | undefined;
  readonly disabled: boolean;
  readonly compactPending: boolean;
  readonly onRefresh: () => void;
  readonly onCompact: () => void;
  /** Cursor's top-right ×; omitted hosts fall back to Esc/outside. */
  readonly onClose?: () => void;
}): React.JSX.Element {
  return (
    <div
      id={id}
      className="dvx-composer-popover dvx-context-popover"
      role="dialog"
      aria-label="Context usage"
      aria-busy={context.status === 'loading'}
    >
      <div className="dvx-context-head">
        <span className="dvx-context-head-title">Context Usage</span>
        <div className="dvx-context-head-actions">
          <Button variant="plain" size="none"
            type="button"
            className="dvx-context-icon-button"
            aria-label="Refresh"
            title={context.status === 'loading' ? 'Refreshing…' : 'Refresh'}
            disabled={disabled}
            onClick={onRefresh}
          >
            <RefreshIcon spinning={context.status === 'loading'} />
          </Button>
          {onClose === undefined ? null : (
            <Button variant="plain" size="none"
              type="button"
              className="dvx-context-icon-button"
              aria-label="Close"
              onClick={onClose}
            >
              <CloseIcon />
            </Button>
          )}
        </div>
      </div>
      {context.value !== null ? (
        <ContextUsage stats={context.value} usage={tokenUsage} />
      ) : context.status === 'loading' ? (
        <p className="dvx-popover-message" role="status">
          Loading context usage…
        </p>
      ) : null}
      {context.status === 'error' ? (
        <p className="dvx-popover-message dvx-error-text" role="alert">
          {context.message}
        </p>
      ) : null}
      <div className="dvx-context-compact">
        <Button variant="plain" size="none"
          type="button"
          className="dvx-context-compact-button"
          title="Summarizes earlier messages to free up context."
          disabled={disabled || compactPending}
          aria-busy={compactPending}
          onClick={compactPending ? undefined : onCompact}
        >
          {compactPending ? (
            <>
              <span className="dvx-compact-spinner" aria-hidden="true" />
              Compacting…
            </>
          ) : (
            'Compact conversation'
          )}
        </Button>
      </div>
    </div>
  );
}

function ContextUsage({
  stats,
  usage,
}: {
  readonly stats: NonNullable<SessionContextState['value']>;
  readonly usage: SessionTokenUsageState | undefined;
}): React.JSX.Element {
  const estimateNote =
    stats.estimatedTokens === undefined ? null : (
      <p className="dvx-context-usage-note">
        Estimated content size: ~{formatCompactTokens(stats.estimatedTokens)} tokens. This
        character-based estimate is separate from compaction progress.
      </p>
    );
  if (stats.availability === 'unavailable') {
    const detail =
      stats.reason === 'awaiting-usage'
        ? 'Compaction progress appears after the first model response reports token usage.'
        : stats.reason === 'unsupported'
          ? 'This Runtime does not expose the official compaction statistics.'
          : 'The current compaction statistics could not be validated.';
    return (
      <div className="dvx-context-usage dvx-context-usage-unavailable">
        <div className="dvx-context-usage-summary">
          <strong>
            {stats.reason === 'awaiting-usage'
              ? 'Waiting for model usage'
              : 'Compaction progress unavailable'}
          </strong>
        </div>
        <p className="dvx-context-usage-note">{detail}</p>
        {estimateNote}
      </div>
    );
  }
  const usedPercent = Math.min(100, (stats.used / stats.limit) * 100);
  const roundedPercent = Math.round(usedPercent);
  const percentLabel = roundedPercent === 0 ? '<1%' : `${roundedPercent}%`;
  // Legend scope: session totals when the SDK reported them, else the
  // last turn (history sessions carry no per-turn usage and fresh
  // sessions may carry only one scope).
  const breakdown = usage?.cumulative ?? usage?.lastTurn ?? null;
  const lastTurn = usage?.lastTurn ?? null;
  const breakdownTotal =
    breakdown === null
      ? 0
      : CONTEXT_CATEGORIES.reduce((sum, category) => sum + breakdown[category.field], 0);
  const legend =
    breakdown === null || breakdownTotal === 0
      ? []
      : CONTEXT_CATEGORIES.filter((category) => breakdown[category.field] > 0);
  const credits = breakdown?.factoryCredits ?? 0;

  return (
    <div className="dvx-context-usage">
      <div className="dvx-context-usage-summary">
        <strong>{percentLabel} to compaction</strong>
        <span>
          ~{formatCompactTokens(stats.used)} / {formatCompactTokens(stats.limit)} Tokens
        </span>
      </div>
      <div
        className="dvx-context-bar"
        role="progressbar"
        aria-label="Compaction progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={roundedPercent}
        aria-valuetext={`${percentLabel} of compaction threshold (${formatCount(
          stats.used,
        )} of ${formatCount(stats.limit)} adjusted tokens)`}
      >
        <span
          className="dvx-context-bar-segment"
          style={{
            width: `${usedPercent}%`,
            background: 'var(--dvx-accent)',
          }}
        />
      </div>
      <p className="dvx-context-usage-note"
        title="Based on the last model response, adjusted like the Droid CLI meter. Automatic compaction is controlled by Droid.">
        Last response · Auto-compaction by Droid
      </p>
      {estimateNote}
      {legend.length === 0 ? null : (
        <ul
          className="dvx-context-legend"
          aria-label={
            usage?.cumulative ? 'Session token totals' : 'Last turn token totals'
          }
        >
          {legend.map((category) => (
            <li
              key={category.field}
              className="dvx-context-legend-row"
              title={
                lastTurn === null
                  ? undefined
                  : `Last turn: ${formatCount(lastTurn[category.field])}`
              }
            >
              <span
                className="dvx-context-legend-swatch"
                style={{ background: `var(${category.colorVar})` }}
                aria-hidden="true"
              />
              <span className="dvx-context-legend-label">{category.label}</span>
              <span className="dvx-context-legend-value">
                {formatCompactTokens(breakdown![category.field])}
              </span>
            </li>
          ))}
          {credits > 0 ? (
            <li className="dvx-context-legend-row dvx-context-legend-credits">
              <span className="dvx-context-legend-swatch" aria-hidden="true" />
              <span className="dvx-context-legend-label">Credits</span>
              <span className="dvx-context-legend-value">{formatCredits(credits)}</span>
            </li>
          ) : null}
        </ul>
      )}
      {breakdown !== null ? (
        <p className="dvx-context-usage-note">
          {usage?.cumulative
            ? 'Token counts above are session totals, not current compaction usage.'
            : 'Token counts above are from the last turn, not current compaction usage.'}
        </p>
      ) : null}
    </div>
  );
}

function RefreshIcon({ spinning }: { readonly spinning: boolean }): React.JSX.Element {
  return (
    <svg
      className={
        spinning
          ? 'dvx-context-refresh-icon dvx-context-refresh-spinning'
          : 'dvx-context-refresh-icon'
      }
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M13 8a5 5 0 1 1-1.47-3.53M13 2.75V5.5h-2.75"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CloseIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="m4.5 4.5 7 7m0-7-7 7"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}