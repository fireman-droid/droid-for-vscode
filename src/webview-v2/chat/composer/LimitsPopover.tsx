import { useI18n } from '@droidvisx/chat-ui/i18n';
import { Button } from '../../ui/button';
import type {
  FactoryAccountState,
  FactoryLimitPool,
  FactoryLimits,
  FactoryLimitWindow,
} from '../../../shared/protocol/factoryAccountProtocol';

/**
 * `/limits` in the Context Usage panel's own form (same header row,
 * summary line, meter and legend rows) so both usage panels read as
 * one surface above the Composer instead of a separate dialog.
 *
 * The summary follows the CLI: the busiest active Standard window
 * leads, and every window still appears in its legend with its reset.
 */

const WINDOW_LABELS: readonly { readonly key: keyof FactoryLimitPool; readonly label: string }[] = [
  { key: 'fiveHour', label: '5-Hour' },
  { key: 'weekly', label: 'Weekly' },
  { key: 'monthly', label: 'Monthly' },
];

export function LimitsPopover({
  id,
  account,
  disabled,
  onRefresh,
  onClose,
}: {
  readonly id: string;
  readonly account: FactoryAccountState | null;
  readonly disabled: boolean;
  readonly onRefresh: () => void;
  readonly onClose?: () => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const loading = account === null || account.status === 'loading';
  return (
    <div id={id} className="dvx-composer-popover dvx-limits-popover" role="dialog"
      aria-label={t('Credit limits')} aria-busy={loading}>
      <div className="dvx-context-head">
        <span className="dvx-context-head-title">{t('Credit limits')}</span>
        <div className="dvx-context-head-actions">
          <Button variant="plain" size="none" type="button" className="dvx-context-icon-button"
            aria-label={t('Refresh')} title={loading ? t('Refreshing…') : t('Refresh')}
            disabled={disabled || loading} onClick={onRefresh}>
            <RefreshIcon spinning={loading} />
          </Button>
          {onClose === undefined ? null : <Button variant="plain" size="none" type="button"
            className="dvx-context-icon-button" aria-label={t('Close')} onClick={onClose}>
            <CloseIcon />
          </Button>}
        </div>
      </div>
      {account !== null && account.status === 'ready' && account.limits !== null
        ? <LimitsUsage limits={account.limits} />
        : <p className={account !== null && account.status === 'ready' ? 'dvx-popover-message dvx-error-text' : 'dvx-popover-message'}
          role={account !== null && account.status === 'ready' ? 'alert' : 'status'}>
          {account === null || account.status === 'loading' ? t('Loading usage…')
            : account.status === 'unavailable' ? account.message
            : account.limitsError ?? t('Usage is unavailable right now.')}
        </p>}
    </div>
  );
}

function LimitsUsage({ limits }: { readonly limits: FactoryLimits }): React.JSX.Element {
  const { t } = useI18n();
  // The CLI reports the busiest active Standard window; unstarted
  // windows carry no percentage and must not win the summary.
  const lead = WINDOW_LABELS
    .filter(({ key }) => limits.standard[key].windowEnd !== null)
    .map((entry) => ({ label: entry.label, window: limits.standard[entry.key] }))
    .reduce<{ label: string; window: FactoryLimitWindow } | null>(
      (best, entry) => best === null || entry.window.usedPercent > best.window.usedPercent ? entry : best,
      null,
    );
  const percentLabel = lead === null ? t('Not started')
    : lead.window.usedPercent > 0 && Math.round(lead.window.usedPercent) === 0 ? '<1%'
    : `${Math.round(lead.window.usedPercent)}%`;
  const extra = limits.extraUsageBalanceCents === null
    ? null
    : `$${(limits.extraUsageBalanceCents / 100).toFixed(2)}`;
  return (
    <div className="dvx-context-usage">
      <div className="dvx-context-usage-summary">
        <strong>{lead === null ? percentLabel : `${percentLabel} ${t('used')}`}</strong>
        <span>{lead === null ? t('No window started')
          : `${t(lead.label)} · ${formatReset(lead.window.secondsRemaining, t)}`}</span>
      </div>
      <div className="dvx-context-bar" role="progressbar" aria-label={t('Standard Pool usage')}
        aria-valuemin={0} aria-valuemax={100}
        aria-valuenow={lead === null ? 0 : Math.round(lead.window.usedPercent)}
        aria-valuetext={lead === null ? t('Not started')
          : `${Math.round(lead.window.usedPercent)}% of ${t(lead.label)}`}>
        <span className="dvx-context-bar-segment" style={{
          width: `${lead === null ? 0 : lead.window.usedPercent}%`,
          background: 'var(--dvx-accent)',
        }} />
      </div>
      <p className="dvx-context-usage-note" title={t('Included allowance, resetting on rolling windows.')}>
        {t('Standard Pool · Auto-resets on rolling windows')}</p>
      <ul className="dvx-context-legend" aria-label={t('Standard Pool windows')}>
        {WINDOW_LABELS.map(({ key, label }, index) => <LimitLegendRow key={key}
          label={t(label)} window={limits.standard[key]} colorVar={`--dvx-ctx-${index + 1}`} />)}
      </ul>
      <ul className="dvx-context-legend" aria-label={t('Droid Core windows')}>
        {WINDOW_LABELS.map(({ key, label }, index) => <LimitLegendRow key={key}
          label={`${t('Droid Core')} · ${t(label)}`} window={limits.core[key]} colorVar={`--dvx-ctx-${index + 1}`} />)}
      </ul>
      <p className="dvx-context-usage-note">{t('Droid Core is the free allowance used after the Standard Pool runs out.')}</p>
      {extra === null ? null : <ul className="dvx-context-legend" aria-label={t('Extra usage')}>
        <li className="dvx-context-legend-row dvx-context-legend-credits">
          <span className="dvx-context-legend-swatch" aria-hidden="true" />
          <span className="dvx-context-legend-label">{t('Extra usage')}</span>
          <span className="dvx-context-legend-value">{extra}</span>
        </li>
      </ul>}
      {extra === null ? null : <p className="dvx-context-usage-note">
        {t('Prepaid credits, billed after the included allowance.')}</p>}
    </div>
  );
}

/** One legend row in the Context Usage form: swatch, label, value. */
function LimitLegendRow({ label, window, colorVar }: {
  readonly label: string;
  readonly window: FactoryLimitWindow;
  readonly colorVar: string;
}): React.JSX.Element {
  const { t } = useI18n();
  const started = window.windowEnd !== null;
  const reset = started ? formatReset(window.secondsRemaining, t) : '';
  return <li className="dvx-context-legend-row" title={started ? reset : t('Not started')}>
    <span className="dvx-context-legend-swatch" style={{ background: `var(${colorVar})` }} aria-hidden="true" />
    <span className="dvx-context-legend-label">{label}</span>
    <span className="dvx-context-legend-value">
      {started ? `${Math.round(window.usedPercent)}%` : t('Not started')}
      {reset === '' ? '' : ` · ${reset}`}
    </span>
  </li>;
}

/** Coarse reset countdown: days, then hours, then minutes. */
function formatReset(
  seconds: number | null,
  t: (message: string, params?: Record<string, string | number>) => string,
): string {
  if (seconds === null || seconds <= 0) return '';
  const days = Math.floor(seconds / 86_400);
  if (days >= 1) return t('{count} days', { count: days });
  const hours = Math.floor(seconds / 3_600);
  if (hours >= 1) {
    const minutes = Math.floor((seconds % 3_600) / 60);
    return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
  }
  return `${Math.max(1, Math.floor(seconds / 60))}m`;
}

function RefreshIcon({ spinning }: { readonly spinning: boolean }): React.JSX.Element {
  return <svg className={spinning ? 'dvx-context-refresh-icon dvx-context-refresh-spinning' : 'dvx-context-refresh-icon'}
    viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M13 8a5 5 0 1 1-1.47-3.53M13 2.75V5.5h-2.75" stroke="currentColor" strokeWidth="1.3"
      strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}

function CloseIcon(): React.JSX.Element {
  return <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="m4.5 4.5 7 7m0-7-7 7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </svg>;
}
