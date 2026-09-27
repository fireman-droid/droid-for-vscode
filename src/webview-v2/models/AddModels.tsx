import { useId, useState } from 'react';
import { ArrowRight, Check, Download, KeyRound, Plus, Server, Settings2 } from 'lucide-react';
import type { useModelsPage } from './useModelsPage';
import { PROTOCOLS } from './protocols';
import { Button } from '../ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/selection';
import { ModelForm } from './ModelForms';
import { ModelDiscovery } from './ModelDiscovery';

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
  return <div className="models-add-flow">
    <ol className="models-steps" aria-label="添加步骤">
      <li aria-current={step === 'source' ? 'step' : undefined} data-complete={step === 'models'}>
        <Button variant="plain" size="none" disabled={busy} onClick={() => onStepChange('source')}>
          <span className="models-step-number">{step === 'models' ? <Check aria-hidden /> : '1'}</span><span>连接接口</span>
        </Button>
      </li>
      <li aria-current={step === 'models' ? 'step' : undefined}>
        <Button variant="plain" size="none" disabled={busy || !connection} onClick={() => onStepChange('models')}>
          <span className="models-step-number">2</span><span>选择模型</span>
        </Button>
      </li>
    </ol>
    <section className="models-add-stage space-y-5" hidden={step !== 'source'} aria-label="选择服务商和接口">
      {page.groups.length ? <>
      <div className="models-form-intro"><h3>复用已保存的连接</h3><p className="models-help">同一接口的模型共用地址和密钥，不用重复配置。</p></div>
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
        {connection ? <p className="models-help break-all font-mono">{connection.baseUrl}</p> : null}
      </div></> : <p className="models-help">先添加模型服务的接口地址，下一步再选择具体模型。</p>}
      <Button variant="outline" className="models-new-source" disabled={busy} onClick={onNewConnection}><Plus />添加服务商接口<ArrowRight className="ml-auto" /></Button>
      <div className="models-form-actions"><Button variant="ghost" disabled={busy} onClick={onDone}>取消</Button>
        <Button disabled={busy || !connection} onClick={() => onStepChange('models')}>下一步 <ArrowRight /></Button>
      </div>
    </section>
    {connection ? <section className="models-add-stage" hidden={step !== 'models'} aria-label="选择要添加的模型">
      <div className="models-connection-summary">
        <span className="models-connection-symbol"><Server aria-hidden /></span>
        <div className="min-w-0 flex-1"><div className="models-connection-title"><p className="models-connection-name">{connection.name}</p>
          <span className="models-credential-state"><KeyRound aria-hidden />{connection.hasKey ? '密钥已保存' : '未配置密钥'}</span></div>
          <p className="models-help">{PROTOCOLS[connection.protocol].name}</p><p className="models-endpoint">{connection.baseUrl}</p>
        </div>
        <Button variant="ghost" size="sm" aria-label="返回选择服务商和接口" disabled={busy} onClick={() => onStepChange('source')}><Settings2 />更换</Button>
      </div>
      <Tabs value={mode} onValueChange={setMode} className="models-add-tabs">
        <TabsList>
          <TabsTrigger value="discover" disabled={busy}>从列表选择</TabsTrigger>
          <TabsTrigger value="manual" disabled={busy}>手动填写 ID</TabsTrigger>
        </TabsList>
        <TabsContent value="discover" forceMount hidden={mode !== 'discover'}>
          {discovered === null ? <div className="models-discover-empty">
            <span className="models-discover-symbol"><Download aria-hidden /></span>
            <h3>看看这个接口有哪些模型</h3>
            <p className="models-help">获取列表后，可搜索、批量选择并调整别名。<br />这一步不调用模型，也不会切换当前聊天。</p>
            <Button disabled={busy} onClick={() => void page.discoverModels(connection.id)}><Download />{busy ? '正在获取…' : '获取模型列表'}</Button>
            <Button variant="link" size="sm" disabled={busy} onClick={() => setMode('manual')}>已有 Model ID？手动添加</Button>
          </div> : <ModelDiscovery key={connection.id} page={page} onDone={onDone} onManual={() => setMode('manual')} />}
        </TabsContent>
        <TabsContent value="manual" forceMount hidden={mode !== 'manual'}>
          <ModelForm key={connection.id} model={null} connection={connection} busy={busy} existingModels={page.manager.snapshot?.models}
            autoFocus={mode === 'manual' && step === 'models'} showConnection={false}
            onSave={(draft, verify) => { void page.saveModel(draft, verify).then((saved) => { if (saved) { page.setSearch(''); onDone(); } }); }} onCancel={onDone} />
        </TabsContent>
      </Tabs>
    </section> : null}
  </div>;
}
