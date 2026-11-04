import { useEffect, useRef, useState } from 'react';
import { Plus, RefreshCw } from 'lucide-react';
import { useI18n } from '@droidvisx/chat-ui/i18n';
import { Button } from '@droidvisx/chat-ui/ui/button';
import { ListToolbar } from '@droidvisx/chat-ui/ui/list-toolbar';
import { Pagination } from '@droidvisx/chat-ui/ui/pagination';
import { ScrollArea } from '@droidvisx/chat-ui/ui/scroll-area';
import type { AutomationAction, ManagedAutomation } from '../../shared/protocol/automationProtocol';
import type { ManagementState } from './useManagement';
import { ManagementChoice } from './ManagementFields';
import { AutomationEditor } from './AutomationEditor';
import { automationTime } from './AutomationHistory';
import { AutomationDetail, AutomationScheduleSummary } from './AutomationDetail';
import { AutomationActions } from './AutomationActions';
import { MissionListLoading as AutomationListLoading } from './ManagementListLoading';

export function AutomationManagement({ state, active }: { state: ManagementState; active: boolean }) {
  const { t, locale } = useI18n();
  const [rows, setRows] = useState<readonly ManagedAutomation[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [editor, setEditor] = useState<{ row: ManagedAutomation | null } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState('overview');
  const [refreshKey, setRefreshKey] = useState(0);
  const pending = useRef(false);
  const mutation = useRef(false);
  const available = state.settings?.sessionManagementAvailable;
  const disabled = state.busy || loading;
  const load = async () => {
    if (pending.current) return;
    pending.current = true; setLoading(true); setError(null);
    try {
      const result = await state.run({ kind: 'automations.list' });
      if (result.ok && result.automations) { setRows(result.automations); setLoaded(true); setRefreshKey(value => value + 1); }
      else setError(result.message ?? 'Automations could not be loaded.');
    } finally { pending.current = false; setLoading(false); }
  };
  useEffect(() => {
    if (active && available && !loaded && !error && !state.busy && !pending.current) void load();
  }, [active, available, loaded, error, state.busy]);
  const act = async (action: AutomationAction) => {
    if (disabled || pending.current || mutation.current) return;
    mutation.current = true;
    try {
      const result = await state.run(action);
      await load();
      if (result.message) state.setNotice({ ok: result.ok, message: result.message });
      if (result.ok && action.kind === 'automations.delete' && result.message !== 'Automation action cancelled.') setSelected(null);
      if (result.ok && action.kind === 'automations.run') { setSelected(action.id); setTab('history'); }
    } finally { mutation.current = false; }
  };
  const open = (id: string, nextTab = 'overview') => { setSelected(id); setTab(nextTab); };
  const visible = rows.filter(row => (filter === 'all' || (filter === 'paused' ? row.status === 'paused' : ['active', 'running'].includes(row.status)))
    && `${row.name} ${row.description}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const currentPage = Math.min(page, Math.max(0, Math.ceil(visible.length / pageSize) - 1));
  const detail = rows.find(row => row.id === selected);
  if (state.settings && !available) return <p data-ui-notice="" role="status" className="management-empty">{t('Automations require daemon mode.')}</p>;
  return <>
    {error && <p role="alert" data-ui-notice="" className="management-caption text-destructive">{t(error)}</p>}
    {selected ? detail
      ? <AutomationDetail row={detail} state={state} active={active && !editor} loading={loading} tab={tab} onTab={setTab}
          onBack={() => setSelected(null)} onRefresh={() => void load()} onEdit={() => setEditor({ row: detail })}
          onAction={action => void act(action)} refreshKey={refreshKey} />
      : <section className="flex flex-col gap-3"><p data-ui-notice="" role="status">{t('Automation is no longer available on this machine. Refresh the list.')}</p>
          <div className="management-actions"><Button variant="plain" disabled={disabled} onClick={() => void load()}>{t('Refresh automations')}</Button>
            <Button variant="plain" disabled={disabled} onClick={() => setSelected(null)}>{t('Back to automations')}</Button></div></section>
      : <section aria-label={t('Automations')}>
        <header className="management-heading"><div><h1 data-ui-notice="">{t('Automations')}</h1><p data-ui-notice="">{t('Local tasks')}</p></div><div className="management-actions">
          <Button variant="plain" size="icon-sm" aria-label={t('Refresh automations')} disabled={disabled || !available}
            onClick={() => void load()}><RefreshCw className={loading ? 'animate-spin motion-reduce:animate-none' : undefined} /></Button>
          <Button variant="outline" size="sm" disabled={disabled || !available} onClick={() => setEditor({ row: null })}><Plus />{t('New automation')}</Button>
        </div></header>
        <p data-ui-notice="" className="management-caption">{t('Local schedules need this computer awake, online, and running Droid. Closing this page does not pause them.')}</p>
        <ListToolbar label={t('Search automations')} placeholder={t('Search name or description')} value={query} onChange={value => { setQuery(value); setPage(0); }}>
          <ManagementChoice label={t('Automation status')} value={filter} onChange={value => { setFilter(value); setPage(0); }}
            options={[['all', t('All')], ['active', t('Enabled')], ['paused', t('Paused')]]} />
        </ListToolbar>
        {loading && <p role="status" data-ui-notice="" className="sr-only">{t('Loading automations…')}</p>}
        <ScrollArea orientation="horizontal" nonce={document.querySelector<HTMLScriptElement>('script[nonce]')?.nonce}>
          <table className="management-mission-table management-automation-table" aria-busy={loading}>
            <colgroup><col className="management-automation-name-col" /><col className="management-automation-status-col" /><col className="management-automation-schedule-col" /><col className="management-automation-next-col" /><col className="management-automation-actions-col" /></colgroup>
            <thead data-ui-notice=""><tr><th scope="col">{t('Name')}</th><th scope="col">{t('Status')}</th><th scope="col">{t('Schedule')}</th><th scope="col">{t('Next run')}</th><th scope="col">{t('Actions')}</th></tr></thead>
            <tbody>{!loaded && loading && <AutomationListLoading />}{visible.slice(currentPage * pageSize, (currentPage + 1) * pageSize).map(row => <tr key={row.id}>
              <td><Button variant="plain" size="none" className="management-mission-title" disabled={disabled} onClick={() => open(row.id)}>{row.name}</Button>
                <small data-ui-notice="">{t(row.targetSessionId ? 'Deliver to a fixed session' : 'New session for each run')}</small></td>
              <td data-ui-notice="">{t(row.valid ? row.status : 'Invalid configuration')}
                {row.blockedReason ? <small>{t('Configuration needs review')}</small> : row.lastRunStatus && <small>{t('Latest run')}: {t(row.lastRunStatus)}</small>}
                {!row.editable && <small>{t('Managed elsewhere')}</small>}</td>
              <td><AutomationScheduleSummary schedule={row.schedule} /></td>
              <td data-ui-notice="">{row.status === 'paused' ? '—' : row.nextRunAt ? automationTime(row.nextRunAt, locale) : t('Unknown')}</td>
              <td><AutomationActions row={row} disabled={disabled} onAction={action => void act(action)}
                onEdit={() => setEditor({ row })} onHistory={() => open(row.id, 'history')} /></td>
            </tr>)}</tbody>
          </table>
        </ScrollArea>
        {loaded && !visible.length && !error && <p data-ui-notice="" className="management-empty">{t(rows.length ? 'No matching automations' : 'No local automations yet')}</p>}
        {loaded && visible.length > 0 && <Pagination label={t('Automation pages')} page={currentPage} pageSize={pageSize} count={visible.length} complete
          loading={loading} disabled={disabled} onPage={setPage} onPageSize={size => { setPageSize(size); setPage(0); }} />}
      </section>}
    {active && editor && <AutomationEditor row={editor.row} state={state} onClose={() => setEditor(null)}
      onSaved={result => {
        setEditor(null);
        if (result.automationId) open(result.automationId);
        void load().then(() => { if (result.message) state.setNotice({ ok: result.ok, message: result.message }); });
      }} />}
  </>;
}
