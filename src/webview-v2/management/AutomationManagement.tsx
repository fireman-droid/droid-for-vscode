import { useEffect, useRef, useState } from 'react';
import { MoreHorizontal, Plus, RefreshCw } from 'lucide-react';
import { useI18n } from '@droidvisx/chat-ui/i18n';
import { Button } from '@droidvisx/chat-ui/ui/button';
import { ListToolbar } from '@droidvisx/chat-ui/ui/list-toolbar';
import { Pagination } from '@droidvisx/chat-ui/ui/pagination';
import { ScrollArea } from '@droidvisx/chat-ui/ui/scroll-area';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
  DropdownMenuTrigger } from '@droidvisx/chat-ui/ui/dropdown-menu';
import type { AutomationAction, ManagedAutomation } from '../../shared/protocol/automationProtocol';
import type { ManagementState } from './useManagement';
import { ManagementChoice } from './ManagementFields';
import { AutomationEditor } from './AutomationEditor';
import { AutomationHistory, automationTime } from './AutomationHistory';
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
  const [history, setHistory] = useState<ManagedAutomation | null>(null);
  const pending = useRef(false);
  const available = state.settings?.sessionManagementAvailable;
  const disabled = state.busy || loading;
  const load = async () => {
    if (pending.current) return;
    pending.current = true; setLoading(true); setError(null);
    try {
      const result = await state.run({ kind: 'automations.list' });
      if (result.ok && result.automations) { setRows(result.automations); setLoaded(true); }
      else setError(result.message ?? 'Automations could not be loaded.');
    } finally { pending.current = false; setLoading(false); }
  };
  useEffect(() => {
    if (active && available && !loaded && !error && !state.busy && !pending.current) void load();
  }, [active, available, loaded, error, state.busy]);
  const act = async (action: AutomationAction) => {
    if (disabled || pending.current) return;
    const result = await state.run(action);
    if (result.ok) {
      await load();
      if (result.message) state.setNotice({ ok: true, message: result.message });
    }
  };
  const visible = rows.filter(row => (filter === 'all' || (filter === 'paused' ? row.status === 'paused' : row.status !== 'paused'))
    && `${row.name} ${row.description}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const currentPage = Math.min(page, Math.max(0, Math.ceil(visible.length / pageSize) - 1));
  if (state.settings && !available) return <p data-ui-notice="" role="status" className="management-empty">{t('Automations require daemon mode.')}</p>;
  return <section aria-label={t('Automations')}>
    <header className="management-heading"><h1 data-ui-notice="">{t('Automations')}</h1><div className="management-actions">
      <Button variant="plain" size="icon-sm" aria-label={t('Refresh automations')} disabled={disabled || !available}
        onClick={() => void load()}><RefreshCw className={loading ? 'animate-spin motion-reduce:animate-none' : undefined} /></Button>
      <Button variant="outline" size="sm" disabled={disabled || !available} onClick={() => setEditor({ row: null })}><Plus />{t('New automation')}</Button>
    </div></header>
    <p data-ui-notice="" className="management-caption">{t('Local schedules need this computer awake, online, and running Droid. Closing this page does not pause them.')}</p>
    <ListToolbar label={t('Search automations')} placeholder={t('Search name or description')} value={query} onChange={value => { setQuery(value); setPage(0); }}>
      <ManagementChoice label={t('Automation status')} value={filter} onChange={value => { setFilter(value); setPage(0); }}
        options={[['all', t('All')], ['active', t('Enabled')], ['paused', t('Paused')]]} />
    </ListToolbar>
    {error && <p role="alert" data-ui-notice="" className="management-caption text-destructive">{t(error)}</p>}
    {loading && <p role="status" data-ui-notice="" className="sr-only">{t('Loading automations…')}</p>}
    <ScrollArea orientation="horizontal" nonce={document.querySelector<HTMLScriptElement>('script[nonce]')?.nonce}>
      <table className="management-mission-table" aria-busy={loading}>
        <thead data-ui-notice=""><tr><th>{t('Name')}</th><th>{t('Status')}</th><th>{t('Schedule (UTC cron)')}</th><th>{t('Next run')}</th><th>{t('Actions')}</th></tr></thead>
        <tbody>{!loaded && loading && <AutomationListLoading />}{visible.slice(currentPage * pageSize, (currentPage + 1) * pageSize).map(row => <tr key={row.id}>
          <td><Button variant="plain" size="none" className="management-mission-title" disabled={disabled}
            onClick={() => setHistory(row)}>{row.name}</Button>{row.description && <small>{row.description}</small>}</td>
          <td data-ui-notice="">{t(row.valid ? row.status : 'Invalid configuration')}{!row.editable && <small>{t('Managed elsewhere')}</small>}</td>
          <td><code>{row.schedule || '—'}</code></td><td data-ui-notice="">{automationTime(row.nextRunAt, locale)}</td>
          <td><DropdownMenu><DropdownMenuTrigger asChild>
            <Button variant="plain" size="icon-sm" aria-label={t('Automation actions for {p0}', { p0: row.name })} disabled={disabled}><MoreHorizontal /></Button>
          </DropdownMenuTrigger><DropdownMenuContent align="end">
            <DropdownMenuItem disabled={!row.editable || !row.valid || row.status === 'running'}
              onSelect={() => void act({ kind: 'automations.run', id: row.id, revision: row.revision })}>{t('Run now')}</DropdownMenuItem>
            <DropdownMenuItem disabled={!row.editable} onSelect={() => setEditor({ row })}>{t('Edit')}</DropdownMenuItem>
            <DropdownMenuItem disabled={!row.editable || row.status === 'paused' && !row.valid}
              onSelect={() => void act({ kind: row.status === 'paused' ? 'automations.resume' : 'automations.pause', id: row.id, revision: row.revision })}>
              {t(row.status === 'paused' ? 'Enable schedule' : 'Pause schedule')}</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setHistory(row)}>{t('Run history')}</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={!row.editable} onSelect={() => void act({ kind: 'automations.delete', id: row.id, revision: row.revision })}>{t('Delete')}</DropdownMenuItem>
          </DropdownMenuContent></DropdownMenu></td>
        </tr>)}</tbody>
      </table>
    </ScrollArea>
    {loaded && !visible.length && !error && <p data-ui-notice="" className="management-empty">{t(rows.length ? 'No matching automations' : 'No local automations yet')}</p>}
    {loaded && <Pagination label={t('Automation pages')} page={currentPage} pageSize={pageSize} count={visible.length} complete compact
      loading={loading} disabled={disabled} onPage={setPage} onPageSize={size => { setPageSize(size); setPage(0); }} />}
    {active && editor && <AutomationEditor row={editor.row} state={state} onClose={() => setEditor(null)}
      onSaved={message => {
        setEditor(null);
        void load().then(() => { if (message) state.setNotice({ ok: true, message }); });
      }} />}
    {active && history && <AutomationHistory key={history.id} row={history} state={state} onClose={() => setHistory(null)} />}
  </section>;
}
