import { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown, LoaderCircle } from 'lucide-react';
import { CUSTOM_MODEL_PROVIDERS, type CustomModelProvider } from '../../shared/protocol/customModelsProtocol';
import type { ConnectionDraft, ManagedModel, ManagedModelDraft, ModelConnection } from '../../shared/protocol/modelManagerProtocol';
import { PROTOCOLS } from './protocols';
import { baseUrlError, modelErrors, nameError } from './modelFormValidation';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Checkbox, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/selection';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible';

const protocolHints: Record<CustomModelProvider, string> = {
  'generic-chat-completion-api': '大多数第三方 OpenAI 兼容服务使用此项。',
  openai: '适用于 Responses API。仅支持 Chat Completions 的接口请选择 OpenAI Chat Completions。',
  anthropic: '用于支持 Anthropic Messages API 的服务。',
};

function FieldError({ id, message }: { readonly id: string; readonly message: string | undefined }) {
  return message ? <p id={id} className="models-field-error" role="alert">{message}</p> : null;
}

function SavingIcon({ busy }: { readonly busy: boolean }) {
  return busy ? <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin motion-reduce:animate-none" /> : null;
}

export function ConnectionForm({ connection, defaults, busy, onSave, onCancel }: {
  readonly connection: ModelConnection | null;
  readonly defaults?: Pick<ModelConnection, 'name' | 'baseUrl'>;
  readonly busy: boolean;
  readonly onSave: (draft: ConnectionDraft) => void;
  readonly onCancel: () => void;
}) {
  const formId = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const urlRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(connection?.name ?? defaults?.name ?? '');
  const [protocol, setProtocol] = useState<CustomModelProvider>(connection?.protocol ?? 'generic-chat-completion-api');
  const [baseUrl, setBaseUrl] = useState(connection?.baseUrl ?? defaults?.baseUrl ?? '');
  const [setApiKey, setSetApiKey] = useState(connection === null);
  const [touched, setTouched] = useState({ name: false, url: false });
  const invalidName = nameError(name, 80, '接口别名');
  const invalidUrl = baseUrlError(baseUrl);
  const nameMessage = touched.name ? invalidName : undefined;
  const urlMessage = touched.url ? invalidUrl : undefined;
  return <form noValidate className="models-form" aria-busy={busy} onSubmit={(event) => {
    event.preventDefault();
    if (busy) return;
    setTouched({ name: true, url: true });
    if (invalidName || invalidUrl) {
      (invalidName ? nameRef : urlRef).current?.focus();
      return;
    }
    onSave({ ...(connection === null ? {} : { id: connection.id }), name: name.trim(), protocol, baseUrl: baseUrl.trim(), setApiKey });
  }}>
    <fieldset disabled={busy} className="space-y-5">
      <p className="models-form-intro">{connection ? '更新接口信息，已添加的模型继续使用此接口。' : '先保存接口信息，再选择要使用的模型。'}</p>
      <div className="models-field">
        <label htmlFor={`${formId}-name`}>接口别名</label>
        <Input id={`${formId}-name`} ref={nameRef} autoFocus required maxLength={80} value={name} placeholder="例如：官方接口、备用线路"
          aria-invalid={!!nameMessage} aria-describedby={`${formId}-name-hint${nameMessage ? ` ${formId}-name-error` : ''}`}
          onBlur={() => setTouched((current) => ({ ...current, name: true }))} onChange={(event) => setName(event.target.value)} />
        <FieldError id={`${formId}-name-error`} message={nameMessage} />
        <p id={`${formId}-name-hint`} className="models-field-hint">方便识别线路，不会修改服务商别名或模型名称。</p>
      </div>
      <div className="models-field">
        <label htmlFor={`${formId}-url`}>接口地址 <span className="models-optional">Base URL</span></label>
        <Input id={`${formId}-url`} ref={urlRef} required type="url" maxLength={2048} value={baseUrl} placeholder="https://gateway.example.com/v1" spellCheck={false}
          aria-invalid={!!urlMessage} aria-describedby={`${formId}-url-hint${urlMessage ? ` ${formId}-url-error` : ''}`}
          onBlur={() => setTouched((current) => ({ ...current, url: true }))} onChange={(event) => setBaseUrl(event.target.value)} />
        <FieldError id={`${formId}-url-error`} message={urlMessage} />
        <p id={`${formId}-url-hint`} className="models-field-hint">填写服务方提供的基础地址及路径，不要填写密钥或最终请求路由。</p>
      </div>
      <div className="models-field">
        <label htmlFor={`${formId}-protocol`}>接口类型</label>
        <Select value={protocol} disabled={busy} onValueChange={(value) => setProtocol(value as CustomModelProvider)}>
          <SelectTrigger id={`${formId}-protocol`} className="w-full" aria-describedby={`${formId}-protocol-hint`}><SelectValue /></SelectTrigger>
          <SelectContent>{CUSTOM_MODEL_PROVIDERS.map((value) => <SelectItem key={value} value={value}>{PROTOCOLS[value].name}</SelectItem>)}</SelectContent>
        </Select>
        <p id={`${formId}-protocol-hint`} className="models-field-hint">{protocolHints[protocol]}</p>
      </div>
      <div className="models-key-note">
        <label className="models-check-label flex items-center gap-2 text-[13px]"><Checkbox disabled={busy} checked={setApiKey} onCheckedChange={(checked) => setSetApiKey(checked === true)} />
          {connection?.hasKey ? '保存时更换 API Key' : '保存后输入 API Key'}
        </label>
        <p className="models-field-hint mt-2">{connection?.hasKey ? '已有密钥不会显示在此页面。不勾选则保留原密钥。' : '如果接口无需密钥，可取消勾选。'}
          {' '}密钥会在编辑器的安全输入框中填写，同一接口的模型共用。</p>
        {connection?.imported ? <p className="models-field-hint mt-2">已有模型验证直接使用 Droid 保存的配置。首次获取列表或新增模型如需补输密钥，后续会自动复用。</p> : null}
      </div>
      <div className="models-form-actions"><Button variant="ghost" onClick={onCancel}>取消</Button><Button type="submit"><SavingIcon busy={busy} />{busy ? '正在保存…' : setApiKey ? '保存并输入密钥' : '保存接口'}</Button></div>
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
  const fieldId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(name);
  const [touched, setTouched] = useState(false);
  const error = nameError(value, maxLength, label);
  return <form noValidate className="models-form" aria-busy={busy} onSubmit={(event) => {
    event.preventDefault();
    if (busy) return;
    setTouched(true);
    if (error) { inputRef.current?.focus(); return; }
    onSave(value.trim());
  }}>
    <fieldset disabled={busy} className="space-y-5">
      <div className="models-field"><label htmlFor={fieldId}>{label}</label>
        <Input id={fieldId} ref={inputRef} autoFocus required maxLength={maxLength} value={value} onChange={(event) => setValue(event.target.value)} onBlur={() => setTouched(true)}
          aria-invalid={touched && !!error} aria-describedby={touched && error ? `${fieldId}-error` : undefined} />
        <FieldError id={`${fieldId}-error`} message={touched ? error : undefined} />
      </div>
      <p className="models-field-hint">只修改显示名称，不修改接口地址、Model ID 或已保存的密钥。</p>
      <div className="models-form-actions"><Button variant="ghost" onClick={onCancel}>取消</Button>
        <Button type="submit"><SavingIcon busy={busy} />{busy ? '正在保存…' : '保存别名'}</Button>
      </div>
    </fieldset>
  </form>;
}

export function ModelForm({ model, connection, existingModels = [], autoFocus = true, showConnection = true, busy, onSave, onCancel }: {
  readonly model: ManagedModel | null;
  readonly connection: ModelConnection;
  readonly existingModels?: readonly ManagedModel[];
  readonly autoFocus?: boolean;
  readonly showConnection?: boolean;
  readonly busy: boolean;
  readonly onSave: (draft: ManagedModelDraft, verify: boolean) => void;
  readonly onCancel: () => void;
}) {
  const formId = useId();
  const idRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const tokensRef = useRef<HTMLInputElement>(null);
  const [id, setId] = useState(model?.model ?? '');
  const [name, setName] = useState(model?.displayName ?? '');
  const [tokens, setTokens] = useState(model?.maxOutputTokens?.toString() ?? '');
  const [noImages, setNoImages] = useState(model?.noImageSupport ?? false);
  const [advanced, setAdvanced] = useState(false);
  const [focusTokens, setFocusTokens] = useState(0);
  const [touched, setTouched] = useState({ id: false, name: false, tokens: false });
  const errors = modelErrors({ id, name, tokens }, connection.id, model, existingModels);
  const idMessage = touched.id ? errors.id : undefined;
  const nameMessage = touched.name || touched.id ? errors.name : undefined;
  const tokensMessage = touched.tokens ? errors.tokens : undefined;
  useEffect(() => { if (autoFocus) idRef.current?.focus(); }, [autoFocus]);
  useEffect(() => { if (focusTokens > 0) tokensRef.current?.focus(); }, [focusTokens]);
  return <form noValidate className="models-form" aria-busy={busy} onSubmit={(event) => {
    event.preventDefault();
    if (busy) return;
    setTouched({ id: true, name: true, tokens: true });
    if (errors.tokens) setAdvanced(true);
    if (errors.id || errors.name || errors.tokens) {
      if (errors.id) idRef.current?.focus();
      else if (errors.name) nameRef.current?.focus();
      else setFocusTokens((current) => current + 1);
      return;
    }
    onSave({
      connectionId: connection.id,
      ...(model === null ? {} : { rawIndex: model.rawIndex, expectedModel: model.model, expectedConnectionId: model.connectionId }),
      model: id.trim(), displayName: name.trim(), maxOutputTokens: tokens.trim() === '' ? null : Number(tokens), noImageSupport: noImages,
    }, model?.enabled !== false && (event.nativeEvent as SubmitEvent).submitter?.getAttribute('value') === 'verify');
  }}>
    <fieldset disabled={busy} className="space-y-5">
      {showConnection ? <div className="models-form-intro"><span>当前接口</span><strong>{connection.name}</strong><span>{PROTOCOLS[connection.protocol].name}</span></div> : null}
      <div className="models-field">
        <label htmlFor={`${formId}-id`}>Model ID</label>
        <Input id={`${formId}-id`} ref={idRef} required maxLength={256} value={id} placeholder="填写服务方提供的完整模型 ID" spellCheck={false}
          aria-invalid={!!idMessage} aria-describedby={`${formId}-id-hint${idMessage ? ` ${formId}-id-error` : ''}`}
          onBlur={() => setTouched((current) => ({ ...current, id: true }))} onChange={(event) => setId(event.target.value)} />
        <FieldError id={`${formId}-id-error`} message={idMessage} />
        <p id={`${formId}-id-hint`} className="models-field-hint">请与服务方的 ID 保持一致，包含大小写和版本后缀。</p>
      </div>
      <div className="models-field">
        <label htmlFor={`${formId}-name`}>模型别名 <span className="models-optional">可选</span></label>
        <Input id={`${formId}-name`} ref={nameRef} maxLength={160} value={name} placeholder="留空时使用模型 ID"
          aria-invalid={!!nameMessage} aria-describedby={`${formId}-name-hint${nameMessage ? ` ${formId}-name-error` : ''}`}
          onBlur={() => setTouched((current) => ({ ...current, name: true }))} onChange={(event) => setName(event.target.value)} />
        <FieldError id={`${formId}-name-error`} message={nameMessage} />
        <p id={`${formId}-name-hint`} className="models-field-hint">用于聊天中的模型选择。同名模型会自动补充渠道标识。</p>
      </div>
      <Collapsible open={advanced} onOpenChange={setAdvanced} className="models-advanced">
        <CollapsibleTrigger asChild><Button disabled={busy} variant="plain" size="none" className="models-advanced-trigger flex w-full items-center justify-between py-2 text-[13px] text-muted-foreground">
          <span>高级设置{tokensMessage ? <span className="models-field-error"> · 需要修正</span> : null}</span><ChevronDown aria-hidden="true" className={`size-3.5 transition-transform motion-reduce:transition-none ${advanced ? 'rotate-180' : ''}`} />
        </Button></CollapsibleTrigger>
        <CollapsibleContent forceMount hidden={!advanced}>
          <div className="space-y-4 pb-2 pt-3">
            <div className="models-field">
              <label htmlFor={`${formId}-tokens`}>最大输出 Token <span className="models-optional">可选</span></label>
              <Input id={`${formId}-tokens`} ref={tokensRef} inputMode="numeric" value={tokens} placeholder="使用 Droid 默认值"
                aria-invalid={!!tokensMessage} aria-describedby={`${formId}-tokens-hint${tokensMessage ? ` ${formId}-tokens-error` : ''}`}
                onBlur={() => setTouched((current) => ({ ...current, tokens: true }))} onChange={(event) => setTokens(event.target.value)} />
              <FieldError id={`${formId}-tokens-error`} message={tokensMessage} />
              <p id={`${formId}-tokens-hint`} className="models-field-hint">仅在服务方要求时填写输出上限。</p>
            </div>
            <label className="models-check-label flex items-center gap-2 text-[13px]"><Checkbox disabled={busy} checked={noImages} onCheckedChange={(checked) => setNoImages(checked === true)} />此模型不支持图片输入</label>
            <Button variant="outline" type="submit" value="verify" size="sm" disabled={model?.enabled === false}><SavingIcon busy={busy} />保存并验证…</Button>
            <p className="models-field-hint">{model?.enabled === false ? '此模型已禁用，可保存修改；恢复后才能验证。' : '验证会请求一次真实模型回复，由 Droid 确认后执行。'}</p>
          </div>
        </CollapsibleContent>
      </Collapsible>
      <div className="models-form-actions"><Button variant="ghost" onClick={onCancel}>取消</Button><Button type="submit"><SavingIcon busy={busy} />{busy ? '正在保存…' : model ? '保存修改' : '添加模型'}</Button></div>
    </fieldset>
  </form>;
}
