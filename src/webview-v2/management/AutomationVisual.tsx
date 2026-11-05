import { useEffect, useRef, useState } from 'react';
import { useI18n } from '@droidvisx/chat-ui/i18n';
import { Button } from '@droidvisx/chat-ui/ui/button';
import { SettingsRow, SettingsSection } from '@droidvisx/chat-ui/ui/settings';
import type { AutomationHistory, ManagedAutomation } from '../../shared/protocol/automationProtocol';
import type { ManagementState } from './useManagement';
import { automationTime } from './AutomationHistory';

export function AutomationVisual({ row, state, active, onHistory }: {
  row: ManagedAutomation; state: ManagementState; active: boolean; onHistory(): void;
}) {
  const { t, locale } = useI18n();
  const [history, setHistory] = useState<AutomationHistory | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const load = async () => {
    if (pending.current || state.busy) return;
    pending.current = true; setAttempted(true); setError(null);
    try {
      const result = await state.run({ kind: 'automations.history', id: row.id, offset: 0 });
      if (result.ok && result.automationHistory) setHistory(result.automationHistory);
      else setError(result.message ?? 'Run history could not be loaded.');
    } finally { pending.current = false; }
  };
  useEffect(() => { if (active && !attempted && !state.busy) void load(); }, [active, attempted, state.busy]);
  const openSession = (runId: string) => void state.run({
    kind: 'automations.session', id: row.id, runId, offset: 0, resume: false,
  });
  const latestStatus = row.lastRunStatus ?? history?.runs[0]?.status ?? row.status;
  return <section aria-label={t('Result dashboard')} className="flex flex-col gap-6">
    {error && <p data-ui-notice="" role="alert" className="management-caption text-destructive">{t(error)}</p>}
    <div className="management-stat-grid" data-ui-notice="">
      <div className="management-stat-card">
        <span className="management-stat-label">{t('Total runs')}</span>
        <strong className="management-stat-value">{history ? history.total : '—'}</strong>
      </div>
      <div className="management-stat-card">
        <span className="management-stat-label">{t('Status')}</span>
        <strong className="management-stat-value">{t(latestStatus)}</strong>
      </div>
      <div className="management-stat-card">
        <span className="management-stat-label">{t('Latest run')}</span>
        <strong className="management-stat-value">{automationTime(row.lastRunAt ?? history?.runs[0]?.startedAt ?? null, locale)}</strong>
      </div>
      <div className="management-stat-card">
        <span className="management-stat-label">{t('Next run')}</span>
        <strong className="management-stat-value">{row.status === 'paused' ? '—' : row.nextRunAt ? automationTime(row.nextRunAt, locale) : t('Unknown')}</strong>
      </div>
    </div>
    <SettingsSection title={t('Recent runs')}>
      {history?.runs.length ? history.runs.slice(0, 5).map(run => {
        const deliveryLabel = run.delivery ? t(run.delivery.status === 'pending' ? 'Pending delivery'
          : run.delivery.status === 'delivered' ? 'Delivered'
          : run.delivery.status === 'failed' ? 'Delivery failed' : 'Unknown delivery status') : null;
        return <SettingsRow
          key={run.id}
          label={automationTime(run.startedAt, locale)}
          detail={<span className="flex flex-col gap-1">
            <span>{t(run.type === 'create' ? 'Initialization' : run.type === 'run' ? 'Execution' : 'Unknown')} · {t(run.status)}{deliveryLabel ? ` · ${deliveryLabel}` : ''}{run.durationMs !== null ? ` · ${run.durationMs / 1000}s` : ''}</span>
            {run.error && <span className="text-destructive whitespace-pre-wrap">{run.error}</span>}
            {run.delivery?.reason && <span className="whitespace-pre-wrap">{run.delivery.reason}</span>}
          </span>}
        >
          {run.sessionId
            ? <Button variant="outline" size="sm" disabled={state.busy} onClick={() => openSession(run.id)}>
                {t(run.delivery ? 'View target session' : 'View run session')}
              </Button>
            : <span data-ui-notice="" className="text-muted-foreground">{t('No linked session')}</span>}
        </SettingsRow>;
      }) : <SettingsRow label={attempted && !history ? t('Loading dashboard…') : t('No runs yet')}>
        <Button variant="plain" size="sm" disabled={state.busy} onClick={onHistory}>{t('Run history')}</Button>
      </SettingsRow>}
    </SettingsSection>
  </section>;
}
