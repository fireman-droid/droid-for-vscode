import { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useI18n } from '@droidvisx/chat-ui/i18n';
import { Button } from '@droidvisx/chat-ui/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@droidvisx/chat-ui/ui/overlays';
import { AUTOMATION_HISTORY_PAGE_SIZE, type AutomationHistory as History,
  type ManagedAutomation } from '../../shared/protocol/automationProtocol';
import type { ManagementState } from './useManagement';

export function automationTime(value: string | null, locale: string): string {
  if (!value) return '—';
  const time = new Date(value);
  return Number.isNaN(time.getTime()) ? value : time.toLocaleString(locale);
}
export function AutomationHistory({ row, state, onClose }: {
  row: ManagedAutomation; state: ManagementState; onClose(): void;
}) {
  const { t, locale } = useI18n();
  const [history, setHistory] = useState<History | null>(null);
  const [loading, setLoading] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const load = async (offset: number) => {
    if (pending.current || state.busy) return;
    pending.current = true; setLoading(true); setError(null); setAttempted(true);
    try {
      const result = await state.run({ kind: 'automations.history', id: row.id, offset });
      if (result.ok && result.automationHistory) setHistory(result.automationHistory);
      else setError(result.message ?? 'Run history could not be loaded.');
    } finally { pending.current = false; setLoading(false); }
  };
  useEffect(() => { if (!attempted && !state.busy) void load(0); }, [attempted, state.busy]);
  return <Dialog open onOpenChange={open => { if (!open && !loading) onClose(); }}>
    <DialogContent className="management-dialog max-w-2xl" closeDisabled={loading}>
      <DialogTitle data-ui-notice="">{t('Run history')}</DialogTitle>
      <DialogDescription>{row.name}</DialogDescription>
      <Button variant="plain" size="icon-sm" aria-label={t('Refresh run history')} disabled={loading || state.busy}
        onClick={() => void load(history?.offset ?? 0)}><RefreshCw className={loading ? 'animate-spin' : undefined} /></Button>
      {loading && <p role="status" data-ui-notice="" className="management-caption">{t('Loading run history…')}</p>}
      {error && <p role="alert" data-ui-notice="" className="management-caption text-destructive">{t(error)}</p>}
      {history?.runs.map(run => <article key={run.id} className="flex flex-col gap-1 py-3">
        <div className="flex justify-between gap-3" data-ui-notice=""><span>{t(run.status)}</span>
          <time>{automationTime(run.startedAt, locale)}</time></div>
        {run.completedAt && <p data-ui-notice="" className="management-caption">{t('Finished')}: {automationTime(run.completedAt, locale)}</p>}
        {run.error && <p className="text-destructive whitespace-pre-wrap">{run.error}</p>}
        {run.modelFallback && <p data-ui-notice="" className="management-caption">{t('Model fallback')}: {run.modelFallback}</p>}
      </article>)}
      {history && !history.runs.length && !loading && <p data-ui-notice="" className="management-empty">{t('No runs yet')}</p>}
      {history && <div className="management-actions justify-end">
        <span data-ui-notice="" className="management-caption">{history.offset + (history.runs.length ? 1 : 0)}–{history.offset + history.runs.length} / {history.total}</span>
        <Button variant="plain" size="sm" disabled={loading || state.busy || history.offset === 0}
          onClick={() => void load(Math.max(0, history.offset - AUTOMATION_HISTORY_PAGE_SIZE))}>{t('Previous')}</Button>
        <Button variant="plain" size="sm" disabled={loading || state.busy || history.offset + history.runs.length >= history.total}
          onClick={() => void load(history.offset + AUTOMATION_HISTORY_PAGE_SIZE)}>{t('Next')}</Button>
      </div>}
    </DialogContent>
  </Dialog>;
}
