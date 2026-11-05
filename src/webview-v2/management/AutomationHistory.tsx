import { useEffect, useRef, useState } from 'react';
import { useI18n } from '@droidvisx/chat-ui/i18n';
import { Button } from '@droidvisx/chat-ui/ui/button';
import { ScrollArea } from '@droidvisx/chat-ui/ui/scroll-area';
import { SettingsRow, SettingsSection } from '@droidvisx/chat-ui/ui/settings';
import { AUTOMATION_HISTORY_PAGE_SIZE, type AutomationHistory as History,
  type ManagedAutomation } from '../../shared/protocol/automationProtocol';
import type { ManagementState } from './useManagement';

export function automationTime(value: string | null, locale: string): string {
  if (!value) return '—';
  const time = new Date(value);
  return Number.isNaN(time.getTime()) ? value : time.toLocaleString(locale);
}
export function AutomationHistory({ row, state, active = true }: {
  row: ManagedAutomation; state: ManagementState; active?: boolean;
}) {
  const { t, locale } = useI18n();
  const [history, setHistory] = useState<History | null>(null);
  const [loading, setLoading] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const load = async (offset: number) => {
    if (pending.current || state.busy) return;
    pending.current = true; setLoading(true); setError(null); setAttempted(true);
    try {
      const result = await state.run({ kind: 'automations.history', id: row.id, offset });
      if (result.ok && result.automationHistory) { setHistory(result.automationHistory); setSelected(null); }
      else setError(result.message ?? 'Run history could not be loaded.');
    } finally { pending.current = false; setLoading(false); }
  };
  useEffect(() => { if (active && !attempted && !state.busy) void load(0); }, [active, attempted, state.busy]);
  const open = (runId: string, resume: boolean) => void state.run({
    kind: 'automations.session', id: row.id, runId, offset: history?.offset ?? 0, resume,
  });
  const detail = history?.runs.find(run => run.id === selected);
  const disabled = loading || state.busy;
  return <section aria-label={t('Run history')} className="flex flex-col gap-3">
    {loading && <p role="status" data-ui-notice="" className="sr-only">{t('Loading run history…')}</p>}
    {error && <p role="alert" data-ui-notice="" className="management-caption text-destructive">{t(error)}</p>}
    <ScrollArea orientation="horizontal" nonce={document.querySelector<HTMLScriptElement>('script[nonce]')?.nonce}>
      <table className="management-mission-table management-automation-table" aria-busy={loading}>
        <colgroup><col className="management-history-started-col" /><col className="management-history-type-col" /><col className="management-history-status-col" /><col className="management-history-delivery-col" /><col className="management-history-session-col" /></colgroup>
        <thead data-ui-notice=""><tr><th scope="col">{t('Started')}</th><th scope="col">{t('Type')}</th><th scope="col">{t('Status')}</th><th scope="col">{t('Delivery')}</th><th scope="col">{t('Session')}</th></tr></thead>
        <tbody>{history?.runs.map(run => <tr key={run.id}>
          <td><Button variant="plain" size="none" className="management-mission-title" disabled={disabled} aria-expanded={selected === run.id}
            onClick={() => setSelected(selected === run.id ? null : run.id)}>{automationTime(run.startedAt, locale)}</Button></td>
          <td data-ui-notice="">{t(run.type === 'create' ? 'Initialization' : run.type === 'run' ? 'Execution' : 'Unknown')}</td>
          <td data-ui-notice="">{t(run.status)}</td>
          <td data-ui-notice="">{run.delivery ? t(run.delivery.status === 'pending' ? 'Pending delivery' : run.delivery.status === 'delivered' ? 'Delivered'
            : run.delivery.status === 'failed' ? 'Delivery failed' : 'Unknown delivery status') : '—'}</td>
          <td>{run.sessionId ? <Button variant="plain" size="none" className="management-table-link" disabled={disabled} onClick={() => open(run.id, false)}>
            {t(run.delivery ? 'View target session' : 'View run session')}</Button> : <span data-ui-notice="" className="text-muted-foreground">{t('No linked session')}</span>}</td>
        </tr>)}</tbody>
      </table>
    </ScrollArea>
    {detail && <SettingsSection title={t('Run details')}>
      <SettingsRow
        label={`${t('Finished')}: ${automationTime(detail.completedAt, locale)}`}
        detail={<span className="flex flex-col gap-1">
          <span>{t('Duration')}: {detail.durationMs === null ? '—' : `${detail.durationMs / 1000}s`} · {t('Run ID')}: {detail.id}</span>
          {detail.isRetry && <span>{t('Retry of')}: {detail.originalRunId ?? t('Unknown')}</span>}
          {detail.modelFallback && <span>{t('Model fallback')}: {detail.modelFallback}</span>}
          {detail.error && <span className="text-destructive whitespace-pre-wrap">{detail.error}</span>}
          {detail.delivery?.reason && <span className="whitespace-pre-wrap">{detail.delivery.reason}</span>}
        </span>}
      >
        {detail.sessionId && <div className="management-actions">
          <Button variant="outline" size="sm" disabled={disabled} onClick={() => open(detail.id, false)}>{t('View session')}</Button>
          <Button variant="plain" size="sm" disabled={disabled} onClick={() => open(detail.id, true)}>{t('Continue in chat')}</Button>
        </div>}
      </SettingsRow>
    </SettingsSection>}
    {history && !history.runs.length && !loading && <p data-ui-notice="" className="management-empty">{t('No runs yet')}</p>}
    {history && <div className="dvx-pagination">
      <span data-ui-notice="" className="dvx-page-range">{history.offset + (history.runs.length ? 1 : 0)}–{history.offset + history.runs.length} / {history.total}</span>
      <div className="dvx-pagination-controls">
        <Button variant="plain" size="sm" disabled={disabled || history.offset === 0}
          onClick={() => void load(Math.max(0, history.offset - AUTOMATION_HISTORY_PAGE_SIZE))}>{t('Previous')}</Button>
        <Button variant="plain" size="sm" disabled={disabled || history.offset + history.runs.length >= history.total}
          onClick={() => void load(history.offset + AUTOMATION_HISTORY_PAGE_SIZE)}>{t('Next')}</Button>
      </div>
    </div>}
  </section>;
}
