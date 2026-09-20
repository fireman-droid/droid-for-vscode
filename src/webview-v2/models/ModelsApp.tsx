import { useEffect, useState } from 'react';
import { Check, Pencil, Plus, RefreshCw, Search, Settings2, SlidersHorizontal } from 'lucide-react';
import type { ManagedModel, ModelConnection } from '../../shared/protocol/modelManagerProtocol';
import type { ModelsTransport } from '../../webview/models/useModels';
import { useModelsPage } from '../../webview/models/useModelsPage';
import { PROTOCOLS } from '../../webview/models/protocols';
import { readBootThemePreference } from '../../webview/assistant/shell/theme';
import { applyTheme } from '../shell/theme';
import { Button } from '../ui/button';
import { DroidActivity, DroidLoading } from '../ui/droid-motion';
import { Input } from '../ui/input';
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '../ui/overlays';
import { AliasForm, ConnectionForm, ModelForm } from './ModelForms';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/selection';
import { AddModels, type ModelsPageState } from './AddModels';
import { ModelList } from './ModelList';

export function ModelsApp({ transport }: { readonly transport: ModelsTransport }) {
  const page = useModelsPage(transport);
  const { manager, connection, models, visible, busy } = page;
  const { snapshot, run } = manager;
  const [adding, setAdding] = useState(false);
  const [addStep, setAddStep] = useState<'source' | 'models'>('source');
  const [connectionDefaults, setConnectionDefaults] = useState<Pick<ModelConnection, 'name' | 'baseUrl'> | undefined>();
  const [alias, setAlias] = useState<{ kind: 'provider'; host: string; name: string } | { kind: 'model'; model: ManagedModel } | null>(null);
  const panelOpen = adding || page.editing || alias !== null;
  const disabled = busy || panelOpen;
  const current = snapshot?.models.find((model) => model.runtimeId !== null && model.runtimeId === snapshot.activeModelId);
  useEffect(() => { applyTheme(readBootThemePreference(), manager.theme); }, [manager.theme]);

  const closePanel = () => {
    setAdding(false);
    setAlias(null);
    setConnectionDefaults(undefined);
    page.setConnectionForm(null);
    page.setModelForm(null);
    page.setDiscovery(null);
    page.setChosen(new Set());
  };
  const startAdding = () => {
    manager.setNotice(null);
    setAddStep('source');
    page.setDiscovery(null);
    page.setChosen(new Set());
    setAdding(true);
  };
  const editConnection = () => {
    manager.setNotice(null);
    page.setConnectionForm({ connection });
  };
  const newConnection = (sameProvider = false) => {
    manager.setNotice(null);
    setConnectionDefaults(sameProvider && connection && page.group ? { name: page.group.name, baseUrl: connection.baseUrl } : undefined);
    page.setConnectionForm({ connection: null });
  };
  const panelTitle = alias !== null ? alias.kind === 'provider' ? '修改服务商别名' : '修改模型别名' : page.connectionForm !== null
    ? page.connectionForm.connection ? '接口设置' : '添加兼容接口'
    : page.modelForm !== null ? '编辑模型' : '添加模型';
  const panelDescription = alias !== null ? '名称和连接配置分别管理。'
    : page.connectionForm !== null ? '同一域名的接口归到同一服务商；每个接口独立保存地址和密钥。'
    : page.modelForm !== null ? '修改本地模型配置，保存后由 Droid 重新加载。'
    : '先选择服务商和兼容接口，再添加需要的模型。';

  return <Dialog open={panelOpen} onOpenChange={(open) => { if (!open && !busy) closePanel(); }}><main className="models-page">
    <header className="models-page-header">
      <div><h1>模型管理</h1><p className="models-help mt-1">选择服务商、兼容接口和模型，在聊天中使用。</p></div>
      <div className="flex shrink-0 items-center gap-2">
        <Button variant="ghost" size="icon" aria-label="刷新模型配置" title="刷新模型配置" disabled={disabled} onClick={() => void run({ kind: 'refresh' })}><RefreshCw /></Button>
        <DialogTrigger asChild><Button disabled={disabled || !snapshot} onClick={startAdding}><Plus />添加模型</Button></DialogTrigger>
      </div>
    </header>
    <div className="models-workspace">
      <aside className="models-sidebar">
        <div className="models-sidebar-heading"><h2>服务商</h2>
          <Button variant="ghost" size="icon-sm" aria-label="添加服务商接口" disabled={disabled || !snapshot} onClick={() => newConnection()}><Plus /></Button>
        </div>
        <nav aria-label="模型服务商" className="models-source-list">
          {page.groups.map((provider) => {
            return <Button key={provider.host} variant="plain" size="none" className="models-source" disabled={disabled}
              title={`${provider.name}\n${provider.host}`}
              aria-current={provider.host === page.group?.host ? 'page' : undefined} onClick={() => {
                page.selectProvider(provider); manager.setNotice(null);
              }}>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2"><span className="min-w-0 flex-1 truncate">{provider.name}</span><span className="models-source-count">{provider.modelCount}</span></span>
                <span className="mt-1 block text-[11px] font-normal leading-4 text-muted-foreground">{provider.connections.length} 个接口</span>
                <span className="block break-all font-mono text-[10.5px] font-normal leading-4 text-muted-foreground">{provider.host}</span>
              </span>
            </Button>;
          })}
          {snapshot?.connections.length === 0 ? <p className="models-help px-2 py-3">还没有服务商</p> : null}
        </nav>
        <p className="models-sidebar-note">Droid 内置模型仍在聊天输入框旁的模型菜单中选择。</p>
      </aside>
      <section className="models-main" aria-label="模型列表" aria-busy={busy}>
        <div className="models-main-content">
          {!panelOpen ? <ModelsFeedback page={page} /> : null}
          {snapshot === null ? busy ? <DroidLoading label="正在读取模型配置…" detail="等待本地 Droid 返回。" />
            : <div className="models-empty"><SlidersHorizontal /><h2>暂时无法读取模型</h2><p className="models-help">请检查 Droid 是否已登录，然后刷新重试。</p>
              <Button variant="outline" disabled={busy} onClick={() => void run({ kind: 'refresh' })}>重新读取</Button>
            </div>
          : connection === null ? <div className="models-empty"><SlidersHorizontal /><h2>添加你的第一个模型</h2>
              <p className="models-help">添加服务商接口，再选择或填写模型 ID。</p>
              <Button disabled={disabled} onClick={startAdding}><Plus />添加模型</Button>
            </div>
          : <>
            {current ? <div className="models-current"><Check className="size-3.5 shrink-0" /><span className="min-w-0 break-words">当前聊天使用 <strong className="font-medium">{current.displayName || current.model}</strong></span></div> : null}
            <header className="models-section-header">
              <div className="min-w-0">
                <div className="flex items-center gap-2"><h2 className="break-words">{page.group?.name}</h2>
                  <Button variant="ghost" size="icon-sm" aria-label="修改服务商别名" title="修改服务商别名" disabled={disabled} onClick={() => {
                    if (page.group) { manager.setNotice(null); setAlias({ kind: 'provider', host: page.group.host, name: page.group.name }); }
                  }}><Pencil /></Button>
                </div>
                <p className="models-help mt-1">{page.group?.connections.length} 个接口 · {page.group?.modelCount} 个模型配置</p>
              </div>
              <Button variant="outline" size="sm" disabled={disabled} onClick={() => newConnection(true)}><Plus />添加接口</Button>
            </header>
            <div className="models-interface">
              <div className="models-interface-toolbar">
                <div className="models-field min-w-0 flex-1"><span id="models-interface-label">兼容接口</span>
                  <Select value={connection.id} disabled={disabled} onValueChange={(id) => { page.setSelectedId(id); manager.setNotice(null); }}>
                    <SelectTrigger aria-labelledby="models-interface-label" className="w-full"><SelectValue>
                      {PROTOCOLS[connection.protocol].name} · {connection.name}
                    </SelectValue></SelectTrigger>
                    <SelectContent>{page.group?.connections.map((source) => <SelectItem key={source.id} value={source.id}
                      textValue={`${PROTOCOLS[source.protocol].name} ${source.name} ${source.baseUrl}`}>
                      <span className="block">{PROTOCOLS[source.protocol].name} · {source.name}</span>
                      <span className="block break-all font-mono text-[11px] text-muted-foreground">{source.baseUrl}</span>
                    </SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <Button variant="ghost" size="sm" disabled={disabled} onClick={editConnection}><Settings2 />接口设置</Button>
              </div>
              <p className="models-help break-all font-mono">{connection.baseUrl}</p>
              <p className="models-help">{connection.name} · {models.length} 个模型
                {connection.imported ? ' · 来自 Droid 设置' : ''} · {connection.hasKey ? '已配置密钥' : '未配置密钥'}
              </p>
              <p className="models-help">此处只切换查看接口，点击模型旁的“使用此模型”才会切换当前聊天。</p>
            </div>
            <div className="models-search"><Search aria-hidden /><Input type="search" className="h-[34px] rounded-none border-0 bg-transparent px-0 focus-visible:border-transparent focus-visible:ring-0" aria-label="搜索已配置模型" placeholder="搜索模型名称或 Model ID" value={page.search} onChange={(event) => page.setSearch(event.target.value)} /></div>
            {!snapshot.canApply && snapshot.applyMessage ? <p role="status" className="models-help">暂时无法切换模型：{snapshot.applyMessage}</p> : null}
            <ModelList models={visible} snapshot={snapshot} disabled={disabled} onAction={(action) => { void run(action); }}
              onRename={(model) => { manager.setNotice(null); setAlias({ kind: 'model', model }); }}
              onEdit={(model) => { manager.setNotice(null); page.setModelForm({ model }); }} />
            {visible.length === 0 ? <div className="models-empty models-empty-compact">
              <h3>{models.length === 0 ? '这个接口还没有模型' : '没有匹配的模型'}</h3>
              <p className="models-help">{models.length === 0 ? '可以获取服务方的模型列表，也可以手动填写 ID。' : '换一个名称或 ID 试试。'}</p>
              <Button variant="outline" disabled={disabled} onClick={models.length === 0 ? startAdding : () => page.setSearch('')}>{models.length === 0 ? '添加模型' : '清除搜索'}</Button>
            </div> : null}
          </>}
        </div>
      </section>
    </div>
      <DialogContent className="models-panel top-[6%] w-[calc(100%-32px)] max-h-[88%] max-w-[560px] rounded-xl border-[var(--panel-edge)] p-6 max-[540px]:w-[calc(100%-16px)] max-[540px]:p-4" closeDisabled={busy} closeLabel="关闭面板"
        onInteractOutside={(event) => event.preventDefault()}>
        <header className="mb-5 pr-7"><DialogTitle className="text-lg font-semibold">{panelTitle}</DialogTitle><DialogDescription className="models-help mt-1.5">{panelDescription}</DialogDescription></header>
        <ModelsFeedback page={page} />
        {alias !== null ? <AliasForm key={alias.kind === 'provider' ? alias.host : `${alias.model.rawIndex}:${alias.model.model}`}
          name={alias.kind === 'provider' ? alias.name : alias.model.displayName} label={alias.kind === 'provider' ? '服务商别名' : '模型别名'}
          maxLength={alias.kind === 'provider' ? 80 : 160} busy={busy} onCancel={closePanel} onSave={(name) => {
            void run(alias.kind === 'provider' ? { kind: 'renameProvider', providerHost: alias.host, name }
              : { kind: 'renameModel', rawIndex: alias.model.rawIndex, expectedModel: alias.model.model, name })
              .then((result) => { if (result.ok) closePanel(); });
          }} />
        : page.connectionForm !== null ? <>
          <ConnectionForm key={page.connectionForm.connection?.id ?? 'new'} connection={page.connectionForm.connection} defaults={connectionDefaults} busy={busy}
            onCancel={() => adding ? page.setConnectionForm(null) : closePanel()}
            onSave={(draft) => { void page.saveConnection(draft).then((saved) => { if (saved && adding) setAddStep('models'); }); }} />
          {page.connectionForm.connection && models.length === 0 ? <div className="mt-5 border-t border-border pt-4">
            <Button variant="ghost" size="sm" className="text-destructive" disabled={busy} onClick={() => {
              void run({ kind: 'deleteConnection', connectionId: page.connectionForm!.connection!.id }).then((result) => { if (result.ok) closePanel(); });
            }}>移除这个空接口</Button>
          </div> : null}
        </> : page.modelForm !== null && connection ? <ModelForm key={page.modelForm.model?.rawIndex ?? 'new'}
          model={page.modelForm.model} connection={connection} busy={busy} onCancel={closePanel}
          onSave={(draft, verify) => { void page.saveModel(draft, verify); }} />
        : adding ? <AddModels page={page} step={addStep} onStepChange={setAddStep} onDone={closePanel}
            onNewConnection={() => newConnection()} />
        : null}
      </DialogContent>
  </main></Dialog>;
}

function ModelsFeedback({ page }: { readonly page: ModelsPageState }) {
  const { pending, notice, cancel } = page.manager;
  const labels: Record<string, string> = {
    refresh: '正在读取模型配置…', saveConnection: '正在保存接口，请留意 Cursor 的输入提示…',
    renameProvider: '正在保存服务商别名…', renameModel: '正在保存模型别名…',
    discover: '正在获取模型列表…', importModels: '正在添加所选模型…',
    saveModel: '正在保存模型…', deleteModel: '正在删除模型…', deleteConnection: '正在移除接口…',
    verifyModel: '正在等待模型验证结果…', useModel: '正在切换聊天模型…',
  };
  return <>
    {notice ? <p role={notice.ok ? 'status' : 'alert'} className={`models-feedback ${notice.ok ? '' : 'text-destructive'}`}>
      <span className="font-medium">{notice.ok ? '已完成' : '操作未完成'}</span><span>{notice.message}</span>
    </p> : null}
    {pending && (pending !== 'refresh' || page.manager.snapshot !== null) ? <div role="status" className="models-feedback"><DroidActivity phase="loading" /><span className="flex-1">{labels[pending] ?? '等待 Droid 确认…'}</span>
      <Button variant="ghost" size="sm" onClick={cancel}>取消操作</Button>
    </div> : null}
  </>;
}
