import { useId, useState } from 'react';
import { ArrowLeft, ArrowRight, Download, Plus, Search } from 'lucide-react';
import type { useModelsPage } from '../../webview/models/useModelsPage';
import { PROTOCOLS } from '../../webview/models/protocols';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Checkbox, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/selection';
import { ModelForm } from './ModelForms';

export type ModelsPageState = ReturnType<typeof useModelsPage>;

export function AddModels({ page, step, onStepChange, onNewConnection, onDone }: {
  readonly page: ModelsPageState;
  readonly step: 'source' | 'models';
  readonly onStepChange: (step: 'source' | 'models') => void;
  readonly onNewConnection: () => void;
  readonly onDone: () => void;
}) {
  const sourceId = useId();
  const providerId = useId();
  const [mode, setMode] = useState('discover');
  const { connection, busy, discovered } = page;
  return <div className="space-y-5">
    <ol className="models-steps" aria-label="添加步骤">
      <li aria-current={step === 'source' ? 'step' : undefined}><span>1</span>选择服务商和接口</li>
      <li aria-current={step === 'models' ? 'step' : undefined}><span>2</span>添加模型</li>
    </ol>
    {step === 'source' ? <>
      {page.groups.length ? <>
      <div className="models-field">
        <label htmlFor={providerId}>服务商</label>
        <Select value={page.group?.host} disabled={busy} onValueChange={(host) => {
          const provider = page.groups.find((item) => item.host === host);
          if (provider) page.selectProvider(provider);
        }}>
          <SelectTrigger id={providerId} className="w-full"><SelectValue placeholder="选择服务商">{page.group?.name}</SelectValue></SelectTrigger>
          <SelectContent>{page.groups.map((provider) => <SelectItem key={provider.host} value={provider.host} textValue={`${provider.name} ${provider.host}`}>
            <span className="block">{provider.name}</span><span className="block text-[11px] text-muted-foreground">{provider.host}</span>
          </SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div className="models-field">
        <label htmlFor={sourceId}>兼容接口</label>
        <Select value={connection?.id} disabled={busy} onValueChange={page.setSelectedId}>
          <SelectTrigger id={sourceId} className="w-full"><SelectValue placeholder="选择兼容接口">
            {connection ? `${PROTOCOLS[connection.protocol].name} · ${connection.name}` : null}
          </SelectValue></SelectTrigger>
          <SelectContent>{page.group?.connections.map((source) => <SelectItem key={source.id} value={source.id} textValue={`${PROTOCOLS[source.protocol].name} ${source.name} ${source.baseUrl}`}>
            <span className="block">{PROTOCOLS[source.protocol].name} · {source.name}</span>
            <span className="block break-all font-mono text-[11px] text-muted-foreground">{source.baseUrl}</span>
          </SelectItem>)}</SelectContent>
        </Select>
        {connection ? <p className="models-help break-all">{PROTOCOLS[connection.protocol].name}<br /><span className="font-mono">{connection.baseUrl}</span></p> : null}
      </div></> : <p className="models-help">先添加模型服务的接口地址，下一步再选择具体模型。</p>}
      <Button variant="outline" className="w-full" disabled={busy} onClick={onNewConnection}><Plus />添加服务商接口</Button>
      <div className="models-form-actions"><Button variant="ghost" disabled={busy} onClick={onDone}>取消</Button>
        <Button disabled={busy || !connection} onClick={() => onStepChange('models')}>下一步 <ArrowRight /></Button>
      </div>
    </> : connection ? <>
      <div className="flex items-start gap-3">
        <Button variant="ghost" size="icon-sm" aria-label="返回选择服务商和接口" disabled={busy} onClick={() => onStepChange('source')}><ArrowLeft /></Button>
        <div className="min-w-0"><p className="text-[13px] font-medium">{page.group?.name} · {connection.name}</p>
          <p className="models-help">{PROTOCOLS[connection.protocol].name}</p><p className="models-help break-all font-mono">{connection.baseUrl}</p>
        </div>
      </div>
      <Tabs value={mode} onValueChange={setMode}>
        <TabsList className="mb-4">
          <TabsTrigger value="discover" disabled={busy}>从服务获取</TabsTrigger>
          <TabsTrigger value="manual" disabled={busy}>手动填写 ID</TabsTrigger>
        </TabsList>
        <TabsContent value="discover" forceMount hidden={mode !== 'discover'}>
          {discovered === null ? <div className="models-discover-empty">
            <Download className="size-6 text-muted-foreground" />
            <p className="text-[13px] font-medium">获取这个接口提供的模型</p>
            <p className="models-help">只读取模型列表，不会自动添加或切换模型。服务不支持时，可以手动填写 ID。</p>
            <Button disabled={busy} onClick={() => void page.discoverModels(connection.id)}>{busy ? '正在获取…' : '获取模型列表'}</Button>
          </div> : <DiscoveredModels key={connection.id} page={page} onDone={onDone} />}
        </TabsContent>
        <TabsContent value="manual" forceMount hidden={mode !== 'manual'}>
          <ModelForm key={connection.id} model={null} connection={connection} busy={busy}
            onSave={(draft, verify) => { void page.saveModel(draft, verify).then((saved) => { if (saved) { page.setSearch(''); onDone(); } }); }} onCancel={onDone} />
        </TabsContent>
      </Tabs>
    </> : null}
  </div>;
}

function DiscoveredModels({ page, onDone }: { readonly page: ModelsPageState; readonly onDone: () => void }) {
  const [search, setSearch] = useState('');
  const { connection, discovered, models, chosen, busy } = page;
  const filtered = discovered?.filter((item) => item.model.toLowerCase().includes(search.trim().toLowerCase())) ?? [];
  return <div className="space-y-3">
    <div className="models-search"><Search aria-hidden /><Input type="search" className="h-[34px] rounded-none border-0 bg-transparent px-0 focus-visible:border-transparent" aria-label="筛选发现的模型" placeholder="搜索 Model ID…" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
    <p className="models-help">已获取 {discovered?.length ?? 0} 个模型，选择需要添加的项。每次最多 100 个。</p>
    <div className="models-discovery-list">{filtered.map((item) => {
      const exists = models.some((model) => model.model === item.model);
      return <label key={item.model} className="models-discovery-row">
        <Checkbox checked={exists || chosen.has(item.model)} disabled={busy || exists || (!chosen.has(item.model) && chosen.size >= 100)} onCheckedChange={(checked) => {
          const next = new Set(chosen);
          if (checked === true) next.add(item.model); else next.delete(item.model);
          page.setChosen(next);
        }} />
        <code className="min-w-0 flex-1 break-all text-xs">{item.model}</code>
        {exists ? <span className="shrink-0 text-[11px] text-muted-foreground">已添加</span> : null}
      </label>;
    })}
      {filtered.length === 0 ? <p className="models-help p-3">{discovered?.length === 0 ? '服务未返回模型。可切换到手动填写 ID。' : '没有匹配的模型。'}</p> : null}
    </div>
    <div className="models-form-actions"><Button variant="ghost" disabled={busy} onClick={onDone}>取消</Button>
      <Button disabled={busy || chosen.size === 0 || !connection} onClick={() => {
        if (connection && discovered) void page.importModels(connection.id, discovered).then((saved) => { if (saved) { page.setSearch(''); onDone(); } });
      }}>{busy ? '正在添加…' : `添加所选模型（${chosen.size}）`}</Button>
    </div>
  </div>;
}
