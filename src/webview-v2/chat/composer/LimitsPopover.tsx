import { useState } from 'react';
import { useI18n } from '@droidvisx/chat-ui/i18n';
import { Button } from '../../ui/button';
import type {
  FactoryAccountState,
  FactoryLimitPool,
  FactoryLimits,
  FactoryLimitWindow,
} from '../../../shared/protocol/factoryAccountProtocol';

const WINDOW_LABELS: readonly { readonly key: keyof FactoryLimitPool; readonly label: string }[] = [
  { key: 'fiveHour', label: '5-hour usage' },
  { key: 'weekly', label: 'Weekly usage' },
  { key: 'monthly', label: 'Monthly usage' },
];

type PoolKind = 'standard' | 'core';

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
  const [pool, setPool] = useState<PoolKind>('standard');
  const loading = account === null || account.status === 'loading';
  const readyLimits = account !== null && account.status === 'ready' ? account.limits : null;
  return (
    <div id={id} className="dvx-composer-popover dvx-limits-popover" role="dialog"
      aria-label={t('Usage Limits')} aria-busy={loading}>
      <div className="dvx-context-head dvx-limits-head">
        <span className="dvx-context-head-title">{t('Usage Limits')}</span>
        <div className="dvx-context-head-actions">
          {readyLimits !== null ? (
            <div className="dvx-limits-tabs" role="tablist" aria-label={t('Usage Limits')}>
              <Button variant="plain" size="none" type="button" role="tab"
                aria-selected={pool === 'standard'} data-active={pool === 'standard'}
                className="dvx-limits-tab" onClick={() => setPool('standard')}>
                {t('Standard')}
              </Button>
              <Button variant="plain" size="none" type="button" role="tab"
                aria-selected={pool === 'core'} data-active={pool === 'core'}
                className="dvx-limits-tab" onClick={() => setPool('core')}>
                {t('Droid Core')}
              </Button>
            </div>
          ) : null}
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
      {readyLimits !== null
        ? <LimitsUsage limits={readyLimits} pool={pool} />
        : <p className={account !== null && account.status === 'ready' ? 'dvx-popover-message dvx-error-text' : 'dvx-popover-message'}
          role={account !== null && account.status === 'ready' ? 'alert' : 'status'}>
          {account === null || account.status === 'loading' ? t('Loading usage…')
            : account.status === 'unavailable' ? account.message
            : account.limitsError ?? t('Usage is unavailable right now.')}
        </p>}
    </div>
  );
}

function LimitsUsage({
  limits,
  pool,
}: {
  readonly limits: FactoryLimits;
  readonly pool: PoolKind;
}): React.JSX.Element {
  const { t } = useI18n();
  const activePool = pool === 'standard' ? limits.standard : limits.core;
  const extra =
    limits.extraUsageBalanceCents !== null && limits.extraUsageBalanceCents > 0
      ? `$${(limits.extraUsageBalanceCents / 100).toFixed(2)}`
      : null;
  return (
    <div className="dvx-limits-body">
      <ul className="dvx-limits-list" aria-label={t(pool === 'standard' ? 'Standard Pool windows' : 'Droid Core windows')}>
        {WINDOW_LABELS.map(({ key, label }) => (
          <LimitWindowRow key={key} label={t(label)} window={activePool[key]} />
        ))}
      </ul>
      {extra === null ? null : (
        <div className="dvx-limits-extra">
          <span>{t('Extra usage')}</span>
          <span className="tabular-nums">{extra}</span>
        </div>
      )}
    </div>
  );
}

function LimitWindowRow({
  label,
  window,
}: {
  readonly label: string;
  readonly window: FactoryLimitWindow;
}): React.JSX.Element {
  const { t } = useI18n();
  const started = window.windowEnd !== null;
  const rounded = started ? Math.round(window.usedPercent) : 0;
  const percentLabel = !started
    ? '0%'
    : window.usedPercent > 0 && rounded === 0
      ? '<1%'
      : `${rounded}%`;
  const reset = started ? formatReset(window.secondsRemaining, t) : '';
  return (
    <li className="dvx-limits-item">
      <div className="dvx-limits-row">
        <span className="dvx-limits-label">
          <span>{label}</span>
          <span className="dvx-limits-percent">{percentLabel}</span>
        </span>
        <span className="dvx-limits-meta">
          {!started ? (
            t('Use Droid to start')
          ) : reset === '' ? null : (
            <>
              <ResetIcon />
              <span>{reset}</span>
            </>
          )}
        </span>
      </div>
      <div
        className="dvx-limits-track"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={rounded}
        aria-valuetext={started ? `${percentLabel}${reset ? ` · ${reset}` : ''}` : t('Use Droid to start')}
      >
        <span
          className="dvx-limits-fill"
          style={{ width: `${started ? Math.min(100, Math.max(0, window.usedPercent)) : 0}%` }}
        />
      </div>
    </li>
  );
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

function ResetIcon(): React.JSX.Element {
  return (
    <svg className="dvx-limits-reset-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M13 8a5 5 0 1 1-1.47-3.53M13 2.75V5.5h-2.75" stroke="currentColor" strokeWidth="1.35"
        strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
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
