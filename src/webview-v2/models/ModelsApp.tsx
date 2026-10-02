import { useCallback, useEffect, useState } from 'react';
import { Check, Info, KeyRound, Pencil, Plus, RefreshCw, Search, Server, Settings2, SlidersHorizontal } from 'lucide-react';
import type { ManagedModel, ModelConnection } from '../../shared/protocol/modelManagerProtocol';
import type { ModelsTransport } from './useModels';
import { useModelsPage } from './useModelsPage';
import { PROTOCOLS } from './protocols';
import { readBootThemePreference } from '../shell/themeController';
import { applyTheme } from '../shell/theme';
import { Button } from '../ui/button';
import { DroidActivity, DroidLoading } from '../ui/droid-motion';
import { Input } from '../ui/input';
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '../ui/overlays';
import { AliasForm, ConnectionForm, ModelForm } from './ModelForms';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/selection';
import { AddModels, type ModelsPageState } from './AddModels';
import { ModelList } from './ModelList';
import { ModelSourceControl, ModelSourceProvider } from './ModelSourceControl';
import type { ModelSourceRequest } from '../../shared/protocol/modelSourceProtocol';

export function ModelsApp({ transport }: { readonly transport: ModelsTransport }) {
  const postModelSource = useCallback((message: ModelSourceRequest) => transport.postModelSourceMessage?.(message), [transport]);
  return <ModelSourceProvider postMessage={postModelSource}><ModelsPage transport={transport} /></ModelSourceProvider>;
}

function ModelsPage({ transport }: { readonly transport: ModelsTransport }) {
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
    setAddStep(connection ? 'models' : 'source');
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
    : '复用接口连接，选择需要的模型。保存后可在聊天中选用。';

  return <Dialog open={panelOpen} onOpenChange={(open) => { if (!open && !busy) closePanel(); }}><main className="models-page">
    <header className="models-page-header">
      <div className="models-page-title"><SlidersHorizontal aria-hidden /><div><h1>模型管理</h1><p className="models-help">管理服务商与自定义模型</p></div></div>
      <div className="models-header-actions">
        {current ? <span className="models-current" title={`当前聊天使用 ${current.displayName || current.model}`}><Check aria-hidden /><span>聊天中 · <strong>{current.displayName || current.model}</strong></span></span> : null}
        <Button variant="ghost" size="icon" className="size-8" aria-label="刷新模型配置" title="刷新模型配置" disabled={disabled} onClick={() => void run({ kind: 'refresh' })}><RefreshCw /></Button>
        <DialogTrigger asChild><Button className="h-8" disabled={disabled || !snapshot} onClick={startAdding}><Plus />添加模型</Button></DialogTrigger>
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
              title={`${provider.name}\n${provider.host} · ${provider.connections.length} 个接口 · ${provider.modelCount} 个模型`}
              aria-current={provider.host === page.group?.host ? 'page' : undefined} onClick={() => {
                page.selectProvider(provider); manager.setNotice(null);
              }}>
              <Server className="models-source-icon" aria-hidden />
              <span className="models-source-name"><span>{provider.name}</span>
                {provider.name !== provider.host ? <span className="models-source-host">{provider.host}</span> : null}
              </span>
              <span className="models-source-count" aria-label={`${provider.modelCount} 个模型`}>{provider.modelCount}</span>
            </Button>;
          })}
          {snapshot?.connections.length === 0 ? <p className="models-help px-2 py-3">还没有服务商</p> : null}
        </nav>
        <p className="models-sidebar-note">Droid 内置模型仍在聊天输入框旁的模型菜单中选择。</p>
      </aside>
      <section className="models-main" aria-label="模型列表" aria-busy={busy}>
        <div className="models-main-content">
          <section aria-label="聊天模型选择范围" className="mb-5 space-y-2 rounded-md border border-border p-3">
            <h2 className="text-sm font-medium">聊天模型选择范围</h2>
            <ModelSourceControl className="max-w-sm" />
            <p className="models-help">官方显示 Droid 内置模型，BYOK 显示自定义模型，混合显示全部。同步到聊天、Spec、侧聊和 Mission 的模型选择。</p>
            <p className="models-help">下方管理 BYOK 接口与配置；切换显示范围不会改变已选模型。</p>
          </section>
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
            <header className="models-section-header">
              <div className="min-w-0">
                <div className="flex items-center gap-2"><h2 className="break-words">{page.group?.name}</h2>
                  <Button variant="ghost" size="icon-sm" aria-label="修改服务商别名" title="修改服务商别名" disabled={disabled} onClick={() => {
                    if (page.group) { manager.setNotice(null); setAlias({ kind: 'provider', host: page.group.host, name: page.group.name }); }
                  }}><Pencil /></Button>
                </div>
                <p className="models-help mt-1">{page.group?.connections.length} 个接口 · {page.group?.modelCount} 个模型</p>
              </div>
              <Button variant="outline" size="sm" className="h-8" disabled={disabled} onClick={() => newConnection(true)}><Plus />添加接口</Button>
            </header>
            <div className="models-interface">
              <div className="models-interface-details">
                {(page.group?.connections.length ?? 0) > 1 ? <Select value={connection.id} disabled={disabled} onValueChange={(id) => { page.setSelectedId(id); manager.setNotice(null); }}>
                  <SelectTrigger aria-label="兼容接口" className="models-interface-select h-8"><SelectValue>
                    {PROTOCOLS[connection.protocol].name} · {connection.name}
                  </SelectValue></SelectTrigger>
                  <SelectContent>{page.group?.connections.map((source) => <SelectItem key={source.id} value={source.id}
                    textValue={`${PROTOCOLS[source.protocol].name} ${source.name} ${source.baseUrl}`}>
                    <span className="block">{PROTOCOLS[source.protocol].name} · {source.name}</span>
                    <span className="block break-all font-mono text-[11px] text-muted-foreground">{source.baseUrl}</span>
                  </SelectItem>)}</SelectContent>
                </Select> : <p className="models-interface-name">{PROTOCOLS[connection.protocol].name}</p>}
                <p className="models-interface-url" title={connection.baseUrl}>{connection.baseUrl}</p>
              </div>
              <span className="models-interface-key" title={connection.imported ? '来自 Droid 设置' : undefined}><KeyRound aria-hidden />{connection.hasKey ? '密钥已配置' : '未配置密钥'}</span>
              <Button variant="ghost" size="sm" className="h-8" disabled={disabled} onClick={editConnection}><Settings2 aria-hidden />接口设置</Button>
            </div>
            <div className="models-list-toolbar"><h3>模型 <span>{page.search ? `${visible.length} / ${models.length}` : models.length}</span></h3>
              <div className="models-search"><Search aria-hidden /><Input type="search" className="h-8 rounded-none border-0 bg-transparent px-0 focus-visible:border-transparent focus-visible:ring-0" aria-label="搜索已配置模型" placeholder="搜索名称或 Model ID" value={page.search} onChange={(event) => page.setSearch(event.target.value)} /></div>
            </div>
            {!snapshot.canApply && snapshot.applyMessage ? <p id="models-apply-status" role="status" className="models-apply-status"><Info aria-hidden /><span>{modelApplyMessage(snapshot.applyMessage)}</span></p> : null}
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
      <DialogContent className="models-panel flex top-[5%] w-[calc(100%-32px)] max-h-[90dvh] max-w-[640px] flex-col overflow-hidden border-[var(--panel-edge)] p-0 max-[540px]:top-[3%] max-[540px]:w-[calc(100%-16px)] max-[540px]:max-h-[94dvh]" closeDisabled={busy} closeLabel="关闭面板"
        onInteractOutside={(event) => event.preventDefault()}>
        <header className="models-panel-header"><span className="models-panel-symbol"><SlidersHorizontal aria-hidden /></span>
          <div><DialogTitle>{panelTitle}</DialogTitle><DialogDescription className="models-help">{panelDescription}</DialogDescription></div>
        </header>
        <div className="models-panel-body">
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
          model={page.modelForm.model} connection={connection} busy={busy} existingModels={snapshot?.models} onCancel={closePanel}
          onSave={(draft, verify) => { void page.saveModel(draft, verify); }} />
        : adding ? <AddModels page={page} step={addStep} onStepChange={setAddStep} onDone={closePanel}
            onNewConnection={() => newConnection()} />
        : null}
        </div>
      </DialogContent>
  </main></Dialog>;
}

function modelApplyMessage(message: string): string {
  if (message === 'Connect a chat before selecting a model here.') return '连接聊天后，即可在这里切换模型。';
  if (message === 'Finish the current task, queued messages or interaction before changing the chat model.') {
    return '聊天正在处理任务或等待操作，完成后即可切换模型。';
  }
  return message;
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
    {pending && (pending !== 'refresh' || page.manager.snapshot !== null) ? <div role="status" className="models-feedback models-feedback-pending"><DroidActivity phase="loading" /><span className="flex-1">{labels[pending] ?? '等待 Droid 确认…'}</span>
      <Button variant="ghost" size="sm" onClick={cancel}>取消操作</Button>
    </div> : null}
  </>;
}
