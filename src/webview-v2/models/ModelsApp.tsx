import { useI18n } from '@droidvisx/chat-ui/i18n';
import { useCallback, useEffect, useState } from 'react';
import { ChevronRight, Plus, RefreshCw } from 'lucide-react';
import type { ModelConnection } from '../../shared/protocol/modelManagerProtocol';
import type { ModelsTransport } from './useModels';
import type { ModelSourceRequest } from '../../shared/protocol/modelSourceProtocol';
import { useModelsPage } from './useModelsPage';
import { readBootThemePreference } from '../shell/themeController';
import { applyTheme } from '../shell/theme';
import { Button } from '../ui/button';
import { ListToolbar } from '@droidvisx/chat-ui/ui/list-toolbar';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../ui/overlays';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/selection';
import type { ModelsPageState } from './AddModels';
import { ConnectionWorkspace } from './ConnectionWorkspace';
import { ModelSourceSelect, ModelSourceProvider } from './ModelSourceControl';
import { PROTOCOLS } from './protocols';
import { ScrollArea } from '@droidvisx/chat-ui/ui/scroll-area';

export function ModelsApp({ transport }: { readonly transport: ModelsTransport }) {
  const postSource = useCallback((message: ModelSourceRequest) => transport.postModelSourceMessage?.(message), [transport]);
  return <ModelSourceProvider postMessage={postSource}>
    <div className="management-page models-standalone">
      <ScrollArea className="management-scroll" nonce={document.querySelector<HTMLScriptElement>('script[nonce]')?.nonce}>
        <main className="management-main"><ModelsPage transport={transport} /></main>
      </ScrollArea>
    </div>
  </ModelSourceProvider>;
}

export function ModelsPage({ transport }: { readonly transport: ModelsTransport }) {
  const { t } = useI18n();
  const page = useModelsPage(transport);
  const { manager, connection, busy } = page;
  const { snapshot, run } = manager;
  const [panelOpen, setPanelOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const disabled = busy || panelOpen;
  useEffect(() => { applyTheme(readBootThemePreference(), manager.theme); }, [manager.theme]);
  const close = () => {
    setPanelOpen(false); setCreating(false); page.setConnectionForm(null); page.setModelForm(null);
    page.setDiscovery(null); page.setChosen(new Set());
  };
  const createChannel = () => { manager.setNotice(null); setCreating(true); setPanelOpen(true); page.setConnectionForm({ connection: null }); };
  const openConnection = (source: ModelConnection) => {
    page.setSelectedId(source.id); page.setDiscovery(null); page.setChosen(new Set());
    page.setSearch(''); manager.setNotice(null); setCreating(false); setPanelOpen(true);
  };
  const query = search.trim().toLowerCase();
  const connections = snapshot?.connections.filter(c => (filter === 'all' || filter === c.id) &&
    (!query || `${c.name} ${c.baseUrl} ${PROTOCOLS[c.protocol].name}`.toLowerCase().includes(query) ||
      snapshot.models.some(model => model.connectionId === c.id && `${model.model} ${model.displayName}`.toLowerCase().includes(query)))) ?? [];
  return <Dialog open={panelOpen} onOpenChange={open => { if (!open && !busy) close(); }}>
    <section className="management-models" aria-label={t("模型管理")}>
      <header data-ui-notice="" className="management-heading"><div><h1>{t("模型")}</h1><p>{t("按渠道管理模型")}</p></div>
        <div className="management-actions">
          <Button variant="plain" size="icon-sm" aria-label={t("刷新模型配置")} disabled={disabled} onClick={() => void run({ kind: 'refresh' })}><RefreshCw /></Button>
          <Button variant="outline" size="sm" disabled={disabled || !snapshot} onClick={createChannel}><Plus />{t("创建渠道")}</Button>
        </div>
      </header>
      {!panelOpen && <ModelsFeedback page={page} />}
      {snapshot === null ? <div data-ui-notice="" className="management-empty" role="status">{busy ? t("正在读取模型配置…") : <><p>{t("模型配置读取失败")}</p><Button variant="plain" onClick={() => void run({ kind: 'refresh' })}>{t("重新读取")}</Button></>}</div> : <>
        <div className="models-source-preference">
          <ModelSourceSelect disabled={disabled} />
          <p data-ui-notice="" className="models-help">{t("Applies to model pickers, not this list.")}</p>
        </div>
        <ListToolbar label={t('Search connections or models')} placeholder={t('Search connections or models')} value={search} onChange={setSearch}>
          <Select value={filter} onValueChange={setFilter} disabled={disabled}><SelectTrigger aria-label={t("渠道筛选")}><SelectValue /></SelectTrigger><SelectContent className="management-menu">
            <SelectItem value="all">{t("全部渠道")}</SelectItem>{snapshot.connections.map(c => <SelectItem value={c.id} key={c.id}>{c.name}</SelectItem>)}
          </SelectContent></Select>
        </ListToolbar>
        {!snapshot.canApply && snapshot.applyMessage && <p data-ui-notice="" id="models-apply-status" className="management-caption">{snapshot.applyMessage === 'Connect a chat before selecting a model here.' ? t("连接聊天后可切换当前模型。") : t("当前聊天暂时不能切换模型；仍可管理渠道和模型配置。")}</p>}
        <div className="models-connection-list">
        {connections.map(c => {
          const models = snapshot.models.filter(m => m.connectionId === c.id);
          return <Button key={c.id} variant="plain" size="none" className="models-connection-row"
            disabled={disabled} aria-label={t("{p0}的渠道设置", { p0: c.name })} onClick={() => openConnection(c)}>
            <span className="models-connection-copy"><span className="models-connection-name">{c.name}</span>
              <span className="models-connection-endpoint">{PROTOCOLS[c.protocol].name} · {c.baseUrl}</span></span>
            <span data-ui-notice="" className="models-connection-meta"><span>{models.length} {t("模型")}</span>
              <span>{c.hasKey ? t("密钥已保存") : t("未配置密钥")}</span></span>
            <ChevronRight aria-hidden />
          </Button>;
        })}
        </div>
        {snapshot.connections.length > 0 && connections.length === 0 ? <p data-ui-notice="" className="management-caption">{t("没有匹配的模型")}</p> : null}
        {snapshot.connections.length === 0 && <div data-ui-notice="" className="management-empty"><p>{t("还没有渠道")}</p><Button variant="plain" disabled={disabled} onClick={createChannel}><Plus />{t("创建渠道")}</Button></div>}
      </>}
    </section>
    <DialogContent className="management-dialog models-workspace-dialog" closeDisabled={busy} closeLabel={t('关闭')}
      onEscapeKeyDown={event => { if (busy) event.preventDefault(); }} onInteractOutside={event => event.preventDefault()}>
      <DialogTitle>{creating ? t("创建渠道") : connection?.name}</DialogTitle>
      <DialogDescription className="management-caption">{t("Save each section separately. Closing does not undo applied changes.")}</DialogDescription>
      <ScrollArea className="models-workspace-scroll" nonce={document.querySelector<HTMLScriptElement>('script[nonce]')?.nonce}>
        <div className="models-workspace-content"><ModelsFeedback page={page} />
          <ConnectionWorkspace page={page} creating={creating} onCreated={() => { setCreating(false); setFilter('all'); }} onClose={close} />
        </div>
      </ScrollArea>
      {!creating ? <div className="models-workspace-footer"><Button variant="outline" disabled={busy} onClick={close}>{t("关闭")}</Button></div> : null}
    </DialogContent>
  </Dialog>;
}
function ModelsFeedback({ page }: { readonly page: ModelsPageState }) {
  const { t } = useI18n();
  const { pending, notice, cancel } = page.manager;
  return <>
    {notice && <p data-ui-notice="" role={notice.ok ? 'status' : 'alert'} className={`management-caption ${notice.ok ? '' : 'text-destructive'}`}>{t(notice.message)}</p>}
    {pending && <div data-ui-notice="" className="management-feedback" role="status"><span>{pending === 'discover' ? t("正在获取模型列表…") : pending === 'saveConnection' ? t("正在保存渠道，请留意编辑器的密钥输入框…") : t("正在处理…")}</span><Button variant="plain" size="sm" onClick={cancel}>{t("取消")}</Button></div>}
  </>;
}
