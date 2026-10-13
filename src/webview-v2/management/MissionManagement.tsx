import { useI18n } from '@droidvisx/chat-ui/i18n';
import { useEffect, useState } from 'react';
import { Plus, RefreshCw } from 'lucide-react';
import type { MissionControlCatalogFilter, MissionControlCatalogRow } from '../../shared/protocol/missionControlPanelProtocol';
import { formatLifecycle, matchesFilter } from '../mission/catalogPresentation';
import { Button } from '../ui/button';
import { Progress } from '../ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/selection';
import { ManagementChoice } from './ManagementFields';
import type { ManagementState } from './useManagement';
import { DefaultsSettings } from './DefaultsSettings';
import { MissionListLoading } from './ManagementListLoading';

const createdTime = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });

export function MissionManagement({ state, active }: { state: ManagementState; active: boolean }) {
  const { t } = useI18n();
  const [section, setSection] = useState('history');
  const [rows, setRows] = useState<readonly MissionControlCatalogRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<MissionControlCatalogFilter>('all');
  const load = () => {
    setLoading(true); setError(null);
    void state.run({ kind: 'missions.list' }).then(result => {
      setLoaded(true); setLoading(false);
      if (result.ok && result.missions) setRows(result.missions);
      else setError(result.message || '任务目录读取失败');
    });
  };
  useEffect(() => { if (active && section === 'history' && state.settings && !state.busy && !loaded && !loading) load(); }, [active, section, state.settings, state.busy, loaded, loading]);
  const visible = rows.filter(row => matchesFilter(row, filter));
  const pending = loading || !loaded;
  return <section aria-label={t("Mission 管理")}><header className="management-heading"><h1>{t("Missions")}</h1>{section === 'history' && <div className="management-actions">
    <Button variant="plain" size="icon-sm" aria-label={t("刷新 Missions")} disabled={state.busy || pending} onClick={load}><RefreshCw className={pending ? 'animate-spin motion-reduce:animate-none' : undefined} /></Button>
    <Button variant="outline" size="sm" disabled={state.busy} onClick={() => void state.run({ kind: 'missions.new' })}><Plus />{t("新建任务")}</Button>
  </div>}</header>
    <Tabs value={section} onValueChange={value => { setSection(value); state.setNotice(null); }} className="management-page-tabs">
      <TabsList animatedIndicator aria-label={t("Missions 页面")}><TabsTrigger value="history">{t("任务列表")}</TabsTrigger><TabsTrigger value="defaults">{t("默认设置")}</TabsTrigger></TabsList>
      <TabsContent value="defaults" forceMount hidden={section !== 'defaults'}><DefaultsSettings state={state} scope="missions" active={active && section === 'defaults'} /></TabsContent>
      <TabsContent value="history" forceMount hidden={section !== 'history'}>
    <div className="management-toolbar"><ManagementChoice label={t("Mission 状态")} value={filter} onChange={v => setFilter(v as MissionControlCatalogFilter)} options={[[ 'all', t('全部任务') ], ['running', t('进行中')], ['paused', t('已暂停')], ['completed', t('已完成')]]} /></div>
    {error && <p role="alert" className="management-caption text-destructive">{t(error)}</p>}
    {pending && <p role="status" className="sr-only">{t("正在读取任务…")}</p>}
    <div className="management-mission-scroll" role="region" aria-label={t("任务列表")} tabIndex={0}>
      <table className="management-mission-table" aria-busy={pending}>
        <colgroup><col className="management-mission-title-col" /><col className="management-mission-repository-col" /><col className="management-mission-computer-col" /><col className="management-mission-progress-col" /><col className="management-mission-created-col" /></colgroup>
        <thead><tr><th scope="col">{t("标题")}</th><th scope="col">{t("仓库")}</th><th scope="col">{t("电脑")}</th><th scope="col">{t("进度")}</th><th scope="col">{t("创建时间")}</th></tr></thead>
        <tbody>{!loaded && <MissionListLoading />}{visible.map(row => <tr key={row.catalogId}>
          <td><Button variant="plain" size="none" className="management-mission-title" title={row.title} disabled={state.busy}
            onClick={() => void state.run({ kind: 'missions.open', id: row.catalogId })}>{row.title}</Button>
            <small className="management-mission-status">{t(formatLifecycle(row.lifecycle))}</small></td>
          <td><span className="management-mission-label" title={row.workspaceLabel}>{row.workspaceLabel}</span></td>
          <td><span className="management-mission-label" title={row.computerLabel}>{row.computerLabel}</span></td>
          <td>{row.progress ? <div className="management-mission-progress">
            <Progress value={row.progress.completed} max={Math.max(1, row.progress.total)} aria-label={t("{p0}的进度", { p0: row.title })}
              aria-valuetext={row.progress.total === 0 ? '尚未生成任务计划' : `已完成 ${row.progress.completed} 项，共 ${row.progress.total} 项`} />
            <span>{row.progress.completed}/{row.progress.total}</span>
          </div> : <span className="management-mission-unknown" aria-label={t("暂无进度")}>—</span>}</td>
          <td>{row.createdAt ? <time dateTime={row.createdAt} title={createdTime.format(new Date(row.createdAt))}>{createdTime.format(new Date(row.createdAt))}</time>
            : <span className="management-mission-unknown" aria-label={t("创建时间未知")}>—</span>}</td>
        </tr>)}</tbody>
      </table>
    </div>
    {!pending && !error && visible.length === 0 && <p className="management-empty">{t("没有匹配的任务")}</p>}
      </TabsContent>
    </Tabs>
  </section>;
}
