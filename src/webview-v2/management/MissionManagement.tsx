import { useEffect, useState } from 'react';
import { Plus, RefreshCw } from 'lucide-react';
import type { MissionControlCatalogFilter, MissionControlCatalogRow } from '../../shared/protocol/missionControlPanelProtocol';
import { formatLifecycle, matchesFilter } from '../mission/catalogPresentation';
import { Button } from '../ui/button';
import { Progress } from '../ui/progress';
import { ManagementChoice } from './ManagementFields';
import type { ManagementState } from './useManagement';

const createdTime = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });

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
    <div className="management-mission-scroll" role="region" aria-label="任务列表" tabIndex={0}>
      <table className="management-mission-table" aria-busy={loading}>
        <colgroup><col className="management-mission-title-col" /><col className="management-mission-repository-col" /><col className="management-mission-computer-col" /><col className="management-mission-progress-col" /><col className="management-mission-created-col" /></colgroup>
        <thead><tr><th scope="col">标题</th><th scope="col">仓库</th><th scope="col">电脑</th><th scope="col">进度</th><th scope="col">创建时间</th></tr></thead>
        <tbody>{visible.map(row => <tr key={row.catalogId}>
          <td><Button variant="plain" size="none" className="management-mission-title" title={row.title} disabled={state.busy}
            onClick={() => void state.run({ kind: 'missions.open', id: row.catalogId })}>{row.title}</Button>
            <small className="management-mission-status">{formatLifecycle(row.lifecycle)}</small></td>
          <td><span className="management-mission-label" title={row.workspaceLabel}>{row.workspaceLabel}</span></td>
          <td><span className="management-mission-label" title={row.computerLabel}>{row.computerLabel}</span></td>
          <td>{row.progress ? <div className="management-mission-progress">
            <Progress value={row.progress.completed} max={Math.max(1, row.progress.total)} aria-label={`${row.title}的进度`}
              aria-valuetext={row.progress.total === 0 ? '尚未生成任务计划' : `已完成 ${row.progress.completed} 项，共 ${row.progress.total} 项`} />
            <span>{row.progress.completed}/{row.progress.total}</span>
          </div> : <span className="management-mission-unknown" aria-label="暂无进度">—</span>}</td>
          <td>{row.createdAt ? <time dateTime={row.createdAt} title={createdTime.format(new Date(row.createdAt))}>{createdTime.format(new Date(row.createdAt))}</time>
            : <span className="management-mission-unknown" aria-label="创建时间未知">—</span>}</td>
        </tr>)}</tbody>
      </table>
    </div>
    {loading ? <p role="status" className="management-empty">正在读取任务…</p> : !error && visible.length === 0 && <p className="management-empty">没有匹配的任务</p>}
  </section>;
}
