import { useId, useState } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
import { useI18n } from '../i18n';
import { Button } from './button';
import { Input } from './input';
import { Popover, PopoverContent, PopoverTrigger } from './overlays';
import { RadioGroup, RadioGroupItem } from './controls';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './selection';
import { ScrollArea } from './scroll-area';

export interface PickerModel {
  readonly id: string; readonly label: string; readonly source?: string;
  readonly reasoning?: readonly string[]; readonly defaultReasoning?: string; readonly disabledReason?: string;
}
export interface ModelPickerProps {
  label: string; models: readonly PickerModel[]; modelId?: string | null; reasoningEffort?: string | null;
  placeholder?: string; inherit?: { label: string; modelId?: string | null }; defaultEffortLabel?: string;
  disabled?: boolean; modelDisabled?: boolean; effortDisabled?: boolean; effortLabel?: string;
  onModelChange: (id: string | null) => void; onEffortChange?: (effort: string | null) => void;
  nonce?: string;
  visibleModelIds?: readonly string[];
}

/** Catalog-driven presentation; the consumer owns validation and persistence. */
export function ModelPicker({ label, models, modelId, reasoningEffort, placeholder, inherit, defaultEffortLabel,
  disabled, modelDisabled, effortDisabled, effortLabel, onModelChange, onEffortChange, nonce, visibleModelIds }: ModelPickerProps) {
  const { t } = useI18n();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const model = models.find(item => item.id === (modelId ?? inherit?.modelId));
  const inherited = modelId == null && inherit !== undefined;
  const title = inherited ? inherit.label : model?.label ?? (modelId ? t('{name} (unavailable)', { name: modelId }) : placeholder ?? t('选择模型'));
  const effortName = (effort: string) => t(effort.charAt(0).toUpperCase() + effort.slice(1));
  const effort = reasoningEffort ? effortName(reasoningEffort) : defaultEffortLabel ? t(defaultEffortLabel) : model?.defaultReasoning ? effortName(model.defaultReasoning) : '';
  const showEffort = Boolean(onEffortChange && model?.reasoning?.length);
  const showInheritance = Boolean(inherit && !query.trim());
  const filtered = models.filter(item => (visibleModelIds === undefined || visibleModelIds.includes(item.id))
    && `${item.label} ${item.id}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const groups = [...new Set(filtered.map(item => item.source ?? ''))];
  const listHeight = Math.min(260, Math.max(44, filtered.length * 34 + groups.filter(Boolean).length * 29 + (showInheritance ? 34 : 0) + 10));
  const inheritanceValue = `${id}-inherit`;
  const defaultValue = `${id}-default`;
  const changeOpen = (value: boolean) => { setOpen(value); if (!value) setQuery(''); };
  return <Popover open={open} onOpenChange={changeOpen}>
    <PopoverTrigger asChild><Button variant="outline" size="sm" className="dvx-model-picker-trigger" aria-label={label} disabled={disabled}>
      <span>{title}</span>{showEffort && effort && effort !== title && <small>· {effort}</small>}<ChevronDown aria-hidden="true" />
    </Button></PopoverTrigger>
    <PopoverContent className="dvx-model-picker" align="end" aria-label={label}>
      <div className="dvx-picker-search"><Search aria-hidden="true" /><Input type="search" aria-label={t('搜索模型')} placeholder={t('搜索模型')}
        value={query} onChange={event => setQuery(event.target.value)} /></div>
      <ScrollArea className="dvx-picker-models" nonce={nonce} style={{ height: listHeight }}>
        {(filtered.length > 0 || showInheritance) && <RadioGroup aria-label={label} value={inherited ? inheritanceValue : modelId ?? ''} disabled={disabled || modelDisabled}
          onValueChange={value => { onModelChange(value === inheritanceValue ? null : value); if (!onEffortChange) changeOpen(false); }}>
          {inherit && showInheritance && <RadioGroupItem value={inheritanceValue} className="dvx-picker-option">
            <span>{inherit.label}</span>{inherited && <Check aria-hidden="true" />}
          </RadioGroupItem>}
          {groups.map(group => <div key={group} className="dvx-picker-group">
            {group && <div className="dvx-picker-group-label">{group}</div>}
            {filtered.filter(item => (item.source ?? '') === group).map(item => <RadioGroupItem key={item.id} value={item.id}
              className="dvx-picker-option" disabled={Boolean(item.disabledReason)} title={item.disabledReason ?? item.id}>
              <span>{item.label}{item.disabledReason && <small>{t('Unavailable')}</small>}</span>{item.id === modelId && <Check aria-hidden="true" />}
            </RadioGroupItem>)}
          </div>)}
        </RadioGroup>}
        {filtered.length === 0 && !showInheritance && <p className="dvx-picker-empty" role="status">{t('没有匹配的模型。')}</p>}
      </ScrollArea>
      {showEffort && onEffortChange && <div className="dvx-picker-effort">
        <span>{effortLabel ?? t('推理强度')}</span>
        <Select value={reasoningEffort ?? (defaultEffortLabel ? defaultValue : model?.defaultReasoning ?? '')}
          disabled={disabled || effortDisabled || Boolean(model?.disabledReason) || !model?.reasoning?.length}
          onValueChange={value => onEffortChange(value === defaultValue ? null : value)}>
          <SelectTrigger aria-label={effortLabel ?? t('推理强度')}><SelectValue placeholder={t('不可用')} /></SelectTrigger>
          <SelectContent align="end">
            {defaultEffortLabel && <SelectItem value={defaultValue}>{t(defaultEffortLabel)}</SelectItem>}
            {model?.reasoning?.map(value => <SelectItem key={value} value={value}>{effortName(value)}{value === model.defaultReasoning ? t('(default)') : ''}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>}
    </PopoverContent>
  </Popover>;
}
