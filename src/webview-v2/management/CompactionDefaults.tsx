import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { ManagementRow } from './ManagementFields';
import { DefaultsSelect, useDefaultsFields, type DefaultsFieldsProps } from './DefaultsFields';

export function CompactionDefaults(props: DefaultsFieldsProps) {
  const f = useDefaultsFields(props);
  const [model, setModel] = useState<string>();
  const [limit, setLimit] = useState('');
  const raw = props.values.compactionTokenLimitPerModel;
  const overrides = raw && typeof raw === 'object' ? raw : {};
  const locked = f.disabled('compactionTokenLimitPerModel');
  const available = f.modelOptions.filter(o => !(o.value in overrides));
  const count = Number(limit);
  return <>
    <h2 className="management-section-title">上下文压缩</h2>
    <div className="management-group">
      {f.number('compactionTokenLimit', '默认 Token 上限')}
      {Object.entries(overrides).map(([id, tokens]) => <ManagementRow key={id} label={props.snapshot.models.find(m => m.id === id)?.label ?? id}>
        <div className="management-default-override"><Input type="number" aria-label={`${id} 的 Token 上限`} min={1} step={1} disabled={locked}
          value={Number.isFinite(tokens) ? tokens : ''} onChange={e => props.update({ compactionTokenLimitPerModel: { ...overrides, [id]: e.target.value === '' ? NaN : Number(e.target.value) } })} />
          <Button variant="plain" size="icon-sm" aria-label={`移除 ${id} 的 Token 上限`} disabled={locked} onClick={() => {
            const next = { ...overrides }; delete next[id]; props.update({ compactionTokenLimitPerModel: next });
          }}><Trash2 /></Button></div>
      </ManagementRow>)}
      {f.row('compactionTokenLimitPerModel', '添加模型上限', <div className="management-default-override">
        <DefaultsSelect label="覆盖上限的模型" value={model} options={available} placeholder="选择模型" disabled={locked || !available.length} onChange={setModel} />
        <Input type="number" aria-label="模型 Token 上限" placeholder="Tokens" min={1} step={1} disabled={locked} value={limit} onChange={e => setLimit(e.target.value)} />
        <Button variant="plain" size="icon-sm" aria-label="添加模型上限" disabled={locked || !model || !available.some(o => o.value === model && !o.disabled) || !Number.isSafeInteger(count) || count <= 0}
          onClick={() => { if (model) { props.update({ compactionTokenLimitPerModel: { ...overrides, [model]: count } }); setModel(undefined); setLimit(''); } }}><Plus /></Button>
      </div>)}
      {f.choice('compactionModel', '压缩模型', [{ value: 'current-model', label: '当前会话模型' }, ...f.modelOptions])}
      {f.toggle('compactionThresholdCheckEnabled', '达到上限时自动压缩', '新会话达到配置的 Token 上限后自动压缩上下文。')}
    </div>
  </>;
}
