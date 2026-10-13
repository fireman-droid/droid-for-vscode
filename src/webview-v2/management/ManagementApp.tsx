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
import { useI18n } from '@droidvisx/chat-ui/i18n';
import { useWebviewLocale } from '../shell/locale';
import { isLanguagePreference } from '../../shared/protocol/localeProtocol';

declare const __DVX_BUILD_ID__: string;
const statusLabels: Record<string, string> = { connected: '已连接', connecting: '连接中', idle: '空闲', disconnected: '已断开', unavailable: '不可用', error: '连接失败', reconnecting: '重连中', preparing: '准备中', 'reconnect-required': '需要重连' };

export function ManagementApp({ transport }: { transport: ManagementTransport }) {
  const { t } = useI18n();
  const language = useWebviewLocale();
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
    <div hidden={state.page !== 'general'}><header className="management-heading"><div><h1>{t("常规")}</h1><p>{t("外观、问答、连接与版本")}</p></div>
      <Button variant="plain" size="icon-sm" aria-label={t("刷新信息")} title={t("刷新信息")} disabled={state.busy} onClick={() => void state.run({ kind: 'settings.read' })}><RefreshCw className={state.busy ? 'animate-spin motion-reduce:animate-none' : undefined} /></Button>
    </header>
      {s ? <>
        <div className="management-group"><ManagementRow label={t('Language')} detail={t('Interface language. Messages and code stay in their original language.')}>
          <ManagementChoice label={t('Language')} value={language.preference} disabled={state.busy}
            onChange={value => { if (isLanguagePreference(value)) void state.run({ kind: 'language.set', language: value }); }}
            options={[['auto', t('Follow editor')], ['en', 'English'], ['zh-CN', '简体中文'], ['zh-TW', '繁體中文']]} />
        </ManagementRow>
        <ManagementRow label={t("主题")}><ManagementChoice label={t("主题")} value={s.theme} disabled={state.busy} onChange={theme => void state.run({ kind: 'theme.set', theme: theme as typeof s.theme })} options={[[ 'auto', t('跟随编辑器') ], ['light', t('浅色')], ['dark', t('深色')]]} /></ManagementRow></div>
        <h2 className="management-section-title">{t("代码审阅问答")}</h2><div className="management-group"><ManagementRow label={t("问答模型")} detail={t("用于 Review Changes 中的行内问答。")}>
          <ManagementChoice label={t("代码审阅问答模型")} value={s.reviewQuestion.modelId ?? 'follow-main'} disabled={state.busy}
            onChange={value => void state.run({ kind: 'reviewQuestion.model.set', modelId: value === 'follow-main' ? null : value })}
            options={[
              ['follow-main', t('跟随主聊天')],
              ...(s.reviewQuestion.modelId && !s.reviewQuestion.models.some(model => model.id === s.reviewQuestion.modelId)
                ? [[s.reviewQuestion.modelId, t('{name} (unavailable)', { name: s.reviewQuestion.modelId })] as const] : []),
              ...s.reviewQuestion.models.map(model => [model.id, model.label] as const),
            ]} />
        </ManagementRow></div>
        <h2 className="management-section-title">{t("连接")}</h2><div className="management-group"><ManagementRow label={t("Droid 会话")}><span className="select-none">{t(statusLabels[s.connection] ?? s.connection)}</span></ManagementRow><ManagementRow label="IDE"><span className="select-none">{t(statusLabels[s.ide] ?? s.ide)}</span></ManagementRow></div>
        <h2 className="management-section-title">{t("版本")}</h2><div className="management-group"><ManagementRow label={`Droid ${s.version}`} detail={typeof __DVX_BUILD_ID__ === 'undefined' ? 'development' : __DVX_BUILD_ID__}>
          <Button variant="plain" size="icon-sm" aria-label={t("复制版本信息")} onClick={() => { void copyText(`Droid ${s.version}\n${typeof __DVX_BUILD_ID__ === 'undefined' ? 'development' : __DVX_BUILD_ID__}`).then(() => setCopied(true), () => state.setNotice({ ok: false, message: '复制失败，可手动复制版本信息。' })); }}>{copied ? <Check /> : <Copy />}</Button>
        </ManagementRow></div>
      </> : <p role="status" className="management-empty">{state.busy ? t("正在读取设置…") : t("设置尚未读取")}</p>}
    </div>
    {visited.has('models') && <div hidden={state.page !== 'models'}><ModelsApp transport={transport} /></div>}
    {visited.has('completion') && s && <div hidden={state.page !== 'completion'}><CompletionSettings state={state} settings={s} /></div>}
    {visited.has('sessions') && <div hidden={state.page !== 'sessions'}><SessionManagement state={state} active={state.page === 'sessions'} /></div>}
    {visited.has('missions') && <div hidden={state.page !== 'missions'}><MissionManagement state={state} active={state.page === 'missions'} /></div>}
    {state.notice && <p role={state.notice.ok ? 'status' : 'alert'} className={`management-caption ${state.notice.ok ? '' : 'text-destructive'}`}>{t(state.notice.message)}</p>}
  </main></div>;
}
