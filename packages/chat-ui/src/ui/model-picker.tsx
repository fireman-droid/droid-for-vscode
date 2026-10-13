import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { Check, ChevronDown, ChevronRight, Search } from 'lucide-react';
import { useI18n } from '../i18n';
import { Button } from './button';
import { Input } from './input';
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem,
  DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from './dropdown-menu';
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
  const [modelsOpen, setModelsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const modelTriggerRef = useRef<HTMLDivElement>(null);
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
  const changeModelsOpen = (value: boolean) => { setModelsOpen(value); if (!value) setQuery(''); };
  const changeOpen = (value: boolean) => { setOpen(value); if (!value) changeModelsOpen(false); };
  // Bridge the search field into the menu; Radix owns navigation between menu items and submenus.
  const searchKeys = (event: KeyboardEvent<HTMLElement>) => {
    if (event.target === searchRef.current) {
      if (event.key === 'Escape') return;
      event.stopPropagation();
      if (event.nativeEvent.isComposing) return;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Tab') {
        event.preventDefault();
        const items = event.currentTarget.closest('[role="menu"]')?.querySelectorAll<HTMLElement>('[role="menuitemradio"]:not([data-disabled])') ?? [];
        const index = event.key === 'ArrowUp' || event.shiftKey ? items.length - 1 : 0;
        items[index]?.focus();
      }
    } else if (event.key === 'Tab') {
      event.preventDefault(); event.stopPropagation(); searchRef.current?.focus();
    }
  };
  const modelList = <>
    <div className="dvx-picker-search"><Search aria-hidden="true" /><Input ref={searchRef} type="search" aria-label={t('搜索模型')} placeholder={t('搜索模型')}
      value={query} onChange={event => setQuery(event.target.value)} onKeyDown={searchKeys} /></div>
    <ScrollArea className="dvx-picker-models" nonce={nonce} style={{ height: listHeight }}>
      {(filtered.length > 0 || showInheritance) && <DropdownMenuRadioGroup aria-label={label} value={inherited ? inheritanceValue : modelId ?? ''}
        onValueChange={value => {
          const nextId = value === inheritanceValue ? null : value;
          if (nextId !== (modelId ?? null)) onModelChange(nextId);
          if (onEffortChange) { changeModelsOpen(false); modelTriggerRef.current?.focus(); }
        }}>
        {inherit && showInheritance && <DropdownMenuRadioItem value={inheritanceValue} className="dvx-picker-option" disabled={disabled || modelDisabled}
          onSelect={event => { if (onEffortChange) event.preventDefault(); }}>
          <span>{inherit.label}</span>{inherited && <Check aria-hidden="true" />}
        </DropdownMenuRadioItem>}
        {groups.map(group => <div key={group} className="dvx-picker-group">
          {group && <div className="dvx-picker-group-label">{group}</div>}
          {filtered.filter(item => (item.source ?? '') === group).map(item => <DropdownMenuRadioItem key={item.id} value={item.id}
            className="dvx-picker-option" disabled={disabled || modelDisabled || Boolean(item.disabledReason)} title={item.disabledReason ?? item.id}
            onSelect={event => { if (onEffortChange) event.preventDefault(); }}>
            <span>{item.label}{item.disabledReason && <small>{t('Unavailable')}</small>}</span>{item.id === modelId && <Check aria-hidden="true" />}
          </DropdownMenuRadioItem>)}
        </div>)}
      </DropdownMenuRadioGroup>}
      {filtered.length === 0 && !showInheritance && <p className="dvx-picker-empty" role="status">{t('没有匹配的模型。')}</p>}
    </ScrollArea>
  </>;
  return <DropdownMenu open={open} onOpenChange={changeOpen}>
    <DropdownMenuTrigger asChild><Button variant="outline" size="sm" className="dvx-model-picker-trigger" aria-label={label} disabled={disabled}>
      <span>{title}</span>{showEffort && effort && effort !== title && <small>· {effort}</small>}<ChevronDown aria-hidden="true" />
    </Button></DropdownMenuTrigger>
    {onEffortChange ? <DropdownMenuContent className="dvx-model-controls" align="end" aria-label={label}>
      {showEffort && <DropdownMenuSub>
        <DropdownMenuSubTrigger className="dvx-picker-setting" disabled={effortDisabled || Boolean(model?.disabledReason)}>
          <span>{effortLabel ?? t('推理强度')}</span><small>{effort}</small><ChevronRight aria-hidden="true" />
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="dvx-picker-levels" aria-label={effortLabel ?? t('推理强度')}>
          <DropdownMenuRadioGroup value={reasoningEffort ?? (defaultEffortLabel ? defaultValue : model?.defaultReasoning ?? '')}
            onValueChange={value => onEffortChange(value === defaultValue ? null : value)}>
            {defaultEffortLabel && <DropdownMenuRadioItem className="dvx-picker-option" value={defaultValue}>
              <span>{t(defaultEffortLabel)}</span>{reasoningEffort == null && <Check aria-hidden="true" />}
            </DropdownMenuRadioItem>}
            {model?.reasoning?.map(value => <DropdownMenuRadioItem className="dvx-picker-option" key={value} value={value}>
              <span>{effortName(value)}{value === model.defaultReasoning && <small>{t('(default)')}</small>}</span>
              {(reasoningEffort ?? (!defaultEffortLabel ? model.defaultReasoning : undefined)) === value && <Check aria-hidden="true" />}
            </DropdownMenuRadioItem>)}
          </DropdownMenuRadioGroup>
        </DropdownMenuSubContent>
      </DropdownMenuSub>}
      <DropdownMenuSub open={modelsOpen} onOpenChange={changeModelsOpen}>
        <DropdownMenuSubTrigger ref={modelTriggerRef} className="dvx-picker-setting" disabled={modelDisabled}>
          <span>{t('Model')}</span><small title={title}>{title}</small><ChevronRight aria-hidden="true" />
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="dvx-model-picker" aria-label={t('选择模型')} onKeyDown={searchKeys}>{modelList}</DropdownMenuSubContent>
      </DropdownMenuSub>
    </DropdownMenuContent> : <DropdownMenuContent className="dvx-model-picker" align="end" aria-label={label} onKeyDown={searchKeys}>{modelList}</DropdownMenuContent>}
  </DropdownMenu>;
}
