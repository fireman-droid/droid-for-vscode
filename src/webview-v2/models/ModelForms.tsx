import { useId, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { CUSTOM_MODEL_PROVIDERS, MAX_CUSTOM_MODEL_OUTPUT_TOKENS, type CustomModelProvider } from '../../shared/protocol/customModelsProtocol';
import type { ConnectionDraft, ManagedModel, ManagedModelDraft, ModelConnection } from '../../shared/protocol/modelManagerProtocol';
import { PROTOCOLS } from '../../webview/models/protocols';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Checkbox, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/selection';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible';

const protocolHints: Record<CustomModelProvider, string> = {
  'generic-chat-completion-api': '大多数第三方 OpenAI 兼容服务使用此项。',
  openai: '仅用于支持 Responses API 的服务，不是 Chat Completions。',
  anthropic: '用于支持 Anthropic Messages API 的服务。',
};

export function ConnectionForm({ connection, defaults, busy, onSave, onCancel }: {
  readonly connection: ModelConnection | null;
  readonly defaults?: Pick<ModelConnection, 'name' | 'baseUrl'>;
  readonly busy: boolean;
  readonly onSave: (draft: ConnectionDraft) => void;
  readonly onCancel: () => void;
}) {
  const protocolId = useId();
  const [name, setName] = useState(connection?.name ?? defaults?.name ?? '');
  const [protocol, setProtocol] = useState<CustomModelProvider>(connection?.protocol ?? 'generic-chat-completion-api');
  const [baseUrl, setBaseUrl] = useState(connection?.baseUrl ?? defaults?.baseUrl ?? '');
  const [setApiKey, setSetApiKey] = useState(connection === null);
  return <form className="models-form" onSubmit={(event) => {
    event.preventDefault();
    onSave({ ...(connection === null ? {} : { id: connection.id }), name: name.trim(), protocol, baseUrl: baseUrl.trim(), setApiKey });
  }}>
    <fieldset disabled={busy} className="space-y-5">
      <label className="models-field">接口别名<Input autoFocus required maxLength={80} value={name} placeholder="例如：官方接口、备用线路" onChange={(event) => setName(event.target.value)} />
        <span className="models-help">仅标识此接口，不改服务商别名或模型名称。同一域名的兼容接口归为一组。</span>
      </label>
      <label className="models-field">接口地址 <span className="models-optional">Base URL</span>
        <Input required type="url" maxLength={2048} value={baseUrl} placeholder="https://gateway.example.com/v1" onChange={(event) => setBaseUrl(event.target.value)} />
        <span className="models-help">填写服务方提供的基础地址及路径，不要填写密钥或最终请求路由。</span>
      </label>
      <div className="models-field">
        <label htmlFor={protocolId}>接口类型</label>
        <Select value={protocol} disabled={busy} onValueChange={(value) => setProtocol(value as CustomModelProvider)}>
          <SelectTrigger id={protocolId} className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>{CUSTOM_MODEL_PROVIDERS.map((value) => <SelectItem key={value} value={value}>{PROTOCOLS[value].name}</SelectItem>)}</SelectContent>
        </Select>
        <p className="models-help">{protocolHints[protocol]}</p>
      </div>
      <div className="models-key-note">
        <label className="flex items-center gap-2 text-[13px]"><Checkbox disabled={busy} checked={setApiKey} onCheckedChange={(checked) => setSetApiKey(checked === true)} />
          {connection?.hasKey ? '保存时更换 API Key' : '保存后输入 API Key'}
        </label>
        <p className="models-help mt-2">{connection?.hasKey ? '已有密钥不会显示在此页面。不勾选则保留原密钥。' : '如果接口无需密钥，可取消勾选。'}
          {' '}输入一次后安全保存，同一接口的模型共用；其他兼容接口的密钥独立保存。</p>
        {connection?.imported ? <p className="models-help mt-2">已有模型验证直接使用 Droid 保存的配置。首次获取列表或新增模型如需补输密钥，后续会自动复用。</p> : null}
      </div>
      <div className="models-form-actions"><Button variant="ghost" onClick={onCancel}>取消</Button><Button type="submit">{busy ? '正在保存…' : setApiKey ? '保存并输入密钥' : '保存接口'}</Button></div>
    </fieldset>
  </form>;
}

export function AliasForm({ name, label, maxLength, busy, onSave, onCancel }: {
  readonly name: string;
  readonly label: string;
  readonly maxLength: number;
  readonly busy: boolean;
  readonly onSave: (name: string) => void;
  readonly onCancel: () => void;
}) {
  const [value, setValue] = useState(name);
  return <form className="models-form" onSubmit={(event) => { event.preventDefault(); onSave(value.trim()); }}>
    <fieldset disabled={busy} className="space-y-5">
      <label className="models-field">{label}<Input autoFocus required maxLength={maxLength} value={value} onChange={(event) => setValue(event.target.value)} /></label>
      <p className="models-help">只修改显示名称，不修改接口地址、Model ID 或已保存的密钥。</p>
      <div className="models-form-actions"><Button variant="ghost" onClick={onCancel}>取消</Button>
        <Button type="submit" disabled={!value.trim()}>保存别名</Button>
      </div>
    </fieldset>
  </form>;
}

export function ModelForm({ model, connection, busy, onSave, onCancel }: {
  readonly model: ManagedModel | null;
  readonly connection: ModelConnection;
  readonly busy: boolean;
  readonly onSave: (draft: ManagedModelDraft, verify: boolean) => void;
  readonly onCancel: () => void;
}) {
  const [id, setId] = useState(model?.model ?? '');
  const [name, setName] = useState(model?.displayName ?? '');
  const [tokens, setTokens] = useState(model?.maxOutputTokens?.toString() ?? '');
  const [noImages, setNoImages] = useState(model?.noImageSupport ?? false);
  const [advanced, setAdvanced] = useState(false);
  return <form className="models-form" onSubmit={(event) => {
    event.preventDefault();
    onSave({
      connectionId: connection.id,
      ...(model === null ? {} : { rawIndex: model.rawIndex, expectedModel: model.model }),
      model: id.trim(), displayName: name.trim(), maxOutputTokens: tokens === '' ? null : Number(tokens), noImageSupport: noImages,
    }, (event.nativeEvent as SubmitEvent).submitter?.getAttribute('value') === 'verify');
  }}>
    <fieldset disabled={busy} className="space-y-5">
      <label className="models-field">Model ID<Input required autoFocus maxLength={256} value={id} placeholder="填写服务方提供的完整模型 ID" onChange={(event) => setId(event.target.value)} />
        <span className="models-help">模型将添加到「{connection.name}」。这里需要真实 ID，不是自定义昵称。</span>
      </label>
      <label className="models-field">模型别名 <span className="models-optional">可选</span><Input maxLength={160} value={name} placeholder="留空时使用模型 ID" onChange={(event) => setName(event.target.value)} />
        <span className="models-help">按你填写的名称显示，不自动添加后缀。不同接口的模型请使用不同别名，供 Droid 识别。</span>
      </label>
      <Collapsible open={advanced} onOpenChange={setAdvanced} className="models-advanced">
        <CollapsibleTrigger asChild><Button disabled={busy} variant="plain" size="none" className="flex w-full items-center justify-between py-2 text-[13px] text-muted-foreground">
          高级设置 <ChevronDown className={`size-3.5 transition-transform ${advanced ? 'rotate-180' : ''}`} />
        </Button></CollapsibleTrigger>
        <CollapsibleContent forceMount hidden={!advanced}>
          <div className="space-y-4 pb-2 pt-3">
            <label className="models-field">最大输出 Token <span className="models-optional">可选</span><Input type="number" min={1} max={MAX_CUSTOM_MODEL_OUTPUT_TOKENS} step={1} value={tokens} placeholder="使用 Droid 默认值" onChange={(event) => setTokens(event.target.value)} onInvalid={() => setAdvanced(true)} /></label>
            <label className="flex items-center gap-2 text-[13px]"><Checkbox disabled={busy} checked={noImages} onCheckedChange={(checked) => setNoImages(checked === true)} />此模型不支持图片输入</label>
            <Button variant="outline" type="submit" value="verify" size="sm">保存并验证…</Button>
            <p className="models-help">验证会请求一次真实模型回复，由 Droid 确认后执行。</p>
          </div>
        </CollapsibleContent>
      </Collapsible>
      <div className="models-form-actions"><Button variant="ghost" onClick={onCancel}>取消</Button><Button type="submit">{busy ? '正在保存…' : model ? '保存修改' : '添加模型'}</Button></div>
    </fieldset>
  </form>;
}
