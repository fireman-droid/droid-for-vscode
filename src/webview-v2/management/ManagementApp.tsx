import { useEffect, useState } from 'react';
import { Check, Copy, RefreshCw } from 'lucide-react';
import type { ManagementPage } from '../../shared/protocol/managementPageProtocol';
import { Button } from '../ui/button';
import { applyTheme } from '../shell/theme';
import { copyText } from '../bridge/clipboard';
import { ModelsApp } from '../models/ModelsApp';
import { useManagement, type ManagementTransport } from './useManagement';
import { ManagementChoice, ManagementRow } from './ManagementFields';
import { CompletionSettings } from './CompletionSettings';
import { SessionManagement } from './SessionManagement';
import { MissionManagement } from './MissionManagement';
import { ManagementSidebar } from './ManagementSidebar';

declare const __DVX_BUILD_ID__: string;
const statusLabels: Record<string, string> = { connected: '已连接', connecting: '连接中', idle: '空闲', disconnected: '已断开', unavailable: '不可用', error: '连接失败', reconnecting: '重连中', preparing: '准备中', 'reconnect-required': '需要重连' };

export function ManagementApp({ transport }: { transport: ManagementTransport }) {
  const state = useManagement(transport);
  const [visited, setVisited] = useState<ReadonlySet<ManagementPage>>(new Set(['general']));
  const [copied, setCopied] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  useEffect(() => { setVisited(prev => new Set(prev).add(state.page)); }, [state.page]);
  useEffect(() => { if (state.settings) applyTheme(state.settings.theme, state.settings.resolvedTheme); }, [state.settings?.theme, state.settings?.resolvedTheme]);
  useEffect(() => { if (!copied) return; const timer = setTimeout(() => setCopied(false), 2000); return () => clearTimeout(timer); }, [copied]);
  const s = state.settings;
  return <div className="management-page" data-sidebar-collapsed={sidebarCollapsed}>
    <ManagementSidebar page={state.page} collapsed={sidebarCollapsed} version={s?.version}
      onToggle={() => setSidebarCollapsed(value => !value)}
      onNavigate={page => { state.setPage(page); state.setNotice(null); }} />
    <main className="management-main">
    <div hidden={state.page !== 'general'}><header className="management-heading"><div><h1>常规</h1><p>外观、问答、连接与版本</p></div>
      <Button variant="plain" size="icon-sm" aria-label="刷新信息" title="刷新信息" disabled={state.busy} onClick={() => void state.run({ kind: 'settings.read' })}><RefreshCw className={state.busy ? 'animate-spin motion-reduce:animate-none' : undefined} /></Button>
    </header>
      {s ? <>
        <div className="management-group"><ManagementRow label="主题"><ManagementChoice label="主题" value={s.theme} disabled={state.busy} onChange={theme => void state.run({ kind: 'theme.set', theme: theme as typeof s.theme })} options={[[ 'auto', '跟随编辑器' ], ['light', '浅色'], ['dark', '深色']]} /></ManagementRow></div>
        <h2 className="management-section-title">代码审阅问答</h2><div className="management-group"><ManagementRow label="问答模型" detail="用于 Review Changes 中的行内问答。">
          <ManagementChoice label="代码审阅问答模型" value={s.reviewQuestion.modelId ?? 'follow-main'} disabled={state.busy}
            onChange={value => void state.run({ kind: 'reviewQuestion.model.set', modelId: value === 'follow-main' ? null : value })}
            options={[
              ['follow-main', '跟随主聊天'],
              ...(s.reviewQuestion.modelId && !s.reviewQuestion.models.some(model => model.id === s.reviewQuestion.modelId)
                ? [[s.reviewQuestion.modelId, `${s.reviewQuestion.modelId}（不可用）`] as const] : []),
              ...s.reviewQuestion.models.map(model => [model.id, model.label] as const),
            ]} />
        </ManagementRow></div>
        <h2 className="management-section-title">连接</h2><div className="management-group"><ManagementRow label="Droid 会话"><span className="select-none">{statusLabels[s.connection] ?? s.connection}</span></ManagementRow><ManagementRow label="IDE"><span className="select-none">{statusLabels[s.ide] ?? s.ide}</span></ManagementRow></div>
        <h2 className="management-section-title">版本</h2><div className="management-group"><ManagementRow label={`Droid ${s.version}`} detail={typeof __DVX_BUILD_ID__ === 'undefined' ? 'development' : __DVX_BUILD_ID__}>
          <Button variant="plain" size="icon-sm" aria-label="复制版本信息" onClick={() => { void copyText(`Droid ${s.version}\n${typeof __DVX_BUILD_ID__ === 'undefined' ? 'development' : __DVX_BUILD_ID__}`).then(() => setCopied(true), () => state.setNotice({ ok: false, message: '复制失败，可手动复制版本信息。' })); }}>{copied ? <Check /> : <Copy />}</Button>
        </ManagementRow></div>
      </> : <p role="status" className="management-empty">{state.busy ? '正在读取设置…' : '设置尚未读取'}</p>}
    </div>
    {visited.has('models') && <div hidden={state.page !== 'models'}><ModelsApp transport={transport} /></div>}
    {visited.has('completion') && s && <div hidden={state.page !== 'completion'}><CompletionSettings state={state} settings={s} /></div>}
    {visited.has('sessions') && <div hidden={state.page !== 'sessions'}><SessionManagement state={state} active={state.page === 'sessions'} /></div>}
    {visited.has('missions') && <div hidden={state.page !== 'missions'}><MissionManagement state={state} active={state.page === 'missions'} /></div>}
    {state.notice && <p role={state.notice.ok ? 'status' : 'alert'} className={`management-caption ${state.notice.ok ? '' : 'text-destructive'}`}>{state.notice.message}</p>}
  </main></div>;
}
