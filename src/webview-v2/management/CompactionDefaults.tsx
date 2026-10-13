import { useI18n } from '@droidvisx/chat-ui/i18n';
import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { ManagementRow } from './ManagementFields';
import { SettingsSection } from '@droidvisx/chat-ui/ui/settings';
import { useDefaultsFields, type DefaultsFieldsProps } from './DefaultsFields';
import { SettingsModelPicker } from '../models/SettingsModelPicker';

export function CompactionDefaults(props: DefaultsFieldsProps) {
  const { t } = useI18n();
  const f = useDefaultsFields(props);
  const [model, setModel] = useState<string>();
  const [limit, setLimit] = useState('');
  const raw = props.values.compactionTokenLimitPerModel;
  const overrides = raw && typeof raw === 'object' ? raw : {};
  const locked = f.disabled('compactionTokenLimitPerModel');
  const available = f.modelOptions.filter(o => !(o.value in overrides));
  const count = Number(limit);
  return <SettingsSection title={t("上下文压缩")}>
      {f.number('compactionTokenLimit', '默认 Token 上限')}
      {Object.entries(overrides).map(([id, tokens]) => <ManagementRow key={id} label={props.snapshot.models.find(m => m.id === id)?.label ?? id}>
        <div className="management-default-override"><Input type="number" aria-label={t("{p0} 的 Token 上限", { p0: id })} min={1} step={1} disabled={locked}
          value={Number.isFinite(tokens) ? tokens : ''} onChange={e => props.update({ compactionTokenLimitPerModel: { ...overrides, [id]: e.target.value === '' ? NaN : Number(e.target.value) } })} />
          <Button variant="plain" size="icon-sm" aria-label={t("移除 {p0} 的 Token 上限", { p0: id })} disabled={locked} onClick={() => {
            const next = { ...overrides }; delete next[id]; props.update({ compactionTokenLimitPerModel: next });
          }}><Trash2 /></Button></div>
      </ManagementRow>)}
      {f.row('compactionTokenLimitPerModel', '添加模型上限', <div className="management-default-override management-default-override-add">
        <SettingsModelPicker label={t('覆盖上限的模型')} modelId={model} models={f.pickerModels.filter(item => !(item.id in overrides))} disabled={locked || !available.length}
          nonce={document.querySelector<HTMLScriptElement>('script[nonce]')?.nonce} onModelChange={id => setModel(id ?? undefined)} />
        <Input type="number" aria-label={t("模型 Token 上限")} placeholder={t("Tokens")} min={1} step={1} disabled={locked} value={limit} onChange={e => setLimit(e.target.value)} />
        <Button variant="outline" size="sm" aria-label={t("添加模型上限")} disabled={locked || !model || !available.some(o => o.value === model && !o.disabled) || !Number.isSafeInteger(count) || count <= 0}
          onClick={() => { if (model) { props.update({ compactionTokenLimitPerModel: { ...overrides, [model]: count } }); setModel(undefined); setLimit(''); } }}><Plus />{t("添加")}</Button>
      </div>)}
      {f.row('compactionModel', '压缩模型', <SettingsModelPicker label={t('压缩模型')} modelId={f.text('compactionModel')} disabled={f.disabled('compactionModel')}
        models={[{ id: 'current-model', label: t('当前会话模型'), sourceIndependent: true }, ...f.pickerModels]}
        nonce={document.querySelector<HTMLScriptElement>('script[nonce]')?.nonce} onModelChange={id => { if (id) props.update({ compactionModel: id }); }} />)}
      {f.toggle('compactionThresholdCheckEnabled', '达到上限时自动压缩', '新会话达到配置的 Token 上限后自动压缩上下文。')}
  </SettingsSection>;
}
