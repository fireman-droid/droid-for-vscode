import { useEffect, useState } from 'react';
import { ArrowRight, Plus, RefreshCw } from 'lucide-react';
import type { MissionControlCatalogFilter, MissionControlCatalogRow } from '../../shared/protocol/missionControlPanelProtocol';
import { formatLifecycle, matchesFilter } from '../mission/catalogPresentation';
import { Button } from '../ui/button';
import { ManagementChoice } from './ManagementFields';
import type { ManagementState } from './useManagement';

export function MissionManagement({ state, active }: { state: ManagementState; active: boolean }) {
  const [rows, setRows] = useState<readonly MissionControlCatalogRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<MissionControlCatalogFilter>('all');
  const load = () => {
    setLoaded(true); setLoading(true); setError(null);
    void state.run({ kind: 'missions.list' }).then(result => {
      setLoading(false);
      if (result.ok && result.missions) setRows(result.missions);
      else setError(result.message || '任务目录读取失败');
    });
  };
  useEffect(() => { if (active && state.settings && !state.busy && !loaded) load(); }, [active, state.settings, state.busy, loaded]);
  const visible = rows.filter(row => matchesFilter(row, filter));
  return <section aria-label="Mission 管理"><header className="management-heading"><div><h1>Missions</h1><p>任务进度与对应会话</p></div><div className="management-actions">
    <Button variant="plain" size="icon-sm" aria-label="刷新 Missions" disabled={state.busy} onClick={load}><RefreshCw /></Button>
    <Button variant="outline" size="sm" disabled={state.busy} onClick={() => void state.run({ kind: 'missions.new' })}><Plus />新建任务</Button>
  </div></header>
    <div className="management-toolbar"><ManagementChoice label="Mission 状态" value={filter} onChange={v => setFilter(v as MissionControlCatalogFilter)} options={[[ 'all', '全部任务' ], ['running', '进行中'], ['paused', '已暂停'], ['completed', '已完成']]} /></div>
    {error && <p role="alert" className="management-caption text-destructive">{error}</p>}
    {visible.map(row => <div className="management-mission" key={row.catalogId}><div><small>{formatLifecycle(row.lifecycle)}</small><h2>{row.title}</h2><p>{row.workspaceLabel}{row.progress ? ` · ${row.progress.completed} / ${row.progress.total}` : ''}</p></div>
      <Button variant="plain" size="sm" disabled={state.busy} onClick={() => void state.run({ kind: 'missions.open', id: row.catalogId })}>进入任务 <ArrowRight /></Button>
    </div>)}
    {loading ? <p role="status" className="management-empty">正在读取任务…</p> : !error && visible.length === 0 && <p className="management-empty">没有匹配的任务</p>}
  </section>;
}
