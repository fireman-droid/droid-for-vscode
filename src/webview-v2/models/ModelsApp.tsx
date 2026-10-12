import { useI18n } from '@droidvisx/chat-ui/i18n';
import { useCallback, useEffect, useState } from 'react';
import { MoreHorizontal, Pencil, Plus, RefreshCw, Search, Settings2, Trash2 } from 'lucide-react';
import type { ManagedModel, ModelConnection } from '../../shared/protocol/modelManagerProtocol';
import type { ModelsTransport } from './useModels';
import type { ModelSourceRequest } from '../../shared/protocol/modelSourceProtocol';
import { useModelsPage } from './useModelsPage';
import { readBootThemePreference } from '../shell/themeController';
import { applyTheme } from '../shell/theme';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../ui/overlays';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/selection';
import { AliasForm, ConnectionForm, ModelForm } from './ModelForms';
import { AddModels, type ModelsPageState } from './AddModels';
import { ModelList } from './ModelList';
import { ModelSourceControl, ModelSourceProvider } from './ModelSourceControl';

export function ModelsApp({ transport }: { readonly transport: ModelsTransport }) {
  const postSource = useCallback((message: ModelSourceRequest) => transport.postModelSourceMessage?.(message), [transport]);
  return <ModelSourceProvider postMessage={postSource}><ModelsPage transport={transport} /></ModelSourceProvider>;
}

function ModelsPage({ transport }: { readonly transport: ModelsTransport }) {
  const { t } = useI18n();
  const page = useModelsPage(transport);
  const { manager, connection, busy } = page;
  const { snapshot, run } = manager;
  const [adding, setAdding] = useState(false);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [alias, setAlias] = useState<{ kind: 'provider'; host: string; name: string } | { kind: 'model'; model: ManagedModel } | null>(null);
  const panelOpen = adding || page.editing || alias !== null;
  const disabled = busy || panelOpen;
  useEffect(() => { applyTheme(readBootThemePreference(), manager.theme); }, [manager.theme]);
  const close = () => {
    setAdding(false); setAlias(null); page.setConnectionForm(null); page.setModelForm(null);
    page.setDiscovery(null); page.setChosen(new Set());
  };
  const createChannel = () => { manager.setNotice(null); page.setConnectionForm({ connection: null }); };
  const addModels = (source: ModelConnection) => {
    page.setSelectedId(source.id); page.setDiscovery(null); page.setChosen(new Set());
    manager.setNotice(null); setAdding(true);
    void page.discoverModels(source.id);
  };
  const editModel = (model: ManagedModel) => { page.setSelectedId(model.connectionId); manager.setNotice(null); page.setModelForm({ model }); };
  const title = alias ? alias.kind === 'provider' ? '修改服务商别名' : '修改模型别名'
    : page.connectionForm ? page.connectionForm.connection ? '渠道设置' : '创建渠道'
    : page.modelForm ? '编辑模型' : `${connection?.name ?? ''} · 添加模型`;
  return <Dialog open={panelOpen} onOpenChange={open => { if (!open && !busy) close(); }}>
    <section className="management-models" aria-label={t("模型管理")}>
      <header className="management-heading"><div><h1>{t("模型")}</h1><p>{t("按渠道管理模型")}</p></div>
        <div className="management-actions">
          <Button variant="plain" size="icon-sm" aria-label={t("刷新模型配置")} disabled={disabled} onClick={() => void run({ kind: 'refresh' })}><RefreshCw /></Button>
          <Button variant="outline" size="sm" disabled={disabled || !snapshot} onClick={createChannel}><Plus />{t("创建渠道")}</Button>
        </div>
      </header>
      <div className="management-group"><div className="management-row"><span>{t("聊天中显示")}</span><ModelSourceControl compact /></div></div>
      {!panelOpen && <ModelsFeedback page={page} />}
      {snapshot === null ? <div className="management-empty" role="status">{busy ? t("正在读取模型配置…") : <><p>{t("模型配置读取失败")}</p><Button variant="plain" onClick={() => void run({ kind: 'refresh' })}>{t("重新读取")}</Button></>}</div> : <>
        <div className="management-toolbar"><div className="management-search"><Search /><Input aria-label={t("搜索已配置模型")} placeholder={t("搜索模型")} value={search} onChange={e => setSearch(e.target.value)} /></div>
          <Select value={filter} onValueChange={setFilter} disabled={disabled}><SelectTrigger aria-label={t("渠道筛选")}><SelectValue /></SelectTrigger><SelectContent className="management-menu">
            <SelectItem value="all">{t("全部渠道")}</SelectItem>{snapshot.connections.map(c => <SelectItem value={c.id} key={c.id}>{c.name}</SelectItem>)}
          </SelectContent></Select>
        </div>
        {!snapshot.canApply && snapshot.applyMessage && <p id="models-apply-status" className="management-caption">{snapshot.applyMessage === 'Connect a chat before selecting a model here.' ? t("连接聊天后可切换当前模型。") : t("当前聊天暂时不能切换模型；仍可管理渠道和模型配置。")}</p>}
        {snapshot.connections.filter(c => filter === 'all' || filter === c.id).map(c => {
          const models = snapshot.models.filter(m => m.connectionId === c.id);
          const visible = models.filter(m => `${m.model} ${m.displayName}`.toLowerCase().includes(search.toLowerCase()));
          return <section className="management-channel" key={c.id}>
            <header className="management-channel-heading"><div><h2>{c.name}</h2><p>{c.baseUrl}<span> · {c.protocol}</span></p></div>
              <div className="management-actions"><Button variant="plain" size="sm" disabled={disabled} onClick={() => addModels(c)} aria-label={t("向{p0}添加模型", { p0: c.name })}><Plus />{t("添加模型")}</Button>
                <DropdownMenu><DropdownMenuTrigger asChild><Button variant="plain" size="icon-sm" disabled={disabled} aria-label={t("{p0}的渠道设置", { p0: c.name })}><MoreHorizontal /></Button></DropdownMenuTrigger><DropdownMenuContent className="management-menu" align="end">
                  <DropdownMenuItem onSelect={() => { page.setSelectedId(c.id); manager.setNotice(null); page.setConnectionForm({ connection: c }); }}><Settings2 />{t("渠道设置")}</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => { manager.setNotice(null); setAlias({ kind: 'provider', host: new URL(c.baseUrl).host, name: c.providerName || new URL(c.baseUrl).host }); }}><Pencil />{t("服务商别名")}</DropdownMenuItem>
                  <DropdownMenuItem disabled={models.length > 0} onSelect={() => void run({ kind: 'deleteConnection', connectionId: c.id })}><Trash2 />{t("移除空渠道")}</DropdownMenuItem>
                </DropdownMenuContent></DropdownMenu>
              </div>
            </header>
            <ModelList models={visible} snapshot={snapshot} disabled={disabled} onAction={action => { void run(action); }} onEdit={editModel}
              onRename={model => { page.setSelectedId(model.connectionId); manager.setNotice(null); setAlias({ kind: 'model', model }); }} />
            {visible.length === 0 && <p className="management-caption">{models.length ? t("没有匹配的模型") : t("尚未添加模型")}</p>}
          </section>;
        })}
        {snapshot.connections.length === 0 && <div className="management-empty"><p>{t("还没有渠道")}</p><Button variant="plain" disabled={disabled} onClick={createChannel}><Plus />{t("创建渠道")}</Button></div>}
      </>}
    </section>
    <DialogContent className="management-dialog models-panel" closeDisabled={busy} closeLabel={t('关闭')} onInteractOutside={event => event.preventDefault()}>
      <DialogTitle>{t(title)}</DialogTitle><DialogDescription className="management-caption">{page.connectionForm ? t("同一渠道的模型共用地址和密钥。") : alias ? t("只修改显示名称。") : connection?.baseUrl}</DialogDescription>
      <div className="management-dialog-body"><ModelsFeedback page={page} />
        {alias ? <AliasForm name={alias.kind === 'provider' ? alias.name : alias.model.displayName} label={alias.kind === 'provider' ? t("服务商别名") : t("模型别名")} maxLength={alias.kind === 'provider' ? 80 : 160} busy={busy} onCancel={close} onSave={name => {
          void run(alias.kind === 'provider' ? { kind: 'renameProvider', providerHost: alias.host, name } : { kind: 'renameModel', rawIndex: alias.model.rawIndex, expectedModel: alias.model.model, connectionId: alias.model.connectionId, name }).then(result => { if (result.ok) close(); });
        }} /> : page.connectionForm ? <ConnectionForm connection={page.connectionForm.connection} busy={busy} onCancel={close} onSave={draft => { void page.saveConnection(draft).then(saved => { if (saved) { setFilter('all'); close(); } }); }} />
          : page.modelForm && connection ? <ModelForm model={page.modelForm.model} connection={connection} busy={busy} existingModels={snapshot?.models} onCancel={close} onSave={(draft, verify) => { void page.saveModel(draft, verify); }} />
            : adding ? <AddModels page={page} step="models" onStepChange={() => {}} onNewConnection={createChannel} onDone={close} channelBound /> : null}
      </div>
    </DialogContent>
  </Dialog>;
}
function ModelsFeedback({ page }: { readonly page: ModelsPageState }) {
  const { t } = useI18n();
  const { pending, notice, cancel } = page.manager;
  return <>
    {notice && <p role={notice.ok ? 'status' : 'alert'} className={`management-caption ${notice.ok ? '' : 'text-destructive'}`}>{t(notice.message)}</p>}
    {pending && <div className="management-feedback" role="status"><span>{pending === 'discover' ? t("正在获取模型列表…") : pending === 'saveConnection' ? t("正在保存渠道，请留意编辑器的密钥输入框…") : t("正在处理…")}</span><Button variant="plain" size="sm" onClick={cancel}>{t("取消")}</Button></div>}
  </>;
}
